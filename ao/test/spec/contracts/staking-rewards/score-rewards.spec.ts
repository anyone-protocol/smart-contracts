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

describe('Calculating staking rewards based on ratings', () => {
  let handle: AOTestHandle

  let score1 = { [ALICE_ADDRESS]: { [BOB_ADDRESS]: {
    Staked: '1000', Running: 0.6
  }}}
    
  let score2 = { [BOB_ADDRESS]: { [CHARLS_ADDRESS]: {
    Staked: '2000', Running: 0.7
  }}}

  let score3 = { [CHARLS_ADDRESS]: { [CHARLS_ADDRESS]: {
    Staked: '3000', Running: 0.8
  }}}

  beforeEach(async () => {
    handle = (await createLoader('staking-rewards')).handle
  })

  it('Calculates a correct period since the last round', async () => {
    const config = {
      TokensPerSecond: '1000',
      Requirements: { Running: 0.5 }
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
          { name: 'Round-Timestamp', value: '1000' }
      ],
      Data: JSON.stringify({
        Scores: score1
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
          { name: 'Round-Timestamp', value: '2345' }
      ],
      Data: JSON.stringify({
        Scores: score1
      })
    })
    expect(scoredRoundResult.Messages).to.have.lengthOf(1)
    expect(scoredRoundResult.Messages[0].Data).to.equal('OK')

    const secondCompleteResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Complete-Round' },
          { name: 'Round-Timestamp', value: '2345' }
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
    expect(summary2data.Timestamp).to.equal(2345)
    expect(summary2data.Period).to.equal(Math.floor((2345 - 1000) / 1000))

    const scoredRound3Result = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Add-Scores' },
          { name: 'Round-Timestamp', value: '40000' }
      ],
      Data: JSON.stringify({
        Scores: score1
      })
    })
    expect(scoredRound3Result.Messages).to.have.lengthOf(1)
    expect(scoredRound3Result.Messages[0].Data).to.equal('OK')

    const thirdCompleteResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Complete-Round' },
          { name: 'Round-Timestamp', value: '40000' }
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
    expect(summary3data.Timestamp).to.equal(40000)
    expect(summary3data.Period).to.equal(Math.floor((40000 - 2345) / 1000))
  })

  it('Proportionally rewards hodlers based on their rating', async () => {
    const enableShareResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Toggle-Feature-Shares' }
      ],
      Data: JSON.stringify({ Enabled: true })
    })
    expect(enableShareResult.Messages).to.have.lengthOf(2)
    expect(enableShareResult.Messages[0].Tags).to.deep.include({ name: 'device', value: 'patch@1.0' })
    const enableConfigTag = enableShareResult.Messages[0].Tags.find(
      (t: { name: string }) => t.name === 'configuration'
    )
    expect(enableConfigTag).to.exist
    expect(enableConfigTag.value.Shares.Enabled).to.equal(true)
    expect(enableShareResult.Messages[1].Data).to.equal('OK')

    const config = {
      TokensPerSecond: '1000',
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

    const shareResult = await handle({
      From: CHARLS_ADDRESS,
      Tags: [
        { name: 'Action', value: 'Set-Share' }
      ],
      Data: JSON.stringify({ Share: 0.1 })
    })
    expect(shareResult.Messages).to.have.lengthOf(2)
    expect(shareResult.Messages[0].Tags).to.deep.include({
      name: 'device',
      value: 'patch@1.0'
    })
    expect(shareResult.Messages[0].Tags).to.deep.include({
      name: 'shares',
      value: {
        [CHARLS_ADDRESS]: 0.1
      }
    })
    expect(shareResult.Messages[1].Data).to.equal('OK')

    const noRoundResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Add-Scores' },
          { name: 'Round-Timestamp', value: '1000' }
      ],
      Data: JSON.stringify({
        Scores: score1
      })
    })
    // 2 messages: shares patch (new operator gets default share), OK response
    expect(noRoundResult.Messages).to.have.lengthOf(2)
    expect(noRoundResult.Messages[0].Tags).to.deep.include({ name: 'device', value: 'patch@1.0' })
    expect(noRoundResult.Messages[1].Data).to.equal('OK')

    const firstCompleteResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Complete-Round' },
          { name: 'Round-Timestamp', value: '1000' }
      ]
    })
    expect(firstCompleteResult.Messages).to.have.lengthOf(2)
    expect(firstCompleteResult.Messages[0].Tags).to.deep.include({
      name: 'device',
      value: 'patch@1.0'
    })
    expect(firstCompleteResult.Messages[0].Tags).to.deep.include({
      name: 'rewarded',
      value: {
        [ALICE_ADDRESS]: [],
        [BOB_ADDRESS]: []
      }
    })
    const prevRoundTag = firstCompleteResult.Messages[0].Tags.find(
      (t: { name: string }) => t.name === 'previous_round'
    )
    expect(prevRoundTag).to.exist
    expect(prevRoundTag.value.Timestamp).to.equal(1000)
    expect(prevRoundTag.value.Period).to.equal(0)
    expect(prevRoundTag.value.Summary).to.deep.equal({
      Ratings: '1000',
      Stakes: '1000',
      Rewards: '0'
    })
    expect(prevRoundTag.value.Details[ALICE_ADDRESS][BOB_ADDRESS]).to.deep.equal({
      Reward: { Operator: '0', Hodler: '0' },
      Rating: '1000',
      Score: { Running: 0.6, Restaked: '0', Staked: '1000', Share: 0 }
    })
    expect(prevRoundTag.value.Configuration.TokensPerSecond).to.equal('1000')
    expect(prevRoundTag.value.Configuration.Requirements.Running).to.equal(0.5)
    expect(firstCompleteResult.Messages[1].Data).to.equal('OK')
    
    const scoredRoundResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Add-Scores' },
          { name: 'Round-Timestamp', value: '11000' }
      ],
      Data: JSON.stringify({
        Scores: { 
          ...score1,
          ...score2,
          ...score3
        }
      })
    })
    expect(scoredRoundResult.Messages).to.have.lengthOf(1)
    expect(scoredRoundResult.Messages[0].Data).to.equal('OK')

    const secondCompleteResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Complete-Round' },
          { name: 'Round-Timestamp', value: '11000' }
      ]
    })
    expect(secondCompleteResult.Messages).to.have.lengthOf(2)
    expect(secondCompleteResult.Messages[0].Tags).to.deep.include({
      name: 'device',
      value: 'patch@1.0'
    })
    expect(secondCompleteResult.Messages[0].Tags).to.deep.include({
      name: 'rewarded',
      value: {
        [CHARLS_ADDRESS]: { [CHARLS_ADDRESS]: '5333' },
        [BOB_ADDRESS]: { [CHARLS_ADDRESS]: '3000' },
        [ALICE_ADDRESS]: { [BOB_ADDRESS]: '1666' }
      }
    })
    const prevRoundTag2 = secondCompleteResult.Messages[0].Tags.find(
      (t: { name: string }) => t.name === 'previous_round'
    )
    expect(prevRoundTag2).to.exist
    expect(prevRoundTag2.value.Timestamp).to.equal(11000)
    expect(prevRoundTag2.value.Period).to.equal(10)
    expect(prevRoundTag2.value.Summary).to.deep.equal({
      Ratings: '6000',
      Stakes: '6000',
      Rewards: '9999'
    })
    expect(prevRoundTag2.value.Details[ALICE_ADDRESS][BOB_ADDRESS]).to.deep.equal({
      Reward: { Hodler: '1666', Operator: '0' },
      Rating: '1000',
      Score: { Running: 0.6, Restaked: '0', Staked: '1000', Share: 0 }
    })
    expect(prevRoundTag2.value.Details[BOB_ADDRESS][CHARLS_ADDRESS]).to.deep.equal({
      Reward: { Hodler: '3000', Operator: '333' },
      Rating: '2000',
      Score: { Running: 0.7, Restaked: '0', Staked: '2000', Share: 0.1 }
    })
    expect(prevRoundTag2.value.Details[CHARLS_ADDRESS][CHARLS_ADDRESS]).to.deep.equal({
      Reward: { Hodler: '4500', Operator: '500' },
      Rating: '3000',
      Score: { Running: 0.8, Restaked: '0', Staked: '3000', Share: 0.1 }
    })
    expect(prevRoundTag2.value.Configuration.TokensPerSecond).to.equal('1000')
    expect(prevRoundTag2.value.Configuration.Requirements.Running).to.equal(0.5)
    expect(secondCompleteResult.Messages[1].Data).to.equal('OK')

    const summary2 = await handle({
      From: ALICE_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Last-Round-Metadata' }
      ]
    })
    expect(summary2.Messages).to.have.lengthOf(1)
    const summary2data = JSON.parse(summary2.Messages[0].Data)
    expect(summary2data.Timestamp).to.equal(11000)
    expect(summary2data.Period).to.equal(10)
    expect(summary2data.Summary.Ratings).to.equal('6000')
    expect(summary2data.Summary.Stakes).to.equal('6000')
    expect(summary2data.Summary.Rewards).to.equal('9999')

    const aResult = await handle({
      From: ALICE_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Last-Round-Data' }
      ]
    })
    expect(aResult.Messages).to.have.lengthOf(1)
    const aData = JSON.parse(aResult.Messages[0].Data)
    expect(aData.Timestamp).to.equal(11000)
    expect(aData.Period).to.equal(10)
    expect(aData.Details[BOB_ADDRESS].Score.Staked).to.equal('1000')
    expect(aData.Details[BOB_ADDRESS].Score.Running).to.equal(0.6)
    expect(aData.Details[BOB_ADDRESS].Score.Share).to.equal(0)
    expect(aData.Details[BOB_ADDRESS].Rating).to.equal('1000')
    expect(aData.Details[BOB_ADDRESS].Reward.Hodler).to.equal('1666')
    expect(aData.Details[BOB_ADDRESS].Reward.Operator).to.equal('0')

    const bResult = await handle({
      From: ALICE_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Last-Round-Data' },
          { name: 'Address', value: BOB_ADDRESS }
      ]
    })
    expect(bResult.Messages).to.have.lengthOf(1)
    const bData = JSON.parse(bResult.Messages[0].Data)
    expect(bData.Timestamp).to.equal(11000)
    expect(bData.Period).to.equal(10)
    expect(bData.Details[CHARLS_ADDRESS].Score.Staked).to.equal('2000')
    expect(bData.Details[CHARLS_ADDRESS].Score.Running).to.equal(0.7)
    expect(bData.Details[CHARLS_ADDRESS].Score.Share).to.equal(0.1)
    expect(bData.Details[CHARLS_ADDRESS].Rating).to.equal('2000')
    expect(bData.Details[CHARLS_ADDRESS].Reward.Hodler).to.equal('3000')
    expect(bData.Details[CHARLS_ADDRESS].Reward.Operator).to.equal('333')

    const cResult = await handle({
      From: ALICE_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Last-Round-Data' },
          { name: 'Address', value: CHARLS_ADDRESS }
      ]
    })
    expect(cResult.Messages).to.have.lengthOf(1)
    const cData = JSON.parse(cResult.Messages[0].Data)
    expect(cData.Timestamp).to.equal(11000)
    expect(cData.Period).to.equal(10)
    expect(cData.Details[CHARLS_ADDRESS].Score.Staked).to.equal('3000')
    expect(cData.Details[CHARLS_ADDRESS].Score.Running).to.equal(0.8)
    expect(cData.Details[CHARLS_ADDRESS].Score.Share).to.equal(0.1)
    expect(cData.Details[CHARLS_ADDRESS].Rating).to.equal('3000')
    expect(cData.Details[CHARLS_ADDRESS].Reward.Hodler).to.equal('4500')
    expect(cData.Details[CHARLS_ADDRESS].Reward.Operator).to.equal('500')
  })

  it('Accumulates rewards for hodlers and operators', async () => {
    const enableShareResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Toggle-Feature-Shares' }
      ],
      Data: JSON.stringify({ Enabled: true })
    })
    expect(enableShareResult.Messages).to.have.lengthOf(2)
    expect(enableShareResult.Messages[0].Tags).to.deep.include({ name: 'device', value: 'patch@1.0' })
    const enableConfigTag2 = enableShareResult.Messages[0].Tags.find(
      (t: { name: string }) => t.name === 'configuration'
    )
    expect(enableConfigTag2).to.exist
    expect(enableConfigTag2.value.Shares.Enabled).to.equal(true)
    expect(enableShareResult.Messages[1].Data).to.equal('OK')

    const config = {
      TokensPerSecond: '1000',
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

    const shareResult = await handle({
      From: CHARLS_ADDRESS,
      Tags: [
        { name: 'Action', value: 'Set-Share' }
      ],
      Data: JSON.stringify({ Share: 0.1 })
    })
    expect(shareResult.Messages).to.have.lengthOf(2)
    expect(shareResult.Messages[0].Tags).to.deep.include({
      name: 'device',
      value: 'patch@1.0'
    })
    expect(shareResult.Messages[0].Tags).to.deep.include({
      name: 'shares',
      value: {
        [CHARLS_ADDRESS]: 0.1
      }
    })
    expect(shareResult.Messages[1].Data).to.equal('OK')
    
    const noRoundResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Add-Scores' },
          { name: 'Round-Timestamp', value: '1000' }
      ],
      Data: JSON.stringify({
        Scores: score1
      })
    })
    // 2 messages: shares patch (new operator gets default share), OK response
    expect(noRoundResult.Messages).to.have.lengthOf(2)
    expect(noRoundResult.Messages[0].Tags).to.deep.include({ name: 'device', value: 'patch@1.0' })
    expect(noRoundResult.Messages[1].Data).to.equal('OK')

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
          { name: 'Round-Timestamp', value: '11000' }
      ],
      Data: JSON.stringify({
        Scores: { 
          ...score1,
          ...score2,
          ...score3
        }
      })
    })
    expect(scoredRoundResult.Messages).to.have.lengthOf(1)
    expect(scoredRoundResult.Messages[0].Data).to.equal('OK')

    const secondCompleteResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Complete-Round' },
          { name: 'Round-Timestamp', value: '11000' }
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
    expect(summary2data.Timestamp).to.equal(11000)
    expect(summary2data.Period).to.equal(10)
    expect(summary2data.Summary.Rewards).to.equal('9999')

    const aResult = await handle({
      From: ALICE_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Get-Rewards' }
      ]
    })
    expect(aResult.Messages).to.have.lengthOf(1)
    const aData = JSON.parse(aResult.Messages[0].Data)
    expect(aData.Rewarded[BOB_ADDRESS]).to.equal('1666')

    const bResult = await handle({
      From: BOB_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Get-Rewards' }
      ]
    })
    expect(bResult.Messages).to.have.lengthOf(1)
    const bData = JSON.parse(bResult.Messages[0].Data)
    expect(bData.Rewarded[CHARLS_ADDRESS]).to.equal('3000')

    const cResult = await handle({
      From: CHARLS_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Get-Rewards' }
      ]
    })
    expect(cResult.Messages).to.have.lengthOf(1)
    const cData = JSON.parse(cResult.Messages[0].Data)
    expect(cData.Rewarded[CHARLS_ADDRESS]).to.equal('5333')

    const thirdRoundResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Add-Scores' },
          { name: 'Round-Timestamp', value: '21000' }
      ],
      Data: JSON.stringify({
        Scores: { 
          ...score1,
          ...score2,
          ...score3
        }
      })
    })
    expect(thirdRoundResult.Messages).to.have.lengthOf(1)
    expect(thirdRoundResult.Messages[0].Data).to.equal('OK')

    const thirdCompleteResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Complete-Round' },
          { name: 'Round-Timestamp', value: '21000' }
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
    expect(summary3data.Timestamp).to.equal(21000)
    expect(summary3data.Period).to.equal(10)
    expect(summary3data.Summary.Rewards).to.equal('9999')

    const a2Result = await handle({
      From: ALICE_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Get-Rewards' }
      ]
    })
    expect(a2Result.Messages).to.have.lengthOf(1)
    const a2Data = JSON.parse(a2Result.Messages[0].Data)
    expect(a2Data.Rewarded[BOB_ADDRESS]).to.equal('3332')

    const b2Result = await handle({
      From: BOB_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Get-Rewards' }
      ]
    })
    expect(b2Result.Messages).to.have.lengthOf(1)
    const b2Data = JSON.parse(b2Result.Messages[0].Data)
    expect(b2Data.Rewarded[CHARLS_ADDRESS]).to.equal('5813')

    const c2Result = await handle({
      From: CHARLS_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Get-Rewards' }
      ]
    })
    expect(c2Result.Messages).to.have.lengthOf(1)
    const c2Data = JSON.parse(c2Result.Messages[0].Data)
    expect(c2Data.Rewarded[CHARLS_ADDRESS]).to.equal('10853')
  })


})
