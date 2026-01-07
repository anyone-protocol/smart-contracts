import { expect } from 'chai'

import {
  ALICE_ADDRESS,
  BOB_ADDRESS,
  CHARLS_ADDRESS,
  AOTestHandle,
  ConfigurationPatchTag,
  createLoader,
  OWNER_ADDRESS,
  SharesPatchTag
} from '~/test/util/setup'

describe('Round Completion of staking rewards', () => {
  let handle: AOTestHandle

  let score0 = { [BOB_ADDRESS]: { Staked: '1', Running: 0, Share: 0 } }
  let score1 = { [BOB_ADDRESS]: { Staked: '100', Running: 0.8, Share: 0 } }
  let score2 = { [CHARLS_ADDRESS]: { Staked: '200', Running: 0.7, Share: 0 } }
  let refRound0 = JSON.stringify({ Scores: { [ALICE_ADDRESS]: score0 } })
  let refRound1 = JSON.stringify({ Scores: {
    [ALICE_ADDRESS]: score0,
    [BOB_ADDRESS]: score1
  } })
  let refRound2 = JSON.stringify({ Scores: {
    [ALICE_ADDRESS]: score0,
    [BOB_ADDRESS]: score1,
    [BOB_ADDRESS]: score2 }
  })

  beforeEach(async () => {
    handle = (await createLoader('staking-rewards')).handle
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
    const config = {
      TokensPerSecond: '100000000',
      Requirements: {
        Running: 0.5
      }
    }
    const configResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Update-Configuration' }
      ],
      Data: JSON.stringify(config)
    })
    expect(configResult.Messages).to.have.lengthOf(2)
    expect(configResult.Messages[0].Tags).to.deep.include({ name: 'device', value: 'patch@1.0' })
    const cfgTag = configResult.Messages[0].Tags.find(
      (t: { name: string }) => t.name === 'configuration'
    ) as ConfigurationPatchTag | undefined
    expect(cfgTag).to.exist
    expect(cfgTag!.value.TokensPerSecond).to.equal(config.TokensPerSecond)
    expect(cfgTag!.value.Requirements.Running).to.equal(config.Requirements.Running)
    expect(cfgTag!.value.Shares.Enabled).to.equal(false)
    expect(cfgTag!.value.Shares.Min).to.equal(0.0)
    expect(cfgTag!.value.Shares.Max).to.equal(1.0)
    expect(cfgTag!.value.Shares.Default).to.equal(0.0)
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
    expect(round2CompleteResult.Messages[0].Tags).to.deep.include({ name: 'device', value: 'patch@1.0' })
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
    const config = {
      TokensPerSecond: '100000000',
      Requirements: {
        Running: 0.5
      }
    }
    const configResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Update-Configuration' }
      ],
      Data: JSON.stringify(config)
    })
    expect(configResult.Messages).to.have.lengthOf(2)
    expect(configResult.Messages[0].Tags).to.deep.include({ name: 'device', value: 'patch@1.0' })
    const cfgTag2 = configResult.Messages[0].Tags.find(
      (t: { name: string }) => t.name === 'configuration'
    ) as ConfigurationPatchTag | undefined
    expect(cfgTag2).to.exist
    expect(cfgTag2!.value.TokensPerSecond).to.equal(config.TokensPerSecond)
    expect(cfgTag2!.value.Requirements.Running).to.equal(config.Requirements.Running)
    expect(cfgTag2!.value.Shares.Enabled).to.equal(false)
    expect(cfgTag2!.value.Shares.Min).to.equal(0.0)
    expect(cfgTag2!.value.Shares.Max).to.equal(1.0)
    expect(cfgTag2!.value.Shares.Default).to.equal(0.0)
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
    expect(round1CompleteResult.Messages[0].Tags).to.deep.include({ name: 'device', value: 'patch@1.0' })
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
    expect(round2CompleteResult.Messages[0].Tags).to.deep.include({ name: 'device', value: 'patch@1.0' })
    expect(round2CompleteResult.Messages[1].Data).to.equal('OK')

    const roundDataResult = await handle({
      From: BOB_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Last-Round-Data' },
          { name: 'Address', value: BOB_ADDRESS }
      ]
    })

    expect(roundDataResult.Messages).to.have.lengthOf(1)
    const data = JSON.parse(roundDataResult.Messages[0].Data)
    expect(data.Details[BOB_ADDRESS].Reward.Hodler).to.equal('100000000')

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
    expect(metadata.Configuration.TokensPerSecond).to.equal('100000000')
    expect(metadata.Summary.Stakes).to.equal('101')
    expect(metadata.Summary.Ratings).to.equal('100')
    expect(metadata.Summary.Rewards).to.equal('100000000')


    const snapshotResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Last-Snapshot' }
      ]
    })

    expect(roundMetadataResult.Messages).to.have.lengthOf(1)
    const snapshot = JSON.parse(snapshotResult.Messages[0].Data)
    expect(snapshot.Timestamp).to.equal(2000)
    expect(Object.keys(snapshot.Details).length).to.equal(2)
  })

  describe('Complete-Round assigns default share to new operators', () => {
  let handle: AOTestHandle

  const score0 = { [BOB_ADDRESS]: {
    Staked: '1', Running: 0.5
  } }

  const refRound1 = JSON.stringify({
    Scores: { [ALICE_ADDRESS]: score0 }
  })

  beforeEach(async () => {
    handle = (await createLoader('staking-rewards')).handle
  })

  it('New operator receives Configuration.Shares.Default when round is completed', async () => {
    // Enable shares and set default share
    await handle({
      From: OWNER_ADDRESS,
      Tags: [{ name: 'Action', value: 'Toggle-Feature-Shares' }],
      Data: JSON.stringify({ Enabled: true })
    })

    await handle({
      From: OWNER_ADDRESS,
      Tags: [{ name: 'Action', value: 'Update-Shares-Configuration' }],
      Data: JSON.stringify({ Default: 0.15 })
    })

    await handle({
      From: OWNER_ADDRESS,
      Tags: [{ name: 'Action', value: 'Update-Configuration' }],
      Data: JSON.stringify({ TokensPerSecond: '100', Requirements: { Running: 0.5 } })
    })

    // Add scores for a new operator (BOB_ADDRESS)
    const addResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
        { name: 'Action', value: 'Add-Scores' },
        { name: 'Round-Timestamp', value: '1000' }
      ],
      Data: refRound1
    })

    // Add-Scores should only return OK (no shares patch)
    expect(addResult.Messages).to.have.lengthOf(1)
    expect(addResult.Messages[0].Data).to.equal('OK')

    // Complete the round - this is when default share is assigned
    const completeResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
        { name: 'Action', value: 'Complete-Round' },
        { name: 'Round-Timestamp', value: '1000' }
      ]
    })

    // Should have 2 messages: patch (with shares), OK response
    expect(completeResult.Messages).to.have.lengthOf(2)
    expect(completeResult.Messages[0].Tags).to.deep.include({ name: 'device', value: 'patch@1.0' })
    const sharesPatch = completeResult.Messages[0].Tags.find(
      (t: { name: string }) => t.name === 'shares'
    ) as SharesPatchTag | undefined
    expect(sharesPatch).to.exist
    expect(sharesPatch!.value[BOB_ADDRESS]).to.equal(0.15)
    expect(completeResult.Messages[1].Data).to.equal('OK')

    // Verify the new operator was assigned the default share in state
    const stateResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [{ name: 'Action', value: 'View-State' }]
    })
    const state = JSON.parse(stateResult.Messages[0].Data)
    expect(state.Shares[BOB_ADDRESS]).to.equal(0.15)
  })

  it('Existing operator retains their set share', async () => {
    // Enable shares
    await handle({
      From: OWNER_ADDRESS,
      Tags: [{ name: 'Action', value: 'Toggle-Feature-Shares' }],
      Data: JSON.stringify({ Enabled: true })
    })

    await handle({
      From: OWNER_ADDRESS,
      Tags: [{ name: 'Action', value: 'Update-Shares-Configuration' }],
      Data: JSON.stringify({ Default: 0.1 })
    })

    await handle({
      From: OWNER_ADDRESS,
      Tags: [{ name: 'Action', value: 'Update-Configuration' }],
      Data: JSON.stringify({ TokensPerSecond: '100', Requirements: { Running: 0.5 } })
    })

    // Operator sets their own share to 0.3
    await handle({
      From: BOB_ADDRESS,
      Tags: [{ name: 'Action', value: 'Set-Share' }],
      Data: JSON.stringify({ Share: 0.3 })
    })

    // Add scores
    await handle({
      From: OWNER_ADDRESS,
      Tags: [
        { name: 'Action', value: 'Add-Scores' },
        { name: 'Round-Timestamp', value: '1000' }
      ],
      Data: refRound1
    })

    // Complete round
    const completeResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
        { name: 'Action', value: 'Complete-Round' },
        { name: 'Round-Timestamp', value: '1000' }
      ]
    })

    // No shares patch since not a new operator
    const sharesPatch = completeResult.Messages[0].Tags.find(
      (t: { name: string }) => t.name === 'shares'
    ) as SharesPatchTag | undefined
    expect(sharesPatch).to.be.undefined

    // Verify operator kept their set share
    const stateResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [{ name: 'Action', value: 'View-State' }]
    })
    const state = JSON.parse(stateResult.Messages[0].Data)
    expect(state.Shares[BOB_ADDRESS]).to.equal(0.3)
  })

  it('Default share is persisted to StakingRewards.Shares after round completes', async () => {
    await handle({
      From: OWNER_ADDRESS,
      Tags: [{ name: 'Action', value: 'Toggle-Feature-Shares' }],
      Data: JSON.stringify({ Enabled: true })
    })

    await handle({
      From: OWNER_ADDRESS,
      Tags: [{ name: 'Action', value: 'Update-Shares-Configuration' }],
      Data: JSON.stringify({ Default: 0.2 })
    })

    await handle({
      From: OWNER_ADDRESS,
      Tags: [{ name: 'Action', value: 'Update-Configuration' }],
      Data: JSON.stringify({ TokensPerSecond: '100', Requirements: { Running: 0.5 } })
    })

    // Add scores for new operator
    await handle({
      From: OWNER_ADDRESS,
      Tags: [
        { name: 'Action', value: 'Add-Scores' },
        { name: 'Round-Timestamp', value: '1000' }
      ],
      Data: refRound1
    })

    // Complete round - this assigns the default share
    await handle({
      From: OWNER_ADDRESS,
      Tags: [
        { name: 'Action', value: 'Complete-Round' },
        { name: 'Round-Timestamp', value: '1000' }
      ]
    })

    // Add scores again for same operator in a new round
    await handle({
      From: OWNER_ADDRESS,
      Tags: [
        { name: 'Action', value: 'Add-Scores' },
        { name: 'Round-Timestamp', value: '2000' }
      ],
      Data: refRound1
    })

    // Complete second round - no new shares patch
    const completeResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
        { name: 'Action', value: 'Complete-Round' },
        { name: 'Round-Timestamp', value: '2000' }
      ]
    })

    // No shares in patch since operator already exists
    const sharesPatch = completeResult.Messages[0].Tags.find(
      (t: { name: string }) => t.name === 'shares'
    ) as SharesPatchTag | undefined
    expect(sharesPatch).to.be.undefined

    // Operator still has their persisted share
    const stateResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [{ name: 'Action', value: 'View-State' }]
    })
    const state = JSON.parse(stateResult.Messages[0].Data)
    expect(state.Shares[BOB_ADDRESS]).to.equal(0.2)
  })

  it('New operator gets share 0.0 when shares are disabled', async () => {
    await handle({
      From: OWNER_ADDRESS,
      Tags: [{ name: 'Action', value: 'Update-Configuration' }],
      Data: JSON.stringify({ TokensPerSecond: '100', Requirements: { Running: 0.5 } })
    })

    // Shares are disabled by default
    await handle({
      From: OWNER_ADDRESS,
      Tags: [
        { name: 'Action', value: 'Add-Scores' },
        { name: 'Round-Timestamp', value: '1000' }
      ],
      Data: refRound1
    })

    const completeResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
        { name: 'Action', value: 'Complete-Round' },
        { name: 'Round-Timestamp', value: '1000' }
      ]
    })

    // No shares in patch when disabled
    const sharesPatch = completeResult.Messages[0].Tags.find(
      (t: { name: string }) => t.name === 'shares'
    ) as SharesPatchTag | undefined
    expect(sharesPatch).to.be.undefined

    // Operator should not be in Shares state
    const stateResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [{ name: 'Action', value: 'View-State' }]
    })
    const state = JSON.parse(stateResult.Messages[0].Data)
    expect(state.Shares[BOB_ADDRESS]).to.be.undefined
  })

  it('Multiple new operators all receive default share on round completion', async () => {
    await handle({
      From: OWNER_ADDRESS,
      Tags: [{ name: 'Action', value: 'Toggle-Feature-Shares' }],
      Data: JSON.stringify({ Enabled: true })
    })

    await handle({
      From: OWNER_ADDRESS,
      Tags: [{ name: 'Action', value: 'Update-Shares-Configuration' }],
      Data: JSON.stringify({ Default: 0.25 })
    })

    await handle({
      From: OWNER_ADDRESS,
      Tags: [{ name: 'Action', value: 'Update-Configuration' }],
      Data: JSON.stringify({ TokensPerSecond: '100', Requirements: { Running: 0.5 } })
    })

    // Add scores for multiple hodlers staking with multiple operators
    const multiOperatorScores = JSON.stringify({
      Scores: {
        [ALICE_ADDRESS]: {
          [BOB_ADDRESS]: { Staked: '100', Running: 0.8 },
          [CHARLS_ADDRESS]: { Staked: '200', Running: 0.9 }
        }
      }
    })

    await handle({
      From: OWNER_ADDRESS,
      Tags: [
        { name: 'Action', value: 'Add-Scores' },
        { name: 'Round-Timestamp', value: '1000' }
      ],
      Data: multiOperatorScores
    })

    const completeResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
        { name: 'Action', value: 'Complete-Round' },
        { name: 'Round-Timestamp', value: '1000' }
      ]
    })

    const sharesPatch = completeResult.Messages[0].Tags.find(
      (t: { name: string }) => t.name === 'shares'
    ) as SharesPatchTag | undefined
    expect(sharesPatch).to.exist
    expect(sharesPatch!.value[BOB_ADDRESS]).to.equal(0.25)
    expect(sharesPatch!.value[CHARLS_ADDRESS]).to.equal(0.25)

    const stateResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [{ name: 'Action', value: 'View-State' }]
    })
    const state = JSON.parse(stateResult.Messages[0].Data)
    expect(state.Shares[BOB_ADDRESS]).to.equal(0.25)
    expect(state.Shares[CHARLS_ADDRESS]).to.equal(0.25)
  })

  it('Share is correctly snapshotted in PendingRounds for new operator', async () => {
    await handle({
      From: OWNER_ADDRESS,
      Tags: [{ name: 'Action', value: 'Toggle-Feature-Shares' }],
      Data: JSON.stringify({ Enabled: true })
    })

    await handle({
      From: OWNER_ADDRESS,
      Tags: [{ name: 'Action', value: 'Update-Shares-Configuration' }],
      Data: JSON.stringify({ Default: 0.18 })
    })

    await handle({
      From: OWNER_ADDRESS,
      Tags: [{ name: 'Action', value: 'Update-Configuration' }],
      Data: JSON.stringify({ TokensPerSecond: '100', Requirements: { Running: 0.5 } })
    })

    // Add scores
    await handle({
      From: OWNER_ADDRESS,
      Tags: [
        { name: 'Action', value: 'Add-Scores' },
        { name: 'Round-Timestamp', value: '1000' }
      ],
      Data: refRound1
    })

    // Complete round
    const completeResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
        { name: 'Action', value: 'Complete-Round' },
        { name: 'Round-Timestamp', value: '1000' }
      ]
    })

    expect(completeResult.Messages).to.have.lengthOf(2)
    expect(completeResult.Messages[1].Data).to.equal('OK')

    // Check Last-Snapshot for correct share
    const snapshotResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [{ name: 'Action', value: 'Last-Snapshot' }]
    })
    const snapshot = JSON.parse(snapshotResult.Messages[0].Data)
    expect(snapshot.Details[ALICE_ADDRESS][BOB_ADDRESS].Score.Share).to.equal(0.18)
  })
})
})
