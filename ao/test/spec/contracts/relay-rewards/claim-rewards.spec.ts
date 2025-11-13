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

describe('Claiming relay rewards', () => {
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

  it('Tracks Claimed, rewarded tokens', async () => {
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
    expect(configResult.Messages).to.have.lengthOf(2)
    expect(configResult.Messages[0].Tags).to.deep.include({
      name: 'device',
      value: 'patch@1.0'
    })
    expect(configResult.Messages[1].Data).to.equal('OK')

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
    expect(firstCompleteResult.Messages).to.have.lengthOf(2)
    expect(firstCompleteResult.Messages[0].Tags).to.deep.include({
      name: 'device',
      value: 'patch@1.0'
    })
    expect(firstCompleteResult.Messages[1].Data).to.equal('OK')
    
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
    expect(secondCompleteResult.Messages).to.have.lengthOf(2)
    expect(secondCompleteResult.Messages[0].Tags).to.deep.include({
      name: 'device',
      value: 'patch@1.0'
    })
    expect(secondCompleteResult.Messages[1].Data).to.equal('OK')

    const aResult = await handle({
      From: ALICE_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Get-Rewards' },
          { name: 'Timestamp', value: '11000' }
      ]
    })
    expect(aResult.Messages).to.have.lengthOf(1)

    const bResult = await handle({
      From: BOB_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Get-Rewards' },
          { name: 'Timestamp', value: '11000' }
      ]
    })
    expect(bResult.Messages).to.have.lengthOf(1)

    const cResult = await handle({
      From: CHARLS_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Get-Rewards' },
          { name: 'Timestamp', value: '11000' }
      ]
    })

    expect(cResult.Messages).to.have.lengthOf(1)
    expect(aResult.Messages[0].Data).to.equal('558')
    expect(bResult.Messages[0].Data).to.equal('3631')
    expect(cResult.Messages[0].Data).to.equal('5808')

    const aClaimResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Claim-Rewards' },
          { name: 'Address', value: ALICE_ADDRESS },
          { name: 'Timestamp', value: '11000' }
      ]
    })
    expect(aClaimResult.Messages).to.have.lengthOf(2)
    expect(aClaimResult.Messages[0].Tags).to.deep.include({
      name: 'device',
      value: 'patch@1.0'
    })
    const claimedTagValue = aClaimResult.Messages[0].Tags.find(
      t => t.name === 'claimed'
    )?.value
    expect(claimedTagValue).to.not.be.undefined
    expect(claimedTagValue).to.deep.include({
      [ALICE_ADDRESS]: '558'
    })
    const aClaim = JSON.parse(aClaimResult.Messages[1].Data)
    expect(aClaim).to.be.equal('558')

    const bClaimResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Claim-Rewards' },
          { name: 'Address', value: BOB_ADDRESS },
          { name: 'Timestamp', value: '11000' }
      ]
    })
    expect(bClaimResult.Messages).to.have.lengthOf(2)
    expect(bClaimResult.Messages[0].Tags).to.deep.include({
      name: 'device',
      value: 'patch@1.0'
    })
    const bClaimedTagValue = bClaimResult.Messages[0].Tags.find(
      t => t.name === 'claimed'
    )?.value
    expect(bClaimedTagValue).to.not.be.undefined
    expect(bClaimedTagValue).to.deep.include({
      [BOB_ADDRESS]: '3631'
    })
    const bClaim = JSON.parse(bClaimResult.Messages[1].Data)
    expect(bClaim).to.be.equal('3631')

    const aClaimedResult = await handle({
      From: ALICE_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Get-Claimed' },
          { name: 'Address', value: ALICE_ADDRESS },
          { name: 'Timestamp', value: '11000' }
      ]
    })
    expect(aClaimedResult.Messages).to.have.lengthOf(1)
    const aClaimed = JSON.parse(aClaimedResult.Messages[0].Data)
    expect(aClaimed).to.be.equal('558')

    const bClaimedResult = await handle({
      From: BOB_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Get-Claimed' },
          { name: 'Address', value: BOB_ADDRESS },
          { name: 'Timestamp', value: '11000' }
      ]
    })
    expect(bClaimedResult.Messages).to.have.lengthOf(1)
    const bClaimed = JSON.parse(bClaimedResult.Messages[0].Data)
    expect(bClaimed).to.be.equal('3631')

    const cClaimedResult = await handle({
      From: CHARLS_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Get-Claimed' },
          { name: 'Address', value: CHARLS_ADDRESS },
          { name: 'Timestamp', value: '11000' }
      ]
    })
    expect(cClaimedResult.Messages).to.have.lengthOf(1)
    const cClaimed = JSON.parse(cClaimedResult.Messages[0].Data)
    expect(cClaimed).to.be.equal(null)
    
    const thirdRoundResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Add-Scores' },
          { name: 'Timestamp', value: '21000' }
      ],
      Data: JSON.stringify({
        Scores: { 
          [FINGERPRINT_A]: score1,
          [FINGERPRINT_B]: score2,
          [FINGERPRINT_C]: score3
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
    expect(thirdCompleteResult.Messages).to.have.lengthOf(2)
    expect(thirdCompleteResult.Messages[0].Tags).to.deep.include({
      name: 'device',
      value: 'patch@1.0'
    })
    expect(thirdCompleteResult.Messages[1].Data).to.equal('OK')

    const aResult2 = await handle({
      From: ALICE_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Get-Rewards' },
          { name: 'Timestamp', value: '21000' }
      ]
    })
    expect(aResult2.Messages).to.have.lengthOf(1)

    const bResult2 = await handle({
      From: BOB_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Get-Rewards' },
          { name: 'Timestamp', value: '21000' }
      ]
    })
    expect(bResult2.Messages).to.have.lengthOf(1)

    const cResult2 = await handle({
      From: CHARLS_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Get-Rewards' },
          { name: 'Timestamp', value: '21000' }
      ]
    })

    expect(cResult2.Messages).to.have.lengthOf(1)
    expect(aResult2.Messages[0].Data).to.equal('1116')
    expect(bResult2.Messages[0].Data).to.equal('7262')
    expect(cResult2.Messages[0].Data).to.equal('11616')

    const aClaimResult2 = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Claim-Rewards' },
          { name: 'Address', value: ALICE_ADDRESS },
          { name: 'Timestamp', value: '21000' }
      ]
    })
    expect(aClaimResult2.Messages).to.have.lengthOf(2)
    expect(aClaimResult2.Messages[0].Tags).to.deep.include({
      name: 'device',
      value: 'patch@1.0'
    })
    const aClaimTagValue2 = aClaimResult2.Messages[0].Tags.find(
      t => t.name === 'claimed'
    )?.value
    expect(aClaimTagValue2).to.not.be.undefined
    expect(aClaimTagValue2).to.deep.include({
      [ALICE_ADDRESS]: '1116'
    })
    const aClaim2 = JSON.parse(aClaimResult2.Messages[1].Data)
    expect(aClaim2).to.be.equal('1116')

    const cClaimResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Claim-Rewards' },
          { name: 'Address', value: CHARLS_ADDRESS },
          { name: 'Timestamp', value: '21000' }
      ]
    })
    expect(cClaimResult.Messages).to.have.lengthOf(2)
    expect(cClaimResult.Messages[0].Tags).to.deep.include({
      name: 'device',
      value: 'patch@1.0'
    })
    const cClaimedTagValue = cClaimResult.Messages[0].Tags.find(
      t => t.name === 'claimed'
    )?.value
    expect(cClaimedTagValue).to.not.be.undefined
    expect(cClaimedTagValue).to.deep.include({
      [CHARLS_ADDRESS]: '11616'
    })
    const cClaim = JSON.parse(cClaimResult.Messages[1].Data)
    expect(cClaim).to.be.equal('11616')

    const aClaimedResult2 = await handle({
      From: ALICE_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Get-Claimed' },
          { name: 'Address', value: ALICE_ADDRESS },
          { name: 'Timestamp', value: '21000' }
      ]
    })
    expect(aClaimedResult2.Messages).to.have.lengthOf(1)
    const aClaimed2 = JSON.parse(aClaimedResult2.Messages[0].Data)
    expect(aClaimed2).to.be.equal('1116')

    const bClaimedResult2 = await handle({
      From: BOB_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Get-Claimed' },
          { name: 'Address', value: BOB_ADDRESS },
          { name: 'Timestamp', value: '21000' }
      ]
    })
    expect(bClaimedResult2.Messages).to.have.lengthOf(1)
    const bClaimed2 = JSON.parse(bClaimedResult2.Messages[0].Data)
    expect(bClaimed2).to.be.equal('3631')

    const cClaimedResult2 = await handle({
      From: CHARLS_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Get-Claimed' },
          { name: 'Address', value: CHARLS_ADDRESS },
          { name: 'Timestamp', value: '21000' }
      ]
    })
    expect(cClaimedResult2.Messages).to.have.lengthOf(1)
    const cClaimed2 = JSON.parse(cClaimedResult2.Messages[0].Data)
    expect(cClaimed2).to.be.equal('11616')

  }).timeout(10_000)

})
