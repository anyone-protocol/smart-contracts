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