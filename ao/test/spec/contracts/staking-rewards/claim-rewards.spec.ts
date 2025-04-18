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

describe('Claiming staking rewards', () => {
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

  it('Tracks Claimed, rewarded tokens', async () => {
    const enableShareResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Toggle-Feature-Shares' }
      ],
      Data: JSON.stringify({ Enabled: true })
    })
    
    const configResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Update-Configuration' }
      ],
      Data: JSON.stringify({
        TokensPerSecond: '1000',
        Requirements: {
          Running: 0.5
        }
      })
    })
    expect(configResult.Messages).to.have.lengthOf(1)
    expect(configResult.Messages[0].Data).to.equal('OK')

    const shareResult = await handle({
      From: CHARLS_ADDRESS,
      Tags: [
        { name: 'Action', value: 'Set-Share' }
      ],
      Data: JSON.stringify({ Share: 0.1 })
    })

    const noRoundResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Add-Scores' },
          { name: 'Timestamp', value: '1000' }
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
          { name: 'Timestamp', value: '1000' }
      ]
    })
    expect(firstCompleteResult.Messages).to.have.lengthOf(1)
    expect(firstCompleteResult.Messages[0].Data).to.equal('OK')
    
    const scoredRoundResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Add-Scores' },
          { name: 'Timestamp', value: '11000' }
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
          { name: 'Timestamp', value: '11000' }
      ]
    })
    expect(secondCompleteResult.Messages).to.have.lengthOf(1)
    expect(secondCompleteResult.Messages[0].Data).to.equal('OK')

    const aResult = await handle({
      From: ALICE_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Get-Rewards' },
          { name: 'Address', value: ALICE_ADDRESS },
          { name: 'Timestamp', value: '11000' }
      ]
    })
    expect(aResult.Messages).to.have.lengthOf(1)
    const aData = JSON.parse(aResult.Messages[0].Data)
    expect(aData.Rewarded[BOB_ADDRESS]).to.equal('1666')
    expect(aData.Claimed.length).to.equal(0)
    
    const bResult = await handle({
      From: BOB_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Get-Rewards' },
          { name: 'Address', value: BOB_ADDRESS },
          { name: 'Timestamp', value: '11000' }
      ]
    })
    expect(bResult.Messages).to.have.lengthOf(1)
    const bData = JSON.parse(bResult.Messages[0].Data)
    expect(bData.Rewarded[CHARLS_ADDRESS]).to.equal('3000')
    expect(bData.Claimed.length).to.equal(0)

    const cResult = await handle({
      From: CHARLS_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Get-Rewards' },
          { name: 'Address', value: CHARLS_ADDRESS },
          { name: 'Timestamp', value: '11000' }
      ]
    })
    expect(cResult.Messages).to.have.lengthOf(1)
    const cData = JSON.parse(cResult.Messages[0].Data)
    expect(cData.Rewarded[CHARLS_ADDRESS]).to.equal('5333')
    expect(cData.Claimed.length).to.equal(0)

    const ClaimResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Claim-Rewards' },
          { name: 'Address', value: CHARLS_ADDRESS },
          { name: 'Timestamp', value: '11000' }
      ]
    })
    expect(ClaimResult.Messages).to.have.lengthOf(1)
    const ClaimData = JSON.parse(ClaimResult.Messages[0].Data)
    expect(ClaimData[CHARLS_ADDRESS]).to.equal('5333')

    // const ClaimResult1 = await handle({
    //   From: OWNER_ADDRESS,
    //   Tags: [
    //       { name: 'Action', value: 'Claim-Rewards' },
    //       { name: 'Address', value: ALICE_ADDRESS }
    //   ]
    // })
    // expect(ClaimResult1.Messages).to.have.lengthOf(1)
    // const ClaimData1 = JSON.parse(ClaimResult1.Messages[0].Data)
    // expect(ClaimData1[BOB_ADDRESS]).to.equal('1666')
    
    const ClaimResult2 = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Claim-Rewards' },
          { name: 'Address', value: BOB_ADDRESS },
          { name: 'Timestamp', value: '11000' }
      ]
    })
    expect(ClaimResult2.Messages).to.have.lengthOf(1)
    const ClaimData2 = JSON.parse(ClaimResult2.Messages[0].Data)
    expect(ClaimData2[CHARLS_ADDRESS]).to.equal('3000')

    
    const ClaimedResult = await handle({
      From: CHARLS_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Get-Claimed' },
          { name: 'Timestamp', value: '11000' }
      ]
    })
    expect(ClaimedResult.Messages).to.have.lengthOf(1)
    const ClaimedData = JSON.parse(ClaimedResult.Messages[0].Data)
    expect(ClaimedData[CHARLS_ADDRESS]).to.equal('5333')

    // const stateResult = await handle({
    //   From: OWNER_ADDRESS,
    //   Tags: [
    //       { name: 'Action', value: 'View-State' }
    //   ]
    // })
    // expect(stateResult.Messages).to.have.lengthOf(1)
    // const stateData = JSON.parse(stateResult.Messages[0].Data)
    // console.log(stateData)

    const scoredRoundResult2 = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Add-Scores' },
          { name: 'Timestamp', value: '21000' }
      ],
      Data: JSON.stringify({
        Scores: { 
          ...score1,
          ...score2,
          ...score3
        }
      })
    })
    expect(scoredRoundResult2.Messages).to.have.lengthOf(1)
    expect(scoredRoundResult2.Messages[0].Data).to.equal('OK')

    const thirdCompleteResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Complete-Round' },
          { name: 'Timestamp', value: '21000' }
      ]
    })
    expect(thirdCompleteResult.Messages).to.have.lengthOf(1)
    expect(thirdCompleteResult.Messages[0].Data).to.equal('OK')

    // const stateResult2 = await handle({
    //   From: OWNER_ADDRESS,
    //   Tags: [
    //       { name: 'Action', value: 'View-State' }
    //   ]
    // })
    // expect(stateResult2.Messages).to.have.lengthOf(1)
    // const stateData2 = JSON.parse(stateResult2.Messages[0].Data)
    // console.log(stateData2)

    const aResult2 = await handle({
      From: ALICE_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Get-Rewards' },
          { name: 'Address', value: ALICE_ADDRESS },
          { name: 'Timestamp', value: '21000' }
      ]
    })
    expect(aResult2.Messages).to.have.lengthOf(1)
    const aData2 = JSON.parse(aResult2.Messages[0].Data)
    expect(aData2.Rewarded[BOB_ADDRESS]).to.equal('5143') // includes reward for auto-restaked tokens that were not Claimed
    expect(aData2.Claimed.length).to.equal(0)

    const bResult2 = await handle({
      From: BOB_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Get-Rewards' },
          { name: 'Address', value: BOB_ADDRESS },
          { name: 'Timestamp', value: '21000' }
      ]
    })
    expect(bResult2.Messages).to.have.lengthOf(1)
    const bData2 = JSON.parse(bResult2.Messages[0].Data)
    expect(bData2.Rewarded[CHARLS_ADDRESS]).to.equal('5348')
    expect(bData2.Claimed[CHARLS_ADDRESS]).to.equal('3000')

    const cResult2 = await handle({
      From: CHARLS_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Get-Rewards' },
          { name: 'Address', value: CHARLS_ADDRESS },
          { name: 'Timestamp', value: '21000' }
      ]
    })
    expect(cResult2.Messages).to.have.lengthOf(1)
    const cData2 = JSON.parse(cResult2.Messages[0].Data)
    expect(cData2.Rewarded[CHARLS_ADDRESS]).to.equal('9506')
    expect(cData2.Claimed[CHARLS_ADDRESS]).to.equal('5333')

    const ClaimResult3 = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Claim-Rewards' },
          { name: 'Address', value: ALICE_ADDRESS },
          { name: 'Timestamp', value: '21000' }
      ]
    })
    expect(ClaimResult3.Messages).to.have.lengthOf(1)
    const ClaimData3 = JSON.parse(ClaimResult3.Messages[0].Data)
    expect(ClaimData3[BOB_ADDRESS]).to.equal('5143')

    const ClaimResult4 = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Claim-Rewards' },
          { name: 'Address', value: BOB_ADDRESS },
          { name: 'Timestamp', value: '21000' }
      ]
    })
    expect(ClaimResult4.Messages).to.have.lengthOf(1)
    const ClaimData4 = JSON.parse(ClaimResult4.Messages[0].Data)
    expect(ClaimData4[CHARLS_ADDRESS]).to.equal('5348')

    
    const ClaimedResult2 = await handle({
      From: BOB_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Get-Claimed' },
          { name: 'Timestamp', value: '21000' }
      ]
    })
    expect(ClaimedResult2.Messages).to.have.lengthOf(1)
    const ClaimedData2 = JSON.parse(ClaimedResult2.Messages[0].Data)
    expect(ClaimedData2[CHARLS_ADDRESS]).to.equal('5348')
    
    const ClaimedResult3 = await handle({
      From: ALICE_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Get-Claimed' },
          { name: 'Timestamp', value: '21000' }
      ]
    })
    expect(ClaimedResult3.Messages).to.have.lengthOf(1)
    const ClaimedData3 = JSON.parse(ClaimedResult3.Messages[0].Data)
    expect(ClaimedData3[BOB_ADDRESS]).to.equal('5143')



  })

})
