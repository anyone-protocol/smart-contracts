import { expect } from 'chai'

import {
  ALICE_ADDRESS,
  BOB_ADDRESS,
  CHARLS_ADDRESS,
  AOTestHandle,
  createLoader,
  FINGERPRINT_A,
  OWNER_ADDRESS
} from '~/test/util/setup'

describe('Add-Scores action of staking rewards', () => {
  let handle: AOTestHandle

  let score0 = { [BOB_ADDRESS]: {
    Staked: '1', Running: 0.0, Share: 0.0
  } }

  let refRound1 = JSON.stringify({
    Scores: { [ALICE_ADDRESS]: score0 }
  })

  beforeEach(async () => {
    handle = (await createLoader('staking-rewards')).handle
  })

  it('Blocks non-owners from doing updates', async () => {
    const result = await handle({
      From: ALICE_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Add-Scores' }
      ]
    })
    expect(result.Error).to.be.a('string').that.includes('Permission Denied')
  })

  it('Requires message data to be JSON', async () => {
    const result = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Add-Scores' }
      ]
    })
    expect(result.Error).to.be.a('string').that.includes('Message data is required to process request')

    const resultWithData = await handle({
        From: OWNER_ADDRESS,
        Tags: [
            { name: 'Action', value: 'Add-Scores' }
        ],
        Data: "Some data"
    })
    expect(resultWithData.Error).to.be.a('string').that.includes('Data must be valid JSON')
  })

  it('Ensures provided timestamp is integer', async () => {
    const noStampResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Add-Scores' }
      ],
      Data: refRound1
    })
    expect(noStampResult.Error).to.be.a('string').that.includes('Timestamp tag')

    const emptyStampResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Add-Scores' },
          { name: 'Round-Timestamp', value: '' }
      ],
      Data: refRound1
    })
    expect(emptyStampResult.Error).to.be.a('string').that.includes('Timestamp tag')

    const badStampResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Add-Scores' },
          { name: 'Round-Timestamp', value: 'bad-stamp' }
      ],
      Data: refRound1
    })
    expect(badStampResult.Error).to.be.a('string').that.includes('Timestamp tag')
  })

  it('Ensures timestamp is > 0', async () => {
    const zeroStampResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Add-Scores' },
          { name: 'Round-Timestamp', value: '0' }
      ],
      Data: refRound1
    })
    expect(zeroStampResult.Error).to.be.a('string').that.includes('Timestamp has to be > 0')
    
    const negativeStampResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Add-Scores' },
          { name: 'Round-Timestamp', value: '-100' }
      ],
      Data: refRound1
    })
    expect(negativeStampResult.Error).to.be.a('string').that.includes('Timestamp has to be > 0')
  })

  it('Ensures timestamp is not backdated to previous round', async () => {
    const config = {
      TokensPerSecond: '100',
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
    
    const noRoundResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Add-Scores' },
          { name: 'Round-Timestamp', value: '10' }
      ],
      Data: refRound1
    })
    expect(noRoundResult.Messages).to.have.lengthOf(1)
    expect(noRoundResult.Messages[0].Data).to.equal('OK')
    
    const completeRoundResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Complete-Round' },
          { name: 'Round-Timestamp', value: '10' }
      ]
    })
    expect(completeRoundResult.Messages).to.have.lengthOf(2)
    expect(completeRoundResult.Messages[0].Tags).to.deep.include({ name: 'device', value: 'patch@1.0' })
    expect(completeRoundResult.Messages[1].Data).to.equal('OK')

    const outdatedStampResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Add-Scores' },
          { name: 'Round-Timestamp', value: '10' }
      ],
      Data: refRound1
    })
    expect(outdatedStampResult.Error).to.be.a('string').that.includes('Timestamp is backdated')

    
    const newRoundResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Add-Scores' },
          { name: 'Round-Timestamp', value: '20' }
      ],
      Data: refRound1
    })
    expect(newRoundResult.Messages).to.have.lengthOf(1)
    expect(newRoundResult.Messages[0].Data).to.equal('OK')
  })

  it('Scores must be a table/array', async () => {
    const outdatedStampResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Add-Scores' },
          { name: 'Round-Timestamp', value: '5' }
      ],
      Data: JSON.stringify({ Scores: "some scores"})
    })
    expect(outdatedStampResult.Error).to.be.a('string').that.includes('Scores have to be a table')
  })

  it('Each score - Hodler address has valid format', async () => {
    const scoresResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Add-Scores' },
          { name: 'Round-Timestamp', value: '5' }
      ],
      Data: JSON.stringify({ Scores: {
        [BOB_ADDRESS]: score0, 
          'asd': score0
        }
      })
    })
    expect(scoresResult.Error).to.be.a('string').that.includes('Invalid Hodler Address')
  })

  it('Each score - score was not duplicated during round scoring', async () => {
    const sameRoundTrueResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Add-Scores' },
          { name: 'Round-Timestamp', value: '5' }
      ],
      Data: refRound1
    })
    expect(sameRoundTrueResult.Messages).to.have.lengthOf(1)
    expect(sameRoundTrueResult.Messages[0].Data).to.equal('OK')

    const sameRoundFalseResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Add-Scores' },
          { name: 'Round-Timestamp', value: '5' }
      ],
      Data: refRound1
    })
    expect(sameRoundFalseResult.Error).to.be.a('string').that.includes('Duplicated score')
  })

  it('Each score - Operator address Must be valid EVM address format', async () => {
    const badOperatorResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Add-Scores' },
          { name: 'Round-Timestamp', value: '5' }
      ],
      Data: JSON.stringify({ Scores: {
        [ALICE_ADDRESS]: { 
          'asd': {
            'Staked': '1', 'Running': 0.0, 'Share': 0.0
          }
        }
      }})
    })
    expect(badOperatorResult.Error).to.be.a('string').that.includes('Invalid Operator address: Scores[0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA][asd]')
  })

  it('Each score - Staked score must be string with integer and >= 0', async () => {
    const emptyStakedResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Add-Scores' },
          { name: 'Round-Timestamp', value: '5' }
      ],
      Data: JSON.stringify({ Scores: {
        [ALICE_ADDRESS]: { 
          [BOB_ADDRESS]: { 'Staked': '', 'Running': 0.0, 'Share': 0.0 }
        }
      }})
    })
    expect(emptyStakedResult.Error).to.be.a('string').that.includes('failed parsing to bint')

    const wrongStakedResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Add-Scores' },
          { name: 'Round-Timestamp', value: '5' }
      ],
      Data: JSON.stringify({ Scores: {
        [ALICE_ADDRESS]: { 
          [BOB_ADDRESS]: { 'Staked': '-1', 'Running': 0.0, 'Share': 0.0 }
        }
      }})
    })
    expect(wrongStakedResult.Error).to.be.a('string').that.includes('must be positive value')
    
    const zeroStakedResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Add-Scores' },
          { name: 'Round-Timestamp', value: '5' }
      ],
      Data: JSON.stringify({ Scores: {
        [ALICE_ADDRESS]: { 
          [BOB_ADDRESS]: { 'Staked': '0', 'Running': 0.0, 'Share': 0.0 }
        }
      }})
    })
    expect(zeroStakedResult.Error).to.be.a('string').that.includes('must be positive value')

    const nullNetworkResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Add-Scores' },
          { name: 'Round-Timestamp', value: '5' }
      ],
      Data: JSON.stringify({ Scores: {
        [ALICE_ADDRESS]: { 
          [BOB_ADDRESS]: { 'Running': 0.0, 'Share': 0.0 }
        }
      }})
    })
    expect(nullNetworkResult.Error).to.be.a('string').that.includes('must be a string number')
  })

  it('Each score - Running score must be a float 0..1', async () => {
    const emptyRunningResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Add-Scores' },
          { name: 'Round-Timestamp', value: '5' }
      ],
      Data: JSON.stringify({ Scores: {
        [ALICE_ADDRESS]: { 
          [BOB_ADDRESS]: { 'Staked': '1', 'Running': '', 'Share': 0.0 }
        }
      }})
    })
    expect(emptyRunningResult.Error).to.be.a('string').that.includes('Number value required')

    const nullRunningResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Add-Scores' },
          { name: 'Round-Timestamp', value: '5' }
      ],
      Data: JSON.stringify({ Scores: {
        [ALICE_ADDRESS]: {
          [BOB_ADDRESS]: { 'Staked': '1', 'Share': 0.0 }
        }
      }})
    })
    expect(nullRunningResult.Error).to.be.a('string').that.includes('Number value required')

    const largeRunningResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Add-Scores' },
          { name: 'Round-Timestamp', value: '5' }
      ],
      Data: JSON.stringify({ Scores: {
        [ALICE_ADDRESS]: {
          [BOB_ADDRESS]: { 'Staked': '1', 'Running': 1.1, 'Share': 0.0 }
        }
      }})
    })
    expect(largeRunningResult.Error).to.be.a('string').that.includes('has to be <= 1')

    const smallRunningResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Add-Scores' },
          { name: 'Round-Timestamp', value: '5' }
      ],
      Data: JSON.stringify({ Scores: {
        [ALICE_ADDRESS]: {
          [BOB_ADDRESS]: { 'Staked': '1', 'Running': -0.1, 'Share': 0.0 }
        }
      }})
    })
    expect(smallRunningResult.Error).to.be.a('string').that.includes('has to be >= 0')
  })
  
  it('Setting share - Share must be a float 0..1', async () => {
    const enableShareResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Toggle-Feature-Shares' }
      ],
      Data: JSON.stringify({ Enabled: true })
    })
    expect(enableShareResult.Messages).to.have.lengthOf(2)
    expect(enableShareResult.Messages[0].Tags).to.deep.include({ name: 'device', value: 'patch@1.0' })
    // Configuration patch includes Shares.Enabled
    const configTag = enableShareResult.Messages[0].Tags.find(
      (t: { name: string }) => t.name === 'configuration'
    )
    expect(configTag).to.exist
    expect(configTag.value.Shares.Enabled).to.equal(true)
    expect(enableShareResult.Messages[1].Data).to.equal('OK')

    const emptyShareResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Set-Share' }
      ],
      Data: JSON.stringify({ Share: '' })
    })
    expect(emptyShareResult.Error).to.be.a('string').that.includes('Number value required')

    const nullShareResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Set-Share' },
      ],
      Data: JSON.stringify({ Share: '1' })
    })
    expect(nullShareResult.Error).to.be.a('string').that.includes('Number value required')

    const largeShareResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
        { name: 'Action', value: 'Set-Share' }
      ],
      Data: JSON.stringify({ Share: 1.1 })
    })
    expect(largeShareResult.Error).to.be.a('string').that.includes('has to be <= 1')

    const smallShareResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
        { name: 'Action', value: 'Set-Share' }
      ],
      Data: JSON.stringify({ Share: -0.1 })
    })
    expect(smallShareResult.Error).to.be.a('string').that.includes('has to be >= 0')
  })
})

