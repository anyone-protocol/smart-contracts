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
    )
    expect(cfgTag).to.exist
    expect(cfgTag.value.TokensPerSecond).to.equal(config.TokensPerSecond)
    expect(cfgTag.value.Requirements.Running).to.equal(config.Requirements.Running)
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
    )
    expect(cfgTag2).to.exist
    expect(cfgTag2.value.TokensPerSecond).to.equal(config.TokensPerSecond)
    expect(cfgTag2.value.Requirements.Running).to.equal(config.Requirements.Running)
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

})
