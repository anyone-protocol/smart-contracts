import { expect } from 'chai'

import {
    ALICE_ADDRESS,
    BOB_ADDRESS,
    CHARLS_ADDRESS,
    AOTestHandle,
    ConfigurationPatchTag,
    createLoader,
    FINGERPRINT_A,
    FINGERPRINT_B,
    FINGERPRINT_C,
    OWNER_ADDRESS
  } from '~/test/util/setup'

describe('Score ratings of staking rewards', () => {
  let handle: AOTestHandle

  beforeEach(async () => {
    handle = (await createLoader('staking-rewards')).handle
  })

  it('Calculate ratings only for scores passing the running requirement', async () => {
    const config = {
      TokensPerSecond: '1000',
      Requirements: {
        Running: 0.5,
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
    expect(cfgTag!.value.Shares.Default).to.equal(0.05)
    expect(configResult.Messages[1].Data).to.equal('OK')

    const noRoundResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Add-Scores' },
          { name: 'Round-Timestamp', value: '1000' }
      ],
      Data: JSON.stringify({
        Scores: { [ALICE_ADDRESS]: {
          [BOB_ADDRESS]: {
            Staked: '1000',
            Running: 0.7,
            Share: 0
          }
        } }
      })
    })
    expect(noRoundResult.Messages).to.have.lengthOf(1)
    expect(noRoundResult.Messages[0].Data).to.equal('OK')

    const firstCompleteResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Complete-Round' },
          { name: 'Round-Timestamp', value: '1000' }
      ]
    })
    expect(firstCompleteResult.Messages).to.have.lengthOf(2)
    expect(firstCompleteResult.Messages[0].Tags).to.deep.include({ name: 'device', value: 'patch@1.0' })
    expect(firstCompleteResult.Messages[1].Data).to.equal('OK')
    
    const scoredRoundResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Add-Scores' },
          { name: 'Round-Timestamp', value: '2000' }
      ],
      Data: JSON.stringify({
        Scores: { 
          [ALICE_ADDRESS]: {
            [BOB_ADDRESS]: {
              Staked: '1000',
              Running: 0.7,
              Share: 0
            }
          },
          [BOB_ADDRESS]: {
            [CHARLS_ADDRESS]: {
              Staked: '1000',
              Running: 0.3,
              Share: 0
            }
          }
        }
      })
    })
    expect(scoredRoundResult.Messages).to.have.lengthOf(1)
    expect(scoredRoundResult.Messages[0].Data).to.equal('OK')

    const secondCompleteResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Complete-Round' },
          { name: 'Round-Timestamp', value: '2000' }
      ]
    })
    expect(secondCompleteResult.Messages).to.have.lengthOf(2)
    expect(secondCompleteResult.Messages[0].Tags).to.deep.include({ name: 'device', value: 'patch@1.0' })
    expect(secondCompleteResult.Messages[1].Data).to.equal('OK')

    const summary2 = await handle({
      From: ALICE_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Last-Round-Metadata' }
      ]
    })
    
    expect(summary2.Messages).to.have.lengthOf(1)
    const summary2data = JSON.parse(summary2.Messages[0].Data)
    expect(summary2data.Summary.Rewards).to.equal('1000')
    expect(summary2data.Summary.Ratings).to.equal('1000') 
    expect(summary2data.Summary.Stakes).to.equal('2000') 
    
    const rewards2ForAliceResult = await handle({
      From: ALICE_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Last-Round-Data' }
      ]
    })
    expect(rewards2ForAliceResult.Messages).to.have.lengthOf(1)
    const alice2data = JSON.parse(rewards2ForAliceResult.Messages[0].Data)
    expect(alice2data.Details[BOB_ADDRESS].Score.Staked).to.equal('1000')
    expect(alice2data.Details[BOB_ADDRESS].Score.Restaked).to.equal('0')
    expect(alice2data.Details[BOB_ADDRESS].Rating).to.equal('1000')
    expect(alice2data.Details[BOB_ADDRESS].Reward.Hodler).to.equal('1000')
    
    const rewards2ForBobResult = await handle({
      From: BOB_ADDRESS,
      Tags: [
        { name: 'Action', value: 'Last-Round-Data' }
      ]
    })
    
    expect(rewards2ForBobResult.Messages).to.have.lengthOf(1)
    const bob2data = JSON.parse(rewards2ForBobResult.Messages[0].Data)
    expect(bob2data.Details[CHARLS_ADDRESS].Score.Staked).to.equal('1000')
    expect(bob2data.Details[CHARLS_ADDRESS].Rating).to.equal('0')
    expect(bob2data.Details[CHARLS_ADDRESS].Reward.Hodler).to.equal('0')

    const thirdRoundResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Add-Scores' },
          { name: 'Round-Timestamp', value: '3000' }
      ],
      Data: JSON.stringify({
        Scores: { 
          [ALICE_ADDRESS]: {
            [BOB_ADDRESS]: {
              Staked: '1000',
              Running: 0.1,
              Share: 0
            }
          },
          [BOB_ADDRESS]: {
            [CHARLS_ADDRESS]: {
              Staked: '1000',
              Running: 0.8,
              Share: 0
            }
          }
        }
      })
    })
    expect(thirdRoundResult.Messages).to.have.lengthOf(1)
    expect(thirdRoundResult.Messages[0].Data).to.equal('OK')

    const thirdCompleteResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Complete-Round' },
          { name: 'Round-Timestamp', value: '3000' }
      ]
    })
    expect(thirdCompleteResult.Messages).to.have.lengthOf(2)
    expect(thirdCompleteResult.Messages[0].Tags).to.deep.include({ name: 'device', value: 'patch@1.0' })
    expect(thirdCompleteResult.Messages[1].Data).to.equal('OK')

    const summary3 = await handle({
      From: ALICE_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Last-Round-Metadata' }
      ]
    })
    
    expect(summary3.Messages).to.have.lengthOf(1)
    const summary3data = JSON.parse(summary3.Messages[0].Data)
    expect(summary3data.Summary.Stakes).to.equal('2000') 
    expect(summary3data.Summary.Ratings).to.equal('1000') 
    expect(summary3data.Summary.Rewards).to.equal('1000')

    const rewards3ForAliceResult = await handle({
      From: ALICE_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Last-Round-Data' }
      ]
    })
    expect(rewards3ForAliceResult.Messages).to.have.lengthOf(1)
    const alice3data = JSON.parse(rewards3ForAliceResult.Messages[0].Data)
    expect(alice3data.Details[BOB_ADDRESS].Score.Staked).to.equal('1000')
    expect(alice3data.Details[BOB_ADDRESS].Rating).to.equal('0')
    expect(alice3data.Details[BOB_ADDRESS].Reward.Hodler).to.equal('0')
    
    const rewards3ForBobResult = await handle({
      From: BOB_ADDRESS,
      Tags: [
        { name: 'Action', value: 'Last-Round-Data' }
      ]
    })
    
    expect(rewards3ForBobResult.Messages).to.have.lengthOf(1)
    const bob3data = JSON.parse(rewards3ForBobResult.Messages[0].Data)
    expect(bob3data.Details[CHARLS_ADDRESS].Rating).to.equal('1000')
    expect(bob3data.Details[CHARLS_ADDRESS].Reward.Hodler).to.equal('1000')
    expect(bob3data.Details[CHARLS_ADDRESS].Score.Staked).to.equal('1000')

    const restakingRoundResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Add-Scores' },
          { name: 'Round-Timestamp', value: '4000' }
      ],
      Data: JSON.stringify({
        Scores: { 
          [ALICE_ADDRESS]: {
            [BOB_ADDRESS]: {
              Staked: '1000',
              Running: 0.8,
              Share: 0
            }
          },
          [BOB_ADDRESS]: {
            [CHARLS_ADDRESS]: {
              Staked: '1000',
              Running: 0.8,
              Share: 0
            }
          }
        }
      })
    })
    expect(restakingRoundResult.Messages).to.have.lengthOf(1)
    expect(restakingRoundResult.Messages[0].Data).to.equal('OK')

    const restakingCompleteResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Complete-Round' },
          { name: 'Round-Timestamp', value: '4000' }
      ]
    })
    expect(restakingCompleteResult.Messages).to.have.lengthOf(2)
    expect(restakingCompleteResult.Messages[0].Tags).to.deep.include({ name: 'device', value: 'patch@1.0' })
    expect(restakingCompleteResult.Messages[1].Data).to.equal('OK')

    const summary4 = await handle({
      From: ALICE_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Last-Round-Metadata' }
      ]
    })
    
    expect(summary4.Messages).to.have.lengthOf(1)
    const summary4data = JSON.parse(summary4.Messages[0].Data)
    expect(summary4data.Summary.Stakes).to.equal('4000') 
    expect(summary4data.Summary.Ratings).to.equal('4000') 
    expect(summary4data.Summary.Rewards).to.equal('1000')

    const rewards4ForAliceResult = await handle({
      From: ALICE_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Last-Round-Data' }
      ]
    })
    expect(rewards4ForAliceResult.Messages).to.have.lengthOf(1)
    const alice4data = JSON.parse(rewards4ForAliceResult.Messages[0].Data)
    expect(alice4data.Details[BOB_ADDRESS].Score.Staked).to.equal('1000')
    expect(alice4data.Details[BOB_ADDRESS].Score.Restaked).to.equal('1000')
    expect(alice4data.Details[BOB_ADDRESS].Rating).to.equal('2000')
    expect(alice4data.Details[BOB_ADDRESS].Reward.Hodler).to.equal('500')
    
    const rewards4ForBobResult = await handle({
      From: BOB_ADDRESS,
      Tags: [
        { name: 'Action', value: 'Last-Round-Data' }
      ]
    })
    
    expect(rewards4ForBobResult.Messages).to.have.lengthOf(1)
    const bob4data = JSON.parse(rewards4ForBobResult.Messages[0].Data)
    expect(bob4data.Details[CHARLS_ADDRESS].Rating).to.equal('2000')
    expect(bob4data.Details[CHARLS_ADDRESS].Reward.Hodler).to.equal('500')
    expect(bob4data.Details[CHARLS_ADDRESS].Score.Staked).to.equal('1000')
    expect(bob4data.Details[CHARLS_ADDRESS].Score.Restaked).to.equal('1000')

  }).timeout(5000)
})