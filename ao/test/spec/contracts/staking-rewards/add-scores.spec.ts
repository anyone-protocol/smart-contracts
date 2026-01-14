import { expect } from 'chai'

import {
  ALICE_ADDRESS,
  BOB_ADDRESS,
  AOTestHandle,
  ConfigurationPatchTag,
  createLoader,
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
    ) as ConfigurationPatchTag | undefined
    expect(cfgTag).to.exist
    expect(cfgTag!.value.TokensPerSecond).to.equal(config.TokensPerSecond)
    expect(cfgTag!.value.Requirements.Running).to.equal(config.Requirements.Running)
    expect(cfgTag!.value.Shares.Enabled).to.equal(false)
    expect(cfgTag!.value.Shares.Min).to.equal(0.0)
    expect(cfgTag!.value.Shares.Max).to.equal(1.0)
    expect(cfgTag!.value.Shares.Default).to.equal(0.0)
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
    ) as ConfigurationPatchTag | undefined
    expect(configTag).to.exist
    expect(configTag!.value.Shares.Enabled).to.equal(true)
    expect(configTag!.value.Shares.Min).to.equal(0.0)
    expect(configTag!.value.Shares.Max).to.equal(1.0)
    expect(configTag!.value.Shares.Default).to.equal(0.0)
    expect(enableShareResult.Messages[1].Data).to.equal('OK')

    // Enable SetSharesEnabled for operators to call Set-Share
    await handle({
      From: OWNER_ADDRESS,
      Tags: [{ name: 'Action', value: 'Update-Shares-Configuration' }],
      Data: JSON.stringify({ SetSharesEnabled: true })
    })

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
