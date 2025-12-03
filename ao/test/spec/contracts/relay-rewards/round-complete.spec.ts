import { expect } from 'chai'

import {
    ALICE_ADDRESS,
    BOB_ADDRESS,
    CHARLS_ADDRESS,
    AOTestHandle,
    createLoader,
    FINGERPRINT_A,
    FINGERPRINT_B,
    FINGERPRINT_C,
    OWNER_ADDRESS
  } from '~/test/util/setup'

describe('Round Completion of relay rewards', () => {
  let handle: AOTestHandle

  let score0 = { Address: ALICE_ADDRESS, Network: 0, IsHardware: false,
    UptimeStreak: 0, ExitBonus: false, FamilySize: 0, LocationSize: 0
  }
  let score1 = { Address: BOB_ADDRESS, Network: 100, IsHardware: false,
    UptimeStreak: 0, ExitBonus: false, FamilySize: 0, LocationSize: 0
  }
  let score2 = { Address: CHARLS_ADDRESS, Network: 200, IsHardware: true,
    UptimeStreak: 0, ExitBonus: false, FamilySize: 0, LocationSize: 0
  }
  let refRound0 = JSON.stringify({ Scores: { [FINGERPRINT_A]: score0 } })
  let refRound1 = JSON.stringify({ Scores: { [FINGERPRINT_A]: score0,
    [FINGERPRINT_B]: score1 } })
  let refRound2 = JSON.stringify({
    Scores: { [FINGERPRINT_A]: score0, [FINGERPRINT_B]: score1, [FINGERPRINT_C]: score2 }
  })

  beforeEach(async () => {
    handle = (await createLoader('relay-rewards')).handle
  })

  it('Blocks non-owners from doing updates', async () => {
    const result = await handle({
      From: ALICE_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Complete-Round' }
      ]
    })
    expect(result.Error).to.be.a('string').that.includes('Permission Denied')
  })

  it('Ensures provided timestamp is integer', async () => {
    const noStampResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Complete-Round' }
      ]
    })
    expect(noStampResult.Error).to.be.a('string').that.includes('Timestamp tag')

    const emptyStampResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Complete-Round' },
          { name: 'Round-Timestamp', value: '' }
      ]
    })
    expect(emptyStampResult.Error).to.be.a('string').that.includes('Timestamp tag')

    const badStampResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Complete-Round' },
          { name: 'Round-Timestamp', value: 'bad-stamp' }
      ]
    })
    expect(badStampResult.Error).to.be.a('string').that.includes('Timestamp tag')
  })

  it('Confirms pending round exists for given timestamp', async () => {
    const noRoundResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Complete-Round' },
          { name: 'Round-Timestamp', value: '1000' }
      ]
    })
    expect(noRoundResult.Error).to.be.a('string').that.includes('No pending round for 1000')
  })

  it('Removes rounds dated before completed timestamp', async () => {
    const configResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Update-Configuration' }
      ],
      Data: JSON.stringify({
        TokensPerSecond: '123',
        Modifiers: {
          Network: {
            Share: 1
          },
          Hardware: { Enabled: false, Share: 0, UptimeInfluence: 0 },
          Uptime: { Enabled: false, Share: 0 },
          ExitBonus: { Enabled: false, Share: 0 }
        }
      })
    })
    expect(configResult.Messages).to.have.lengthOf(2)
    expect(configResult.Messages[0].Tags).to.deep.include({
      name: 'device',
      value: 'patch@1.0'
    })
    expect(configResult.Messages[1].Data).to.equal('OK')

    const round1Result = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Add-Scores' },
          { name: 'Round-Timestamp', value: '1000' }
      ],
      Data: refRound1
    })
    expect(round1Result.Messages).to.have.lengthOf(1)
    expect(round1Result.Messages[0].Data).to.equal('OK')

    const round2Result = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Add-Scores' },
          { name: 'Round-Timestamp', value: '2000' }
      ],
      Data: refRound1
    })
    expect(round2Result.Messages).to.have.lengthOf(1)
    expect(round2Result.Messages[0].Data).to.equal('OK')

    const round2CompleteResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Complete-Round' },
          { name: 'Round-Timestamp', value: '2000' }
      ]
    })
    expect(round2CompleteResult.Messages).to.have.lengthOf(2)
    expect(round2CompleteResult.Messages[0].Tags).to.deep.include({
      name: 'device',
      value: 'patch@1.0'
    })
    expect(round2CompleteResult.Messages[1].Data).to.equal('OK')

    const round1CancelResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Cancel-Round' },
          { name: 'Round-Timestamp', value: '1000' }
      ]
    })
    expect(round1CancelResult.Error).to.be.a('string').that.includes('No pending round for 1000')
  })

  it('Tracks data and metadata of the last round', async () => {
    const configResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Update-Configuration' }
      ],
      Data: JSON.stringify({
        TokensPerSecond: '123',
        Modifiers: {
          Network: {
            Share: 1
          },
          Hardware: { Enabled: false, Share: 0, UptimeInfluence: 0 },
          Uptime: { Enabled: false, Share: 0 },
          ExitBonus: { Enabled: false, Share: 0 }
        }
      })
    })
    expect(configResult.Messages).to.have.lengthOf(2)
    expect(configResult.Messages[0].Tags).to.deep.include({
      name: 'device',
      value: 'patch@1.0'
    })
    expect(configResult.Messages[1].Data).to.equal('OK')

    const round1Result = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Add-Scores' },
          { name: 'Round-Timestamp', value: '1000' }
      ],
      Data: refRound1
    })
    expect(round1Result.Messages).to.have.lengthOf(1)
    expect(round1Result.Messages[0].Data).to.equal('OK')

    const round1CompleteResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Complete-Round' },
          { name: 'Round-Timestamp', value: '1000' }
      ]
    })
    expect(round1CompleteResult.Messages).to.have.lengthOf(2)
    expect(round1CompleteResult.Messages[0].Tags).to.deep.include({
      name: 'device',
      value: 'patch@1.0'
    })
    expect(round1CompleteResult.Messages[1].Data).to.equal('OK')

    const round2Result = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Add-Scores' },
          { name: 'Round-Timestamp', value: '2000' }
      ],
      Data: refRound1
    })
    expect(round2Result.Messages).to.have.lengthOf(1)
    expect(round2Result.Messages[0].Data).to.equal('OK')

    const round2CompleteResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Complete-Round' },
          { name: 'Round-Timestamp', value: '2000' }
      ]
    })
    expect(round2CompleteResult.Messages).to.have.lengthOf(2)
    expect(round2CompleteResult.Messages[0].Tags).to.deep.include({
      name: 'device',
      value: 'patch@1.0'
    })
    expect(round2CompleteResult.Messages[1].Data).to.equal('OK')

    const roundDataResult = await handle({
      From: BOB_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Last-Round-Data' },
          { name: 'Fingerprint', value: FINGERPRINT_B }
      ]
    })
    expect(roundDataResult.Messages).to.have.lengthOf(1)
    const data = JSON.parse(roundDataResult.Messages[0].Data)
    expect(data.Details.Reward.OperatorTotal).to.equal('123')

    const roundMetadataResult = await handle({
      From: BOB_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Last-Round-Metadata' }
      ]
    })
    expect(roundMetadataResult.Messages).to.have.lengthOf(1)
    const metadata = JSON.parse(roundMetadataResult.Messages[0].Data)
    expect(metadata.Timestamp).to.equal(2000)
    expect(metadata.Period).to.equal(1)
    expect(metadata.Configuration.TokensPerSecond).to.equal('123')
    expect(metadata.Summary.Ratings.Network).to.equal('100')
    expect(metadata.Summary.Rewards.Total).to.equal('123')
    expect(metadata.Summary.Rewards.Network).to.equal('123')


    const snapshotResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Last-Snapshot' }
      ]
    })
    expect(snapshotResult.Messages).to.have.lengthOf(1)
    const snapshot = JSON.parse(snapshotResult.Messages[0].Data)
    expect(snapshot.Timestamp).to.equal(2000)
    expect(Object.keys(snapshot.Details).length).to.equal(2)

    const round2CompleteResultTotalAddressReward = round2CompleteResult.Messages[0].Tags.find(t => t.name === 'total_address_reward')?.value
    expect(round2CompleteResultTotalAddressReward).to.exist
    expect(round2CompleteResultTotalAddressReward).to.deep.equal({
      [BOB_ADDRESS]: '123',
      [ALICE_ADDRESS]: '0'
    })

    const round2CompleteResultTotalFingerprintReward = round2CompleteResult.Messages[0].Tags.find(t => t.name === 'total_fingerprint_reward')?.value
    expect(round2CompleteResultTotalFingerprintReward).to.exist
    expect(round2CompleteResultTotalFingerprintReward).to.deep.equal({
      [FINGERPRINT_B]: '123',
      [FINGERPRINT_A]: '0'
    })

    const patchMessage = round2CompleteResult.Messages[0].Tags.find(t => t.name === 'previous_round')?.value as any
    expect(patchMessage).to.exist
    expect(patchMessage.Timestamp).to.equal(2000)
    expect(patchMessage.Period).to.equal(1)
    expect(patchMessage.Summary.Ratings.Network).to.equal('100')
    expect(patchMessage.Summary.Ratings.ExitBonus).to.equal('0')
    expect(patchMessage.Summary.Ratings.Uptime).to.equal('0.0')
    expect(patchMessage.Summary.Rewards.Total).to.equal('123')
    expect(patchMessage.Summary.Rewards.Network).to.equal('123')
    expect(patchMessage.Summary.Rewards.ExitBonus).to.equal('0')
    expect(patchMessage.Summary.Rewards.Uptime).to.equal('0')
    expect(patchMessage.Summary.Rewards.Hardware).to.equal('0')
    expect(Object.keys(patchMessage.Details).length).to.equal(2)
    expect(patchMessage.Details[FINGERPRINT_A].Reward.Total).to.equal('0')
    expect(patchMessage.Details[FINGERPRINT_A].Score.Network).to.equal(0)
    expect(patchMessage.Details[FINGERPRINT_B].Reward.Total).to.equal('123')
    expect(patchMessage.Details[FINGERPRINT_B].Score.Network).to.equal(100)
    expect(patchMessage.Configuration.TokensPerSecond).to.equal('123')
    expect(patchMessage.Configuration).to.deep.equal({
      Multipliers: {
        Family: { Power: 1, Enabled: true, Offset: 0.01 },
        Location: { Power: 2, Divider: 20, Enabled: true, Offset: 0.001 }
      },
      Modifiers: {
        Hardware: { Share: 0, Enabled: false, UptimeInfluence: 0 },
        Network: { Share: 1 },
        ExitBonus: { Enabled: false, Share: 0 },
        Uptime: { Share: 0, Tiers: { '0': 0, '3': 1, '14': 3 }, Enabled: false }
      },
      TokensPerSecond: '123',
      Delegates: []
    })
  })
})