describe('Add-Scores assigns default share to new operators', () => {
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

  it('New operator receives Configuration.Shares.Default when shares are enabled', async () => {
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

    // Add scores for a new operator (BOB_ADDRESS)
    const result = await handle({
      From: OWNER_ADDRESS,
      Tags: [
        { name: 'Action', value: 'Add-Scores' },
        { name: 'Round-Timestamp', value: '10' }
      ],
      Data: refRound1
    })

    // Should have 2 messages: shares patch for new operator, OK response
    expect(result.Messages).to.have.lengthOf(2)
    expect(result.Messages[0].Tags).to.deep.include({ name: 'device', value: 'patch@1.0' })
    expect(result.Messages[1].Data).to.equal('OK')

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

    // Operator sets their own share to 0.3
    await handle({
      From: BOB_ADDRESS,
      Tags: [{ name: 'Action', value: 'Set-Share' }],
      Data: JSON.stringify({ Share: 0.3 })
    })

    // Add scores
    const result = await handle({
      From: OWNER_ADDRESS,
      Tags: [
        { name: 'Action', value: 'Add-Scores' },
        { name: 'Round-Timestamp', value: '10' }
      ],
      Data: refRound1
    })

    // Should only have 1 message: OK response (no shares patch since not a new operator)
    expect(result.Messages).to.have.lengthOf(1)
    expect(result.Messages[0].Data).to.equal('OK')

    // Verify operator kept their set share
    const stateResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [{ name: 'Action', value: 'View-State' }]
    })
    const state = JSON.parse(stateResult.Messages[0].Data)
    expect(state.Shares[BOB_ADDRESS]).to.equal(0.3)
  })

  it('Default share is persisted to StakingRewards.Shares for new operators', async () => {
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

    // Add scores for new operator
    await handle({
      From: OWNER_ADDRESS,
      Tags: [
        { name: 'Action', value: 'Add-Scores' },
        { name: 'Round-Timestamp', value: '10' }
      ],
      Data: refRound1
    })

    // Add scores again for same operator in a new round
    const result = await handle({
      From: OWNER_ADDRESS,
      Tags: [
        { name: 'Action', value: 'Add-Scores' },
        { name: 'Round-Timestamp', value: '20' }
      ],
      Data: refRound1
    })

    // Should only have 1 message this time (no new operator patch)
    expect(result.Messages).to.have.lengthOf(1)
    expect(result.Messages[0].Data).to.equal('OK')

    // Operator still has their persisted share
    const stateResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [{ name: 'Action', value: 'View-State' }]
    })
    const state = JSON.parse(stateResult.Messages[0].Data)
    expect(state.Shares[BOB_ADDRESS]).to.equal(0.2)
  })

  it('New operator gets share 0.0 when shares are disabled', async () => {
    // Shares are disabled by default
    const result = await handle({
      From: OWNER_ADDRESS,
      Tags: [
        { name: 'Action', value: 'Add-Scores' },
        { name: 'Round-Timestamp', value: '10' }
      ],
      Data: refRound1
    })

    // Only 1 message: OK response (no shares patch when disabled)
    expect(result.Messages).to.have.lengthOf(1)
    expect(result.Messages[0].Data).to.equal('OK')

    // Operator should not be in Shares state
    const stateResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [{ name: 'Action', value: 'View-State' }]
    })
    const state = JSON.parse(stateResult.Messages[0].Data)
    expect(state.Shares[BOB_ADDRESS]).to.be.undefined
  })

  it('Multiple new operators all receive default share', async () => {
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

    // Add scores for multiple hodlers staking with multiple operators
    const multiOperatorScores = JSON.stringify({
      Scores: {
        [ALICE_ADDRESS]: {
          [BOB_ADDRESS]: { Staked: '100', Running: 0.8 },
          [CHARLS_ADDRESS]: { Staked: '200', Running: 0.9 }
        }
      }
    })

    const result = await handle({
      From: OWNER_ADDRESS,
      Tags: [
        { name: 'Action', value: 'Add-Scores' },
        { name: 'Round-Timestamp', value: '10' }
      ],
      Data: multiOperatorScores
    })

    expect(result.Messages).to.have.lengthOf(2)

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