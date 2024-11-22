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

describe('Score ratings of relay rewards', () => {
  let handle: AOTestHandle

  let score1 = { Address: ALICE_ADDRESS, Network: 100, IsHardware: false, 
    UptimeStreak: 0, ExitBonus: false, FamilySize: 0, LocationSize: 0
  }
  let score1WithHw = { Address: ALICE_ADDRESS, Network: 100, IsHardware: true, 
    UptimeStreak: 0, ExitBonus: false, FamilySize: 0, LocationSize: 0
  }
  let score1WithHwUptime3 = { Address: ALICE_ADDRESS, Network: 100, IsHardware: true, 
    UptimeStreak: 3, ExitBonus: false, FamilySize: 0, LocationSize: 0
  }
  let score1WithHwUptime14 = { Address: ALICE_ADDRESS, Network: 100, IsHardware: true, 
    UptimeStreak: 14, ExitBonus: false, FamilySize: 0, LocationSize: 0
  }
  let score1WithExit = { Address: ALICE_ADDRESS, Network: 100, IsHardware: false, 
    UptimeStreak: 0, ExitBonus: true, FamilySize: 0, LocationSize: 0
  }
  let score2WithUptime3 = { Address: BOB_ADDRESS, Network: 200, IsHardware: false, 
    UptimeStreak: 3, ExitBonus: false, FamilySize: 0, LocationSize: 0
  }
  let score2WithUptime14 = { Address: BOB_ADDRESS, Network: 200, IsHardware: false, 
    UptimeStreak: 14, ExitBonus: false, FamilySize: 0, LocationSize: 0
  }

  beforeEach(async () => {
    handle = (await createLoader('relay-rewards')).handle
  })

  it('Calculate uptime ratings with uptime streak tiers', async () => {
    const configResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Update-Configuration' }
      ],
      Data: JSON.stringify({
        TokensPerSecond: 1000,
        Modifiers: {
          Network: {
            Share: 0.9
          },
          Hardware: {
            Enabled: true,
            Share: 0
          },
          Uptime: {
            Enabled: true,
            Share: 0.1,
            Tiers: {
              '0': 0,
              '3': 1,
              '14': 3
            }
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
      Data: JSON.stringify({
        Scores: { [FINGERPRINT_A]: score1 }
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
          { name: 'Timestamp', value: '2000' }
      ],
      Data: JSON.stringify({
        Scores: { 
          [FINGERPRINT_A]: score1WithHw,
          [FINGERPRINT_B]: score2WithUptime3
        }
      })
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

    const summary2 = await handle({
      From: ALICE_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Last-Round-Metadata' }
      ]
    })
    
    expect(summary2.Messages).to.have.lengthOf(1)
    const summary2data = JSON.parse(summary2.Messages[0].Data)
    // bob uptime 3 no hw, alice uptime 0 with hw
    expect(summary2data.Summary.Rewards.Uptime).to.equal(0)
    expect(summary2data.Summary.Ratings.Uptime).to.equal(0) 
    const rewards2ForAliceResult = await handle({
      From: ALICE_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Last-Round-Data' },
          { name: 'Fingerprint', value: FINGERPRINT_A }
      ]
    })
    expect(rewards2ForAliceResult.Messages).to.have.lengthOf(1)
    const alice2data = JSON.parse(rewards2ForAliceResult.Messages[0].Data)
    expect(alice2data.Details.Rating.Uptime).to.equal(0)
    expect(alice2data.Details.Reward.Uptime).to.equal(0)
    
    const rewards2ForBobResult = await handle({
      From: BOB_ADDRESS,
      Tags: [
        { name: 'Action', value: 'Last-Round-Data' },
        { name: 'Fingerprint', value: FINGERPRINT_B }
      ]
    })
    
    expect(rewards2ForBobResult.Messages).to.have.lengthOf(1)
    const bob2data = JSON.parse(rewards2ForBobResult.Messages[0].Data)
    expect(bob2data.Details.Rating.Uptime).to.equal(0)
    expect(bob2data.Details.Reward.Uptime).to.equal(0)
    expect(bob2data.Details.Reward.Network).to.equal(600)
    expect(bob2data.Details.Reward.Total).to.equal(600)

    const thirdRoundResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Add-Scores' },
          { name: 'Timestamp', value: '3000' }
      ],
      Data: JSON.stringify({
        Scores: { 
          [FINGERPRINT_A]: score1WithHwUptime3,
          [FINGERPRINT_B]: score2WithUptime14
        }
      })
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

    const summary3 = await handle({
      From: ALICE_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Last-Round-Metadata' }
      ]
    })
    
    expect(summary3.Messages).to.have.lengthOf(1)
    const summary3data = JSON.parse(summary3.Messages[0].Data)
    expect(summary3data.Summary.Ratings.Uptime).to.equal(1) 
    expect(summary3data.Summary.Rewards.Uptime).to.equal(100)

    // bob uptime 14 no hw, alice uptime 3 with hw
    const rewards3ForAliceResult = await handle({
      From: ALICE_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Last-Round-Data' },
          { name: 'Fingerprint', value: FINGERPRINT_A }
      ]
    })
    expect(rewards3ForAliceResult.Messages).to.have.lengthOf(1)
    const alice3data = JSON.parse(rewards3ForAliceResult.Messages[0].Data)
    expect(alice3data.Details.Rating.Uptime).to.equal(1)
    expect(alice3data.Details.Reward.Uptime).to.equal(100)
    
    const rewards3ForBobResult = await handle({
      From: BOB_ADDRESS,
      Tags: [
        { name: 'Action', value: 'Last-Round-Data' },
        { name: 'Fingerprint', value: FINGERPRINT_B }
      ]
    })
    
    expect(rewards3ForBobResult.Messages).to.have.lengthOf(1)
    const bob3data = JSON.parse(rewards3ForBobResult.Messages[0].Data)
    expect(bob3data.Details.Rating.Uptime).to.equal(0)
    expect(bob3data.Details.Reward.Uptime).to.equal(0)
    expect(bob3data.Details.Reward.Network).to.equal(600)
    expect(bob3data.Details.Reward.Total).to.equal(600)
  })

  it('Calculate hardware bonus (65% network + 35% uptime)', async () => {
    const configResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Update-Configuration' }
      ],
      Data: JSON.stringify({
        TokensPerSecond: 1000,
        Modifiers: {
          Network: {
            Share: 0.56
          },
          Uptime: {
            Enabled: true,
            Share: 0.14,
            Tiers: {
              '0': 0,
              '3': 1,
              '14': 3
            }
          },
          Hardware: {
            Enabled: true,
            Share: 0.3
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
      Data: JSON.stringify({
        Scores: { [FINGERPRINT_A]: score1 }
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
          { name: 'Timestamp', value: '2000' }
      ],
      Data: JSON.stringify({
        Scores: { 
          [FINGERPRINT_A]: score1
        }
      })
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

    const summary2 = await handle({
      From: ALICE_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Last-Round-Metadata' }
      ]
    })
    
    expect(summary2.Messages).to.have.lengthOf(1)
    const summary2data = JSON.parse(summary2.Messages[0].Data)
    // alice uptime 0 no hw
    expect(summary2data.Summary.Rewards.Uptime).to.equal(0)
    expect(summary2data.Summary.Rewards.Hardware).to.equal(0)
    expect(summary2data.Summary.Ratings.Uptime).to.equal(0) 
    const rewards2ForAliceResult = await handle({
      From: ALICE_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Last-Round-Data' },
          { name: 'Fingerprint', value: FINGERPRINT_A }
      ]
    })
    expect(rewards2ForAliceResult.Messages).to.have.lengthOf(1)
    const alice2data = JSON.parse(rewards2ForAliceResult.Messages[0].Data)
    expect(alice2data.Details.Rating.Uptime).to.equal(0)
    expect(alice2data.Details.Reward.Uptime).to.equal(0)
    expect(alice2data.Details.Reward.Hardware).to.equal(0)
    expect(alice2data.Details.Reward.Network).to.equal(560)

    const thirdRoundResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Add-Scores' },
          { name: 'Timestamp', value: '3000' }
      ],
      Data: JSON.stringify({
        Scores: { 
          [FINGERPRINT_A]: score1WithHwUptime3
        }
      })
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

    const summary3 = await handle({
      From: ALICE_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Last-Round-Metadata' }
      ]
    })
    
    expect(summary3.Messages).to.have.lengthOf(1)
    const summary3data = JSON.parse(summary3.Messages[0].Data)
    // alice uptime 3 with hw
    expect(summary3data.Summary.Rewards.Uptime).to.equal(140)
    expect(summary3data.Summary.Rewards.Hardware).to.equal(300)
    expect(summary3data.Summary.Ratings.Uptime).to.equal(1)
    const rewards3ForAliceResult = await handle({
      From: ALICE_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Last-Round-Data' },
          { name: 'Fingerprint', value: FINGERPRINT_A }
      ]
    })
    expect(rewards3ForAliceResult.Messages).to.have.lengthOf(1)
    const alice3data = JSON.parse(rewards3ForAliceResult.Messages[0].Data)
    expect(alice3data.Details.Rating.Uptime).to.equal(1)
    expect(alice3data.Details.Reward.Uptime).to.equal(140)
    expect(alice3data.Details.Reward.Hardware).to.equal(300)
    expect(alice3data.Details.Reward.Network).to.equal(560)
    expect(alice3data.Details.Reward.Total).to.equal(1000)

    const fourthRoundResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Add-Scores' },
          { name: 'Timestamp', value: '4000' }
      ],
      Data: JSON.stringify({
        Scores: { 
          [FINGERPRINT_A]: score1WithHwUptime14,
          [FINGERPRINT_B]: score2WithUptime3
        }
      })
    })
    expect(fourthRoundResult.Messages).to.have.lengthOf(1)
    expect(fourthRoundResult.Messages[0].Data).to.equal('OK')

    const fourthCompleteResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Complete-Round' },
          { name: 'Timestamp', value: '4000' }
      ]
    })
    expect(fourthCompleteResult.Messages).to.have.lengthOf(1)
    expect(fourthCompleteResult.Messages[0].Data).to.equal('OK')

    const summary4 = await handle({
      From: ALICE_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Last-Round-Metadata' }
      ]
    })
    
    expect(summary4.Messages).to.have.lengthOf(1)
    const summary4data = JSON.parse(summary4.Messages[0].Data)
    // alice uptime 14 with hw, bob uptime 3 no hw
    expect(summary4data.Summary.Ratings.Uptime).to.equal(3)
    expect(summary4data.Summary.Rewards.Uptime).to.equal(140) // 1000 * 0.14
    expect(summary4data.Summary.Rewards.Hardware).to.equal(123)
    const rewards4ForAliceResult = await handle({
      From: ALICE_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Last-Round-Data' },
          { name: 'Fingerprint', value: FINGERPRINT_A }
      ]
    })
    expect(rewards4ForAliceResult.Messages).to.have.lengthOf(1)
    
    const alice4data = JSON.parse(rewards4ForAliceResult.Messages[0].Data)
    console.log(summary4.Messages[0].Data)
    console.log(rewards4ForAliceResult.Messages[0].Data)

    expect(alice4data.Details.Rating.Uptime).to.equal(3)
    expect(alice4data.Details.Reward.Uptime).to.equal(140)
    expect(alice4data.Details.Reward.Network).to.equal(186) // floor(560 * (100/300))
    expect(alice4data.Details.Reward.Hardware).to.equal(300) // 123 = 300 * 0.4{169.9{120.9{0.65 * 186} + 49{0.35 * 140}}/ 418{363{0.65*559} + 49{0.35*140}}}
    expect(alice4data.Details.Reward.Total).to.equal(626) // 140+300+186
    const rewards4ForBobResult = await handle({
      From: BOB_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Last-Round-Data' },
          { name: 'Fingerprint', value: FINGERPRINT_B }
      ]
    })
    expect(rewards4ForBobResult.Messages).to.have.lengthOf(1)
    
    const bob4data = JSON.parse(rewards4ForBobResult.Messages[0].Data)
    expect(bob4data.Details.Rating.Uptime).to.equal(0)
    expect(bob4data.Details.Rating.Hardware).to.equal(0)
    expect(bob4data.Details.Reward.Uptime).to.equal(0) // no hw
    expect(bob4data.Details.Reward.Hardware).to.equal(0)
    expect(bob4data.Details.Reward.Network).to.equal(373) // floor(560 * (200/300))
    expect(bob4data.Details.Reward.Total).to.equal(373)
  })
  
  it('Calculate exit bonus', async () => {
    const configResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Update-Configuration' }
      ],
      Data: JSON.stringify({
        TokensPerSecond: 1000,
        Modifiers: {
          Network: {
            Share: 0.56
          },
          Uptime: {
            Enabled: true,
            Share: 0.14,
            Tiers: {
              '0': 0,
              '3': 1,
              '14': 3
            }
          },
          Hardware: {
            Enabled: true,
            Share: 0.2
          },
          ExitBonus: {
            Enabled: true,
            Share: 0.1
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
      Data: JSON.stringify({
        Scores: { [FINGERPRINT_A]: score1 }
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
          { name: 'Timestamp', value: '2000' }
      ],
      Data: JSON.stringify({
        Scores: { 
          [FINGERPRINT_A]: score1WithExit
        }
      })
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

    const summary2 = await handle({
      From: ALICE_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Last-Round-Metadata' }
      ]
    })
    
    expect(summary2.Messages).to.have.lengthOf(1)
    const summary2data = JSON.parse(summary2.Messages[0].Data)
    // alice uptime 0 no hw with exit
    expect(summary2data.Summary.Rewards.ExitBonus).to.equal(100)
    expect(summary2data.Summary.Ratings.ExitBonus).to.equal(100)
    const rewards2ForAliceResult = await handle({
      From: ALICE_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Last-Round-Data' },
          { name: 'Fingerprint', value: FINGERPRINT_A }
      ]
    })
    expect(rewards2ForAliceResult.Messages).to.have.lengthOf(1)
    const alice2data = JSON.parse(rewards2ForAliceResult.Messages[0].Data)
    expect(alice2data.Details.Rating.ExitBonus).to.equal(100)
    expect(alice2data.Details.Reward.ExitBonus).to.equal(100)
    expect(alice2data.Details.Reward.Network).to.equal(560)
    expect(alice2data.Details.Reward.Total).to.equal(660)
  })
})