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
    expect(result.Error).to.be.a('string').that.includes('This method is only available to the Owner')
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
          { name: 'Timestamp', value: '' }
      ]
    })
    expect(emptyStampResult.Error).to.be.a('string').that.includes('Timestamp tag')

    const badStampResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Complete-Round' },
          { name: 'Timestamp', value: 'bad-stamp' }
      ]
    })
    expect(badStampResult.Error).to.be.a('string').that.includes('Timestamp tag')
  })

  it('Confirms pending round exists for given timestamp', async () => {
    const noRoundResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Complete-Round' },
          { name: 'Timestamp', value: '1000' }
      ]
    })
    expect(noRoundResult.Error).to.be.a('string').that.includes('No pending round for 1000')
  })

  it('Score Processing - Verify base network score assignment', async () => {
  const configResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Update-Configuration' }
      ],
      Data: JSON.stringify({
        TokensPerSecond: 123,
        Modifiers: {
          Network: {
            Share: 1
          }
        }
      })
    })
    expect(configResult.Messages).to.have.lengthOf(1)
    expect(configResult.Messages[0].Data).to.equal('OK')

    const noRoundResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Add-Scores' },
          { name: 'Timestamp', value: '1000' }
      ],
      Data: refRound1
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
          { name: 'Timestamp', value: '2000' }
      ],
      Data: refRound1
    })
    expect(scoredRoundResult.Messages).to.have.lengthOf(1)
    expect(scoredRoundResult.Messages[0].Data).to.equal('OK')

    const secondCompleteResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Complete-Round' },
          { name: 'Timestamp', value: '2000' }
      ]
    })
    expect(secondCompleteResult.Messages).to.have.lengthOf(1)
    expect(secondCompleteResult.Messages[0].Data).to.equal('OK')

    const rewardsForAliceResult = await handle({
      From: ALICE_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Get-Rewards' }
      ]
    })
    expect(rewardsForAliceResult.Messages).to.have.lengthOf(1)
    expect(rewardsForAliceResult.Messages[0].Data).to.equal('0.000000000000000000')
    
    const rewardsForBobResult = await handle({
      From: BOB_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Get-Rewards' }
      ]
    })
    expect(rewardsForBobResult.Messages).to.have.lengthOf(1)
    expect(rewardsForBobResult.Messages[0].Data).to.equal('0.000000000000000123')

    const thirdRoundResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Add-Scores' },
          { name: 'Timestamp', value: '3000' }
      ],
      Data: refRound1
    })
    expect(thirdRoundResult.Messages).to.have.lengthOf(1)
    expect(thirdRoundResult.Messages[0].Data).to.equal('OK')

    const thirdCompleteResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Complete-Round' },
          { name: 'Timestamp', value: '3000' }
      ]
    })
    expect(thirdCompleteResult.Messages).to.have.lengthOf(1)
    expect(thirdCompleteResult.Messages[0].Data).to.equal('OK')

    const aliceResult = await handle({
      From: ALICE_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Get-Rewards' }
      ]
    })
    expect(aliceResult.Messages).to.have.lengthOf(1)
    expect(aliceResult.Messages[0].Data).to.equal('0.000000000000000000')
    
    const bobResult = await handle({
      From: BOB_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Get-Rewards' }
      ]
    })
    expect(bobResult.Messages).to.have.lengthOf(1)
    expect(bobResult.Messages[0].Data).to.equal('0.000000000000000246')


    const aResult = await handle({
      From: ALICE_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Get-Rewards' },
          { name: 'Fingerprint', value: FINGERPRINT_A },
      ]
    })
    expect(aResult.Messages).to.have.lengthOf(1)
    expect(aResult.Messages[0].Data).to.equal('0.000000000000000000')
    
    const bResult = await handle({
      From: BOB_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Get-Rewards' },
          { name: 'Fingerprint', value: FINGERPRINT_B },
      ]
    })
    expect(bResult.Messages).to.have.lengthOf(1)
    expect(bResult.Messages[0].Data).to.equal('0.000000000000000246')
  })

})

// Score Processing
//     Family multiplier calculations
//         Check enabled/disabled state handling
//         Validate multiplier formula with offset and power
//         Ensure non-negative multiplier value
//     Location multiplier calculations
//         Check enabled/disabled state handling
//         Validate multiplier formula with offset and power
//         Ensure non-negative multiplier value

// Rating Calculations
//     Uptime Rating
//         Verify tier multiplier selection
//         Validate uptime streak calculations
//     Hardware Rating
//         Check enabled/disabled state handling
//         Verify hardware bonus calculation (65% network + 35% uptime)
//     Exit Bonus Rating
//         Check enabled/disabled state handling
//         Validate exit bonus assignment

// Reward Calculations
//     Round Length is correctly derived from previous timestamp
//     Token Distribution
//         Validate total rewards per second
//         Network rewards calculation
//         Hardware rewards calculation
//         Uptime rewards calculation
//         Exit bonus rewards calculation
//         Verify total shares don't exceed 100%
//     Per-Fingerprint Reward Distribution
//         Network weight computation
//         Hardware weight computation
//         Uptime weight computation
//         Exit bonus weight computation
//     Reward Assignment
//         Total reward summation
//         Verify delegate share calculation
//         Validate operator remainder
//     Update total reward tracking
//         Address rewards
//         Fingerprint rewards
// Round Completion
//     Previous round state update
//         Timestamp storage
//         Summary storage
//         Configuration storage
//         Details storage
//     Pending rounds cleanup
//     Removes outdated rounds