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

describe('Scoring relay rewards based on ratings', () => {
  let handle: AOTestHandle

  let score1 = { Address: ALICE_ADDRESS, Network: 100, IsHardware: false, 
    UptimeStreak: 0, ExitBonus: false, FamilySize: 0, LocationSize: 0
  }
  let score2 = { Address: BOB_ADDRESS, Network: 200, IsHardware: true, 
    UptimeStreak: 3, ExitBonus: true, FamilySize: 0, LocationSize: 2
  }
  let score3 = { Address: CHARLS_ADDRESS, Network: 300, IsHardware: true, 
    UptimeStreak: 14, ExitBonus: true, FamilySize: 2, LocationSize: 1
  }

  beforeEach(async () => {
    handle = (await createLoader('relay-rewards')).handle
  })

  it('Calculates a correct period since the last round', async () => {
    const configResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Update-Configuration' }
      ],
      Data: JSON.stringify({
        TokensPerSecond: '1000'
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
          { name: 'Timestamp', value: '2345' }
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
          { name: 'Timestamp', value: '2345' }
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
    expect(summary2data.Timestamp).to.equal(2345)
    expect(summary2data.Period).to.equal(Math.floor((2345 - 1000) / 1000))

    
    const scoredRound3Result = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Add-Scores' },
          { name: 'Timestamp', value: '40000' }
      ],
      Data: JSON.stringify({
        Scores: { 
          [FINGERPRINT_A]: score1
        }
      })
    })
    expect(scoredRound3Result.Messages).to.have.lengthOf(1)
    expect(scoredRound3Result.Messages[0].Data).to.equal('OK')

    const thirdCompleteResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Complete-Round' },
          { name: 'Timestamp', value: '40000' }
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
    expect(summary3data.Timestamp).to.equal(40000)
    expect(summary3data.Period).to.equal(Math.floor((40000 - 2345) / 1000))
  })

  it('Proportionally rewards relays based on their rating', async () => {
    const configResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Update-Configuration' }
      ],
      Data: JSON.stringify({
        TokensPerSecond: '1000',
        Modifiers: {
          Network: { Share: 0.56 },
          Uptime: { Enabled: true, Share: 0.14,
            Tiers: {
              '0': 0,
              '3': 1,
              '14': 3
            }
          },
          Hardware: { Enabled: true, Share: 0.2 },
          ExitBonus: { Enabled: true, Share: 0.1 }
        },
        Multipliers: {
          Family: { Enabled: true, Offset: 0.01, Power: 1 },
          Location: { Enabled: true, Offset: 0.003, Power: 2, Divider: 1 }
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
          { name: 'Timestamp', value: '11000' }
      ],
      Data: JSON.stringify({
        Scores: { 
          [FINGERPRINT_A]: score1, // network 100, no uptime, no hw, family 0, location 0
          [FINGERPRINT_B]: score2, // network 200 with hw, uptime 3, family 0, location 2, exit
          [FINGERPRINT_C]: score3, // network 300 with hw, uptime 14, family 2, location 1, exit
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

    const aResult = await handle({
      From: ALICE_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Last-Round-Data' },
          { name: 'Fingerprint', value: FINGERPRINT_A }
      ]
    })
    expect(aResult.Messages).to.have.lengthOf(1)
    const aData = JSON.parse(aResult.Messages[0].Data)
    expect(aData.Timestamp).to.equal(11000)
    expect(aData.Period).to.equal(10)

    const bResult = await handle({
      From: ALICE_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Last-Round-Data' },
          { name: 'Fingerprint', value: FINGERPRINT_B }
      ]
    })
    expect(bResult.Messages).to.have.lengthOf(1)
    const bData = JSON.parse(bResult.Messages[0].Data)
    expect(bData.Timestamp).to.equal(11000)
    expect(bData.Period).to.equal(10)

    const cResult = await handle({
      From: ALICE_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Last-Round-Data' },
          { name: 'Fingerprint', value: FINGERPRINT_B }
      ]
    })
    expect(cResult.Messages).to.have.lengthOf(1)
    const cData = JSON.parse(cResult.Messages[0].Data)
    expect(cData.Timestamp).to.equal(11000)
    expect(cData.Period).to.equal(10)

    expect(aData.Details.Reward.Total).to.equal(Math.floor(5600 * aData.Details.Rating.Network/summary2data.Summary.Ratings.Network).toString())
    expect(bData.Details.Reward.Total).to.equal(
      (Math.floor(5600 * bData.Details.Rating.Network/summary2data.Summary.Ratings.Network) +
      Math.floor(1400 * bData.Details.Rating.Uptime/summary2data.Summary.Ratings.Uptime) + 
      Math.floor(bData.Details.Reward.Hardware) + 
      Math.floor(1000 * bData.Details.Rating.ExitBonus/summary2data.Summary.Ratings.ExitBonus)).toString()
    )
    expect(cData.Details.Reward.Total).to.equal(
      (Math.floor(5600 * cData.Details.Rating.Network/summary2data.Summary.Ratings.Network) +
      Math.floor(1400 * cData.Details.Rating.Uptime/summary2data.Summary.Ratings.Uptime) + 
      Math.floor(cData.Details.Reward.Hardware) + 
      Math.floor(1000 * cData.Details.Rating.ExitBonus/summary2data.Summary.Ratings.ExitBonus)).toString()
    ) 
  })

  it('Assigns shared reward to the Delegate', async () => {
    const configResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Update-Configuration' }
      ],
      Data: JSON.stringify({
        TokensPerSecond: '1000',
        Modifiers: {
          Network: { Share: 0.56 },
          Uptime: { Enabled: true, Share: 0.14,
            Tiers: {
              '0': 0,
              '3': 1,
              '14': 3
            }
          },
          Hardware: { Enabled: true, Share: 0.2 },
          ExitBonus: { Enabled: true, Share: 0.1 }
        },
        Multipliers: {
          Family: { Enabled: true, Offset: 0.01, Power: 1 },
          Location: { Enabled: true, Offset: 0.003, Power: 2, Divider: 1 }
        },
        Delegates: {
          [ALICE_ADDRESS]: {
            Address: BOB_ADDRESS,
            Share: 0.4
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
          { name: 'Timestamp', value: '11000' }
      ],
      Data: JSON.stringify({
        Scores: { 
          [FINGERPRINT_A]: score1, // network 100, no uptime, no hw, family 0, location 0
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

    const aResult = await handle({
      From: ALICE_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Last-Round-Data' },
          { name: 'Fingerprint', value: FINGERPRINT_A }
      ]
    })
    expect(aResult.Messages).to.have.lengthOf(1)
    const aData = JSON.parse(aResult.Messages[0].Data)
    expect(aData.Timestamp).to.equal(11000)
    expect(aData.Period).to.equal(10)
    expect(aData.Details.Reward.Total).to.equal('5600')
    expect(aData.Details.Reward.DelegateTotal).to.equal((5600 * 0.4).toString())
    expect(aData.Details.Reward.OperatorTotal).to.equal((5600 * (1 - 0.4)).toString())
  })

  it('Accumulates the rewards by address and also fingerprint', async () => {
    const configResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Update-Configuration' }
      ],
      Data: JSON.stringify({
        TokensPerSecond: '1000',
        Modifiers: {
          Network: { Share: 0.56 },
          Uptime: { Enabled: true, Share: 0.14,
            Tiers: {
              '0': 0,
              '3': 1,
              '14': 3
            }
          },
          Hardware: { Enabled: true, Share: 0.2 },
          ExitBonus: { Enabled: true, Share: 0.1 }
        },
        Multipliers: {
          Family: { Enabled: true, Offset: 0.01, Power: 1 },
          Location: { Enabled: true, Offset: 0.003, Power: 2, Divider: 1 }
        },
        Delegates: {
          [ALICE_ADDRESS]: {
            Address: BOB_ADDRESS,
            Share: 0.4
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
          { name: 'Timestamp', value: '11000' }
      ],
      Data: JSON.stringify({
        Scores: { 
          [FINGERPRINT_A]: score1,
          [FINGERPRINT_B]: score2,
          [FINGERPRINT_C]: score3
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

    const aResult = await handle({
      From: ALICE_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Get-Rewards' }
      ]
    })
    expect(aResult.Messages).to.have.lengthOf(1)

    const bResult = await handle({
      From: BOB_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Get-Rewards' }
      ]
    })
    expect(bResult.Messages).to.have.lengthOf(1)

    const cResult = await handle({
      From: CHARLS_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Get-Rewards' }
      ]
    })
    expect(cResult.Messages).to.have.lengthOf(1)

    const aFingerprintResult = await handle({
      From: ALICE_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Get-Rewards' },
          { name: 'Fingerprint', value: FINGERPRINT_A }
      ]
    })
    expect(aFingerprintResult.Messages).to.have.lengthOf(1)

    const bFingerprintResult = await handle({
      From: BOB_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Get-Rewards' },
          { name: 'Fingerprint', value: FINGERPRINT_B }
      ]
    })
    expect(bFingerprintResult.Messages).to.have.lengthOf(1)

    const cFingerprintResult = await handle({
      From: CHARLS_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Get-Rewards' },
          { name: 'Fingerprint', value: FINGERPRINT_C }
      ]
    })
    expect(cFingerprintResult.Messages).to.have.lengthOf(1)

    expect(aResult.Messages[0].Data).to.equal('558')
    expect(aFingerprintResult.Messages[0].Data).to.equal('930')
    expect(bResult.Messages[0].Data).to.equal('3690')
    expect(bFingerprintResult.Messages[0].Data).to.equal('3318')
    expect(cResult.Messages[0].Data).to.equal('5748')
    expect(cFingerprintResult.Messages[0].Data).to.equal('5748')

    const thirdRoundResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Add-Scores' },
          { name: 'Timestamp', value: '21000' }
      ],
      Data: JSON.stringify({
        Scores: { 
          [FINGERPRINT_A]: score1
        }
      })
    })
    expect(thirdRoundResult.Messages).to.have.lengthOf(1)
    expect(thirdRoundResult.Messages[0].Data).to.equal('OK')

    const thirdCompleteResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Complete-Round' },
          { name: 'Timestamp', value: '21000' }
      ]
    })
    expect(thirdCompleteResult.Messages).to.have.lengthOf(1)
    expect(thirdCompleteResult.Messages[0].Data).to.equal('OK')

    
    const a2Result = await handle({
      From: ALICE_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Get-Rewards' }
      ]
    })
    expect(a2Result.Messages).to.have.lengthOf(1)

    const b2Result = await handle({
      From: BOB_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Get-Rewards' }
      ]
    })
    expect(b2Result.Messages).to.have.lengthOf(1)

    const a2FingerprintResult = await handle({
      From: ALICE_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Get-Rewards' },
          { name: 'Fingerprint', value: FINGERPRINT_A }
      ]
    })
    expect(a2FingerprintResult.Messages).to.have.lengthOf(1)

    const b2FingerprintResult = await handle({
      From: BOB_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Get-Rewards' },
          { name: 'Fingerprint', value: FINGERPRINT_B }
      ]
    })
    expect(b2FingerprintResult.Messages).to.have.lengthOf(1)
    expect(a2Result.Messages[0].Data).to.equal('3918')
    expect(a2FingerprintResult.Messages[0].Data).to.equal('6530')
    expect(b2Result.Messages[0].Data).to.equal('5930')
    expect(b2FingerprintResult.Messages[0].Data).to.equal('3318')
  })

})
