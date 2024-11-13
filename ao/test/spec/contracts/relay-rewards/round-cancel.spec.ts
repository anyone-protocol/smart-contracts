import { expect } from 'chai'

import {
  ALICE_ADDRESS,
  AOTestHandle,
  createLoader,
  FINGERPRINT_A,
  OWNER_ADDRESS
} from '~/test/util/setup'

describe('Cancel-Round action of relay rewards', () => {
  let handle: AOTestHandle

  beforeEach(async () => {
    handle = (await createLoader('relay-rewards')).handle
  })

  it('Blocks non-owners from doing updates', async () => {
    const result = await handle({
      From: ALICE_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Cancel-Round' }
      ]
    })
    expect(result.Error).to.be.a('string').that.includes('This method is only available to the Owner')
  })

  it('Ensure provided timestamp is integer', async () => {
    const noStampResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Cancel-Round' }
      ]
    })
    expect(noStampResult.Error).to.be.a('string').that.includes('Timestamp tag')

    const emptyStampResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Cancel-Round' },
          { name: 'Timestamp', value: '' }
      ]
    })
    expect(emptyStampResult.Error).to.be.a('string').that.includes('Timestamp tag')

    const badStampResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Cancel-Round' },
          { name: 'Timestamp', value: 'bad-stamp' }
      ]
    })
    expect(badStampResult.Error).to.be.a('string').that.includes('Timestamp tag')
  })

  it('Confirms pending round exists for timestamp', async () => {
    const missingRoundResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Cancel-Round' },
          { name: 'Timestamp', value: '1234567890' }
      ]
    })
    expect(missingRoundResult.Error).to.be.a('string').that.includes('No pending round for 1234567890')
  })

  it('Removes pending round for timestamp', async () => {
    const newRoundResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Add-Scores' },
          { name: 'Timestamp', value: '1234567890' }
      ],
      Data: JSON.stringify({
        Scores: {
          [FINGERPRINT_A]: { Address: ALICE_ADDRESS, 
            Network: 0, IsHardware: false, UptimeStreak: 0, ExitBonus: false, FamilySize: 0, LocationSize: 0
          }
        }
      })
    })

    expect(newRoundResult.Messages).to.have.lengthOf(1)
    expect(newRoundResult.Messages[0].Data).to.equal('OK')

    const missingRoundResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Cancel-Round' },
          { name: 'Timestamp', value: '1234567890' }
      ]
    })
    
    expect(missingRoundResult.Messages).to.have.lengthOf(1)
    expect(missingRoundResult.Messages[0].Data).to.equal('OK')
  })
})