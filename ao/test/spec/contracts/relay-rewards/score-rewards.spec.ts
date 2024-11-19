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


})

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
