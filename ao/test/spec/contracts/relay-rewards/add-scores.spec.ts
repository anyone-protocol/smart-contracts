import { expect } from 'chai'

import {
  ALICE_ADDRESS,
  AOTestHandle,
  createLoader,
  FINGERPRINT_A,
  OWNER_ADDRESS
} from '~/test/util/setup'

describe('Add-Scores action of relay rewards', () => {
  let handle: AOTestHandle

  let score0 = { Address: ALICE_ADDRESS, 
    Network: 0, IsHardware: false, UptimeStreak: 0, ExitBonus: false, 
    FamilySize: 0, LocationSize: 0
  }
  let refRound1 = JSON.stringify({
    Scores: { [FINGERPRINT_A]: score0 }
  })

  beforeEach(async () => {
    handle = (await createLoader('relay-rewards')).handle
  })

  it('Blocks non-owners from doing updates', async () => {
    const result = await handle({
      From: ALICE_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Add-Scores' }
      ]
    })
    expect(result.Error).to.be.a('string').that.includes('This method is only available to the Owner')
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
          { name: 'Timestamp', value: '' }
      ],
      Data: refRound1
    })
    expect(emptyStampResult.Error).to.be.a('string').that.includes('Timestamp tag')

    const badStampResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Add-Scores' },
          { name: 'Timestamp', value: 'bad-stamp' }
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
          { name: 'Timestamp', value: '0' }
      ],
      Data: refRound1
    })
    expect(zeroStampResult.Error).to.be.a('string').that.includes('Timestamp has to be > 0')
    
    const negativeStampResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Add-Scores' },
          { name: 'Timestamp', value: '-100' }
      ],
      Data: refRound1
    })
    expect(negativeStampResult.Error).to.be.a('string').that.includes('Timestamp has to be > 0')
  })

  it('Ensures timestamp is not backdated to previous round', async () => {
    const configResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Update-Configuration' }
      ],
      Data: JSON.stringify({
        TokensPerSecond: 100,
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
          { name: 'Timestamp', value: '10' }
      ],
      Data: refRound1
    })
    expect(noRoundResult.Messages).to.have.lengthOf(1)
    expect(noRoundResult.Messages[0].Data).to.equal('OK')
    
    const completeRoundResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Complete-Round' },
          { name: 'Timestamp', value: '10' }
      ]
    })
    expect(completeRoundResult.Messages).to.have.lengthOf(1)
    expect(completeRoundResult.Messages[0].Data).to.equal('OK')

    const outdatedStampResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Add-Scores' },
          { name: 'Timestamp', value: '10' }
      ],
      Data: refRound1
    })
    expect(outdatedStampResult.Error).to.be.a('string').that.includes('Timestamp is backdated')

    
    const newRoundResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Add-Scores' },
          { name: 'Timestamp', value: '20' }
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
          { name: 'Timestamp', value: '5' }
      ],
      Data: JSON.stringify({ Scores: "some scores"})
    })
    expect(outdatedStampResult.Error).to.be.a('string').that.includes('Scores have to be a table')
  })

  it('Each score - Fingerprint has valid format', async () => {
    const scoresResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Add-Scores' },
          { name: 'Timestamp', value: '5' }
      ],
      Data: JSON.stringify({ Scores: {
        [FINGERPRINT_A]: score0, 
          'asd': score0
        }
      })
    })
    expect(scoresResult.Error).to.be.a('string').that.includes('Invalid Fingerprint')
  })

  it('Each score - Fingerprint score was not set during the round', async () => {
    const sameRoundTrueResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Add-Scores' },
          { name: 'Timestamp', value: '5' }
      ],
      Data: JSON.stringify({ Scores: {
        [FINGERPRINT_A]: score0 
      }})
    })
    expect(sameRoundTrueResult.Messages).to.have.lengthOf(1)
    expect(sameRoundTrueResult.Messages[0].Data).to.equal('OK')

    const sameRoundFalseResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Add-Scores' },
          { name: 'Timestamp', value: '5' }
      ],
      Data: JSON.stringify({ Scores: {
        [FINGERPRINT_A]: score0 
      }})
    })
    expect(sameRoundFalseResult.Error).to.be.a('string').that.includes('Duplicated score for ' + FINGERPRINT_A)
  })

  it('Each score - Address Must be valid EVM address format', async () => {
    const emptyAddressResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Add-Scores' },
          { name: 'Timestamp', value: '5' }
      ],
      Data: JSON.stringify({ Scores: {
        [FINGERPRINT_A]: { ...score0, Address: '' }
      }})
    })
    expect(emptyAddressResult.Error).to.be.a('string').that.includes('Invalid Scores[' + FINGERPRINT_A +'].Addres')

    const wrongAddressResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Add-Scores' },
          { name: 'Timestamp', value: '5' }
      ],
      Data: JSON.stringify({ Scores: {
        [FINGERPRINT_A]: { ...score0, Address: 'some-wrong-address' }
      }})
    })
    expect(wrongAddressResult.Error).to.be.a('string').that.includes('Invalid Scores[' + FINGERPRINT_A +'].Addres')
  })

  it('Each score - Network score must be integer and >= 0', async () => {
    const emptyNetworkResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Add-Scores' },
          { name: 'Timestamp', value: '5' }
      ],
      Data: JSON.stringify({ Scores: {
        [FINGERPRINT_A]: { ...score0, Network: '' }
      }})
    })
    expect(emptyNetworkResult.Error).to.be.a('string').that.includes('Scores[' + FINGERPRINT_A +'].Network')

    const wrongNetworkResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Add-Scores' },
          { name: 'Timestamp', value: '5' }
      ],
      Data: JSON.stringify({ Scores: {
        [FINGERPRINT_A]: { ...score0, Network: -100 }
      }})
    })
    expect(wrongNetworkResult.Error).to.be.a('string').that.includes('Scores[' + FINGERPRINT_A +'].Network')
    
    const boolNetworkResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Add-Scores' },
          { name: 'Timestamp', value: '5' }
      ],
      Data: JSON.stringify({ Scores: {
        [FINGERPRINT_A]: { ...score0, Network: true }
      }})
    })
    expect(boolNetworkResult.Error).to.be.a('string').that.includes('Scores[' + FINGERPRINT_A +'].Network')
    
    const nullNetworkResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Add-Scores' },
          { name: 'Timestamp', value: '5' }
      ],
      Data: JSON.stringify({ Scores: {
        [FINGERPRINT_A]: { ...score0, Network: null }
      }})
    })
    expect(nullNetworkResult.Error).to.be.a('string').that.includes('Scores[' + FINGERPRINT_A +'].Network')
  })

  it('Each score - IsHardware must be boolean', async () => {
    const emptyHardwareResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Add-Scores' },
          { name: 'Timestamp', value: '5' }
      ],
      Data: JSON.stringify({ Scores: {
        [FINGERPRINT_A]: { ...score0, IsHardware: '' }
      }})
    })
    expect(emptyHardwareResult.Error).to.be.a('string').that.includes('Scores[' + FINGERPRINT_A +'].IsHardware')

    const numberHardwareResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Add-Scores' },
          { name: 'Timestamp', value: '5' }
      ],
      Data: JSON.stringify({ Scores: {
        [FINGERPRINT_A]: { ...score0, IsHardware: 12 }
      }})
    })
    expect(numberHardwareResult.Error).to.be.a('string').that.includes('Scores[' + FINGERPRINT_A +'].IsHardware')

    const nullHardwareResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Add-Scores' },
          { name: 'Timestamp', value: '5' }
      ],
      Data: JSON.stringify({ Scores: {
        [FINGERPRINT_A]: { ...score0, IsHardware: null }
      }})
   })
    expect(nullHardwareResult.Error).to.be.a('string').that.includes('Scores[' + FINGERPRINT_A +'].IsHardware')
  
  })

  it('Each score - UptimeStreak must be integer and >= 0', async () => {
    const emptyUptimeResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Add-Scores' },
          { name: 'Timestamp', value: '5' }
      ],
      Data: JSON.stringify({ Scores: {
        [FINGERPRINT_A]: { ...score0, UptimeStreak: '' }
      }})
    })
    expect(emptyUptimeResult.Error).to.be.a('string').that.includes('Scores[' + FINGERPRINT_A +'].UptimeStreak')

    const wrongUptimeResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Add-Scores' },
          { name: 'Timestamp', value: '5' }
      ],
      Data: JSON.stringify({ Scores: {
        [FINGERPRINT_A]: { ...score0, UptimeStreak: -100 }
      }})
    })
    expect(wrongUptimeResult.Error).to.be.a('string').that.includes('Scores[' + FINGERPRINT_A +'].UptimeStreak')
    
    const boolUptimeResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Add-Scores' },
          { name: 'Timestamp', value: '5' }
      ],
      Data: JSON.stringify({ Scores: {
        [FINGERPRINT_A]: { ...score0, UptimeStreak: true }
      }})
    })
    expect(boolUptimeResult.Error).to.be.a('string').that.includes('Scores[' + FINGERPRINT_A +'].UptimeStreak')
    
    const nullUptimeResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Add-Scores' },
          { name: 'Timestamp', value: '5' }
      ],
      Data: JSON.stringify({ Scores: {
        [FINGERPRINT_A]: { ...score0, UptimeStreak: null }
      }})
    })
    expect(nullUptimeResult.Error).to.be.a('string').that.includes('Scores[' + FINGERPRINT_A +'].UptimeStreak')
  })

  it('Each score - ExitBonus must be boolean', async () => {
    const emptyBonusResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Add-Scores' },
          { name: 'Timestamp', value: '5' }
      ],
      Data: JSON.stringify({ Scores: {
        [FINGERPRINT_A]: { ...score0, ExitBonus: '' }
      }})
    })
    expect(emptyBonusResult.Error).to.be.a('string').that.includes('Scores[' + FINGERPRINT_A +'].ExitBonus')

    const numberBonusResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Add-Scores' },
          { name: 'Timestamp', value: '5' }
      ],
      Data: JSON.stringify({ Scores: {
        [FINGERPRINT_A]: { ...score0, ExitBonus: 12 }
      }})
    })
    expect(numberBonusResult.Error).to.be.a('string').that.includes('Scores[' + FINGERPRINT_A +'].ExitBonus')

    const nullBonusResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Add-Scores' },
          { name: 'Timestamp', value: '5' }
      ],
      Data: JSON.stringify({ Scores: {
        [FINGERPRINT_A]: { ...score0, ExitBonus: null }
      }})
   })
    expect(nullBonusResult.Error).to.be.a('string').that.includes('Scores[' + FINGERPRINT_A +'].ExitBonus')
  
  })

  it('Each score - FamilySize must be integer and >= 0', async () => {
    const emptyFamilyResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Add-Scores' },
          { name: 'Timestamp', value: '5' }
      ],
      Data: JSON.stringify({ Scores: {
        [FINGERPRINT_A]: { ...score0, FamilySize: '' }
      }})
    })
    expect(emptyFamilyResult.Error).to.be.a('string').that.includes('Scores[' + FINGERPRINT_A +'].FamilySize')

    const wrongFamilyResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Add-Scores' },
          { name: 'Timestamp', value: '5' }
      ],
      Data: JSON.stringify({ Scores: {
        [FINGERPRINT_A]: { ...score0, FamilySize: -100 }
      }})
    })
    expect(wrongFamilyResult.Error).to.be.a('string').that.includes('Scores[' + FINGERPRINT_A +'].FamilySize')
    
    const boolFamilyResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Add-Scores' },
          { name: 'Timestamp', value: '5' }
      ],
      Data: JSON.stringify({ Scores: {
        [FINGERPRINT_A]: { ...score0, FamilySize: true }
      }})
    })
    expect(boolFamilyResult.Error).to.be.a('string').that.includes('Scores[' + FINGERPRINT_A +'].FamilySize')
    
    const nullFamilyResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Add-Scores' },
          { name: 'Timestamp', value: '5' }
      ],
      Data: JSON.stringify({ Scores: {
        [FINGERPRINT_A]: { ...score0, FamilySize: null }
      }})
    })
    expect(nullFamilyResult.Error).to.be.a('string').that.includes('Scores[' + FINGERPRINT_A +'].FamilySize')
  })

  it('Each score - LocationSize must be integer and >= 0', async () => {
    const emptyLocationResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Add-Scores' },
          { name: 'Timestamp', value: '5' }
      ],
      Data: JSON.stringify({ Scores: {
        [FINGERPRINT_A]: { ...score0, LocationSize: '' }
      }})
    })
    expect(emptyLocationResult.Error).to.be.a('string').that.includes('Scores[' + FINGERPRINT_A +'].LocationSize')

    const wrongLocationResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Add-Scores' },
          { name: 'Timestamp', value: '5' }
      ],
      Data: JSON.stringify({ Scores: {
        [FINGERPRINT_A]: { ...score0, LocationSize: -100 }
      }})
    })
    expect(wrongLocationResult.Error).to.be.a('string').that.includes('Scores[' + FINGERPRINT_A +'].LocationSize')
    
    const boolLocationResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Add-Scores' },
          { name: 'Timestamp', value: '5' }
      ],
      Data: JSON.stringify({ Scores: {
        [FINGERPRINT_A]: { ...score0, LocationSize: true }
      }})
    })
    expect(boolLocationResult.Error).to.be.a('string').that.includes('Scores[' + FINGERPRINT_A +'].LocationSize')
    
    const nullLocationResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Add-Scores' },
          { name: 'Timestamp', value: '5' }
      ],
      Data: JSON.stringify({ Scores: {
        [FINGERPRINT_A]: { ...score0, LocationSize: null }
      }})
    })
    expect(nullLocationResult.Error).to.be.a('string').that.includes('Scores[' + FINGERPRINT_A +'].LocationSize')
  })
})