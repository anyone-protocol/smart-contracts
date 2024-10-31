import { expect } from 'chai'

import {
  ALICE_ADDRESS,
  AOTestHandle,
  BOB_ADDRESS,
  CHARLS_ADDRESS,
  createLoader,
  EXAMPLE_FINGERPRINT,
  EXAMPLE_MASTER_ID_PUBLIC_KEY,
  EXAMPLE_RSA_IDENTITY_PUBLIC_KEY,
  EXAMPLE_SIGNING_CERT,
  EXAMPLE_SIGNING_PUBLIC_KEY,
  FINGERPRINT_A,
  FINGERPRINT_B,
  FINGERPRINT_C,
  FINGERPRINT_D,
  FINGERPRINT_E,
  OWNER_ADDRESS
} from '~/test/util/setup'

describe('Relay Rewards', () => {
  let handle: AOTestHandle

  beforeEach(async () => {
    handle = (await createLoader('relay-rewards')).handle
  })

  describe('State per fingerprint', () => {
  
    it('Block non-controllers from doing updates', async () => {
      const result = await handle({
        From: EXAMPLE_RSA_IDENTITY_PUBLIC_KEY.toString('base64'),
        Tags: [
          { name: 'Action', value: 'Update-Fingerprint-To-State' }
        ]
      })
  
      expect(result.Messages).to.have.lengthOf(1)
      expect(result.Messages[0].Data).to.equal('OK')
    })

    it('Validate update requests\' fingerprint', async () => {
      
      const result = await handle({
        From: EXAMPLE_RSA_IDENTITY_PUBLIC_KEY.toString('base64'),
        Tags: [
          { name: 'Action', value: 'Update-Fingerprint-To-State' }
        ]
      })
  
      expect(result.Messages).to.have.lengthOf(1)
      expect(result.Messages[0].Data).to.equal('OK')
    })

    it('Allow toggling hardware flag', async () => {
      
      const result = await handle({
        From: EXAMPLE_RSA_IDENTITY_PUBLIC_KEY.toString('base64'),
        Tags: [
          { name: 'Action', value: 'Update-Fingerprint-To-State' }
        ]
      })
  
      expect(result.Messages).to.have.lengthOf(1)
      expect(result.Messages[0].Data).to.equal('OK')
    })
  
    it('Allow tracking family size', async () => {
      
      const result = await handle({
        From: EXAMPLE_RSA_IDENTITY_PUBLIC_KEY.toString('base64'),
        Tags: [
          { name: 'Action', value: 'Update-Fingerprint-To-State' }
        ]
      })
  
      expect(result.Messages).to.have.lengthOf(1)
      expect(result.Messages[0].Data).to.equal('OK')
    })
  
    it('Allow tracking uptime streak', async () => {
      
      const result = await handle({
        From: EXAMPLE_RSA_IDENTITY_PUBLIC_KEY.toString('base64'),
        Tags: [
          { name: 'Action', value: 'Update-Fingerprint-To-State' }
        ]
      })
  
      expect(result.Messages).to.have.lengthOf(1)
      expect(result.Messages[0].Data).to.equal('OK')
    })
  
    it('Allow changing quality tier', async () => {
      
      const result = await handle({
        From: EXAMPLE_RSA_IDENTITY_PUBLIC_KEY.toString('base64'),
        Tags: [
          { name: 'Action', value: 'Update-Fingerprint-To-State' }
        ]
      })
  
      expect(result.Messages).to.have.lengthOf(1)
      expect(result.Messages[0].Data).to.equal('OK')
    })
  })  

  describe('Modifiers', () => {
    
    it('Block non-controllers from doing updates', async () => {
      const result = await handle({
        From: EXAMPLE_RSA_IDENTITY_PUBLIC_KEY.toString('base64'),
        Tags: [
          { name: 'Action', value: 'Update-Modifiers-To-Relay-Rewards' }
        ]
      })
  
      expect(result.Messages).to.have.lengthOf(1)
      expect(result.Messages[0].Data).to.equal('OK')
    })

    it('Allow setting distribution amount', async () => {
      const result = await handle({
        From: EXAMPLE_RSA_IDENTITY_PUBLIC_KEY.toString('base64'),
        Tags: [
          { name: 'Action', value: 'Update-Modifiers-To-Relay-Rewards' }
        ]
      })
  
      expect(result.Messages).to.have.lengthOf(1)
      expect(result.Messages[0].Data).to.equal('OK')
    })

    it('Validates new distribution amount', async () => {
      
      const result = await handle({
        From: EXAMPLE_RSA_IDENTITY_PUBLIC_KEY.toString('base64'),
        Tags: [
          { name: 'Action', value: 'Update-Modifiers-To-Relay-Rewards' }
        ]
      })
  
      expect(result.Messages).to.have.lengthOf(1)
      expect(result.Messages[0].Data).to.equal('OK')
    })
  
    it('Allow updating family modifier', async () => {
      
      const result = await handle({
        From: EXAMPLE_RSA_IDENTITY_PUBLIC_KEY.toString('base64'),
        Tags: [
          { name: 'Action', value: 'Update-Modifiers-To-Relay-Rewards' }
        ]
      })
  
      expect(result.Messages).to.have.lengthOf(1)
      expect(result.Messages[0].Data).to.equal('OK')
    })

    it('Validate incorrect family modifier', async () => {
      
      const result = await handle({
        From: EXAMPLE_RSA_IDENTITY_PUBLIC_KEY.toString('base64'),
        Tags: [
          { name: 'Action', value: 'Update-Modifiers-To-Relay-Rewards' }
        ]
      })
  
      expect(result.Messages).to.have.lengthOf(1)
      expect(result.Messages[0].Data).to.equal('OK')
    })
    
    it('Allow updating uptime modifier', async () => {
      
      const result = await handle({
        From: EXAMPLE_RSA_IDENTITY_PUBLIC_KEY.toString('base64'),
        Tags: [
          { name: 'Action', value: 'Update-Modifiers-To-Relay-Rewards' }
        ]
      })
  
      expect(result.Messages).to.have.lengthOf(1)
      expect(result.Messages[0].Data).to.equal('OK')
    })

    it('Validate incorrect uptime modifier', async () => {
      
      const result = await handle({
        From: EXAMPLE_RSA_IDENTITY_PUBLIC_KEY.toString('base64'),
        Tags: [
          { name: 'Action', value: 'Update-Modifiers-To-Relay-Rewards' }
        ]
      })
  
      expect(result.Messages).to.have.lengthOf(1)
      expect(result.Messages[0].Data).to.equal('OK')
    })
  
    it('Allow updating uptime tiers', async () => {
      
      const result = await handle({
        From: EXAMPLE_RSA_IDENTITY_PUBLIC_KEY.toString('base64'),
        Tags: [
          { name: 'Action', value: 'Update-Modifiers-To-Relay-Rewards' }
        ]
      })
  
      expect(result.Messages).to.have.lengthOf(1)
      expect(result.Messages[0].Data).to.equal('OK')
    })

    it('Validate incorrect uptime tiers', async () => {
      
      const result = await handle({
        From: EXAMPLE_RSA_IDENTITY_PUBLIC_KEY.toString('base64'),
        Tags: [
          { name: 'Action', value: 'Update-Modifiers-To-Relay-Rewards' }
        ]
      })
  
      expect(result.Messages).to.have.lengthOf(1)
      expect(result.Messages[0].Data).to.equal('OK')
    })
  
    it('Allow updating hardware modifier', async () => {
      
      const result = await handle({
        From: EXAMPLE_RSA_IDENTITY_PUBLIC_KEY.toString('base64'),
        Tags: [
          { name: 'Action', value: 'Update-Modifiers-To-Relay-Rewards' }
        ]
      })
  
      expect(result.Messages).to.have.lengthOf(1)
      expect(result.Messages[0].Data).to.equal('OK')
    })

    it('Validate incorrect hardware modifier', async () => {
      
      const result = await handle({
        From: EXAMPLE_RSA_IDENTITY_PUBLIC_KEY.toString('base64'),
        Tags: [
          { name: 'Action', value: 'Update-Modifiers-To-Relay-Rewards' }
        ]
      })
  
      expect(result.Messages).to.have.lengthOf(1)
      expect(result.Messages[0].Data).to.equal('OK')
    })
  })




  describe('Scoring rounds', () => {
    it('Block non-controllers from adding scores', async () => {
      
      const result = await handle({
        From: ALICE_ADDRESS,
        Tags: [
          { name: 'Action', value: 'Add-Scores-To-Pending-Round' }
        ]
      })

      expect(result.Messages).to.have.lengthOf(1)
      expect(result.Messages[0].Data).to.equal('OK')
    })

    it('Allow controller to add scores to a new distribution round', async () => {
      
      const result = await handle({
        From: ALICE_ADDRESS,
        Tags: [
          { name: 'Action', value: 'Add-Scores-To-Pending-Round' }
        ]
      })

      expect(result.Messages).to.have.lengthOf(1)
      expect(result.Messages[0].Data).to.equal('OK')
    })

    it('Accumulate rewards per address when the round is completed', async () => {
      
      const result = await handle({
        From: ALICE_ADDRESS,
        Tags: [
          { name: 'Action', value: 'Add-Scores-To-Pending-Round' }
        ]
      })

      expect(result.Messages).to.have.lengthOf(1)
      expect(result.Messages[0].Data).to.equal('OK')
    })

    it('Allow cancelling of a pending distribution round', async () => {
      
      const result = await handle({
        From: ALICE_ADDRESS,
        Tags: [
          { name: 'Action', value: 'Cancel-Pending-Round' }
        ]
      })

      expect(result.Messages).to.have.lengthOf(1)
      expect(result.Messages[0].Data).to.equal('OK')
    })

    it('Require a valid timestamp when adding scores', async () => {
      
      const result = await handle({
        From: ALICE_ADDRESS,
        Tags: [
          { name: 'Action', value: 'Add-Scores-To-Pending-Round' }
        ]
      })

      expect(result.Messages).to.have.lengthOf(1)
      expect(result.Messages[0].Data).to.equal('OK')
    })

    it('Require valid score data', async () => {
      
      const result = await handle({
        From: ALICE_ADDRESS,
        Tags: [
          { name: 'Action', value: 'Add-Scores-To-Pending-Round' }
        ]
      })

      expect(result.Messages).to.have.lengthOf(1)
      expect(result.Messages[0].Data).to.equal('OK')
    })

    it('Require at least one score when adding scores', async () => {
      
      const result = await handle({
        From: ALICE_ADDRESS,
        Tags: [
          { name: 'Action', value: 'Add-Scores-To-Pending-Round' }
        ]
      })

      expect(result.Messages).to.have.lengthOf(1)
      expect(result.Messages[0].Data).to.equal('OK')
    })

    it('Require added scores to have unique fingerprints', async () => {
      
      const result = await handle({
        From: ALICE_ADDRESS,
        Tags: [
          { name: 'Action', value: 'Add-Scores-To-Pending-Round' }
        ]
      })

      expect(result.Messages).to.have.lengthOf(1)
      expect(result.Messages[0].Data).to.equal('OK')
    })
  })
})