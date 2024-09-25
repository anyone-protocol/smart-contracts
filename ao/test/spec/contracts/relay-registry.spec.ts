import { expect } from 'chai'

import {
  ALICE_ADDRESS,
  ALICE_PUBKEY,
  AOTestHandle,
  createLoader,
  EXAMPLE_FINGERPRINT,
  EXAMPLE_MASTER_ID_PUBLIC_KEY,
  EXAMPLE_RSA_IDENTITY_PUBLIC_KEY,
  EXAMPLE_SECRET_ID_KEY,
  EXAMPLE_SIGNING_CERT,
  EXAMPLE_SIGNING_PUBLIC_KEY,
  FINGERPRINT_A
} from '~/test/util/setup'

describe('Relay Registry', () => {
  let handle: AOTestHandle

  beforeEach(async () => {
    handle = (await createLoader()).handle
  })

  /**
   * From: https://spec.torproject.org/dir-spec/server-descriptor-format.html
   * 
   * "onion-key-crosscert" NL a RSA signature in PEM format.
   *
   * [At most once] [No extra arguments]
   *
   * This element MUST be present if onion-key is present. Clients SHOULD
   * validate this element if it is provided.
   *
   * This element contains an RSA signature, generated using the onion-key, of
   * the following:
   *
   *       A SHA1 hash of the RSA identity key,
   *         i.e. RSA key from "signing-key" (see below) [20 bytes]
   *       The Ed25519 identity key,
   *         i.e. Ed25519 key from "master-key-ed25519" [32 bytes]
   *
   * If there is no Ed25519 identity key, or if in some future version there is
   * no RSA identity key, the corresponding field must be zero-filled.
   *
   * Parties verifying this signature MUST allow additional data beyond the
   * 52 bytes listed above.
   *
   * This signature proves that the party creating the descriptor had control
   * over the secret key corresponding to the onion-key.
   * 
   * 
   * ANYONE-PROTOCOL NB: We ignore signature in this spec here as we rely on
   *                     ANS-104 spec signature since the OKCC is submitted
   *                     with the relay's RSA identity key.
   */
  describe('Onion Key Cross Certificates', () => {
    it('Accepts valid OKCC', async () => {
      const okcc = Buffer.concat([
        EXAMPLE_FINGERPRINT,
        EXAMPLE_MASTER_ID_PUBLIC_KEY.subarray(32)
      ])

      const result = await handle({
        From: EXAMPLE_RSA_IDENTITY_PUBLIC_KEY.toString('base64'),
        Tags: [
          { name: 'Action', value: 'Submit-Onion-Key-Cross-Certificate' },
          {
            name: 'Onion-Key-Cross-Certificate',
            value: okcc.toString('base64')
          }
        ]
      })

      expect(result.Messages).to.have.lengthOf(1)
      expect(result.Messages[0].Data).to.equal('OK')
    })

    it('Rejects missing OKCC', async () => {
      const result = await handle({
        From: EXAMPLE_RSA_IDENTITY_PUBLIC_KEY.toString('base64'),
        Tags: [
          { name: 'Action', value: 'Submit-Onion-Key-Cross-Certificate' }
        ]
      })

      expect(result.Error)
        .to.be.a('string')
        .that.includes('Invalid certificate')
    })

    it('Rejects OKCC with invalid base64 encoding', async () => {
      const result = await handle({
        From: EXAMPLE_RSA_IDENTITY_PUBLIC_KEY.toString('base64'),
        Tags: [
          { name: 'Action', value: 'Submit-Onion-Key-Cross-Certificate' },
          {
            name: 'Onion-Key-Cross-Certificate',
            value: 'invalid-base-64-lol-????????????'
          }
        ]
      })

      expect(result.Error)
        .to.be.a('string')
        .that.includes('Invalid certificate')
    })

    it('Rejects OKCC without Master ID keys (ed25519)', async () => {
      const result = await handle({
        From: EXAMPLE_RSA_IDENTITY_PUBLIC_KEY.toString('base64'),
        Tags: [
          { name: 'Action', value: 'Submit-Onion-Key-Cross-Certificate' },
          {
            name: 'Onion-Key-Cross-Certificate',
            value: EXAMPLE_FINGERPRINT.toString('base64')
          }
        ]
      })
      expect(result.Error)
        .to.be.a('string')
        .that.includes('Invalid certificate')
    })

    it('Rejects OKCC without Fingerprint', async () => {
      const result = await handle({
        From: EXAMPLE_RSA_IDENTITY_PUBLIC_KEY.toString('base64'),
        Tags: [
          { name: 'Action', value: 'Submit-Onion-Key-Cross-Certificate' },
          {
            name: 'Onion-Key-Cross-Certificate',
            value: EXAMPLE_MASTER_ID_PUBLIC_KEY.subarray(32).toString('base64')
          }
        ]
      })
      expect(result.Error)
        .to.be.a('string')
        .that.includes('Invalid certificate')
    })

    it('Rejects OKCC with Fingerprint not matching Caller', async () => {
      const result = await handle({
        From: EXAMPLE_RSA_IDENTITY_PUBLIC_KEY.toString('base64'),
        Tags: [
          { name: 'Action', value: 'Submit-Onion-Key-Cross-Certificate' },
          {
            name: 'Onion-Key-Cross-Certificate',
            value: Buffer
              .concat([
                Buffer.from(FINGERPRINT_A, 'hex'),
                EXAMPLE_MASTER_ID_PUBLIC_KEY.subarray(32)
              ])
              .toString('base64')
          }
        ]
      })
      expect(result.Error)
        .to.be.a('string')
        .that.includes('Invalid certificate')
    })
  })

  describe('Signing Certificates', () => {
    it('Accepts Signing Certs of known Master IDs', async () => {
      const okcc = Buffer.concat([
        EXAMPLE_FINGERPRINT,
        EXAMPLE_MASTER_ID_PUBLIC_KEY.subarray(32)
      ])
      await handle({
        From: EXAMPLE_RSA_IDENTITY_PUBLIC_KEY.toString('base64'),
        Tags: [
          { name: 'Action', value: 'Submit-Onion-Key-Cross-Certificate' },
          {
            name: 'Onion-Key-Cross-Certificate',
            value: okcc.toString('base64')
          }
        ]
      })

      const result = await handle({
        From: EXAMPLE_MASTER_ID_PUBLIC_KEY.subarray(32).toString('base64'),
        Tags: [
          { name: 'Action', value: 'Submit-Signing-Certificate' },
          {
            name: 'Signing-Certificate',
            value: EXAMPLE_SIGNING_CERT.toString('base64')
          }
        ]
      })

      expect(result.Messages).to.have.lengthOf(1)
      expect(result.Messages[0].Data).to.equal('OK')
    })

    it('Rejects Signing Certs of unknown Master IDs', async () => {
      const result = await handle({
        From: EXAMPLE_SIGNING_PUBLIC_KEY.toString('base64'),
        Tags: [
          { name: 'Action', value: 'Submit-Signing-Certificate' },
          {
            name: 'Signing-Certificate',
            value: EXAMPLE_SIGNING_CERT.toString('base64')
          }
        ]
      })

      expect(result.Error)
        .to.be.a('string')
        .that.includes('Invalid certificate')
    })

    it('Rejects Signing Certs of Master ID not matching caller', async () => {
      const okcc = Buffer.concat([
        EXAMPLE_FINGERPRINT,
        EXAMPLE_MASTER_ID_PUBLIC_KEY.subarray(32)
      ])
      await handle({
        From: EXAMPLE_RSA_IDENTITY_PUBLIC_KEY.toString('base64'),
        Tags: [
          { name: 'Action', value: 'Submit-Onion-Key-Cross-Certificate' },
          {
            name: 'Onion-Key-Cross-Certificate',
            value: okcc.toString('base64')
          }
        ]
      })

      const result = await handle({
        From: Buffer.from(ALICE_ADDRESS, 'hex').toString('base64'),
        Tags: [
          { name: 'Action', value: 'Submit-Signing-Certificate' },
          {
            name: 'Signing-Certificate',
            value: EXAMPLE_SIGNING_CERT.toString('base64')
          }
        ]
      })

      expect(result.Error)
        .to.be.a('string')
        .that.includes('Invalid certificate')
    })
  })

  describe('Operator Certificates', () => {
    it('Accepts Operator Certs', async () => {
      const okcc = Buffer.concat([
        EXAMPLE_FINGERPRINT,
        EXAMPLE_MASTER_ID_PUBLIC_KEY.subarray(32)
      ])
      await handle({
        From: EXAMPLE_RSA_IDENTITY_PUBLIC_KEY.toString('base64'),
        Tags: [
          { name: 'Action', value: 'Submit-Onion-Key-Cross-Certificate' },
          {
            name: 'Onion-Key-Cross-Certificate',
            value: okcc.toString('base64')
          }
        ]
      })
      await handle({
        From: EXAMPLE_MASTER_ID_PUBLIC_KEY.subarray(32).toString('base64'),
        Tags: [
          { name: 'Action', value: 'Submit-Signing-Certificate' },
          {
            name: 'Signing-Certificate',
            value: EXAMPLE_SIGNING_CERT.toString('base64')
          }
        ]
      })

      const cert = Buffer.concat([
        EXAMPLE_FINGERPRINT,
        Buffer.from(ALICE_ADDRESS.substring(2), 'hex')
      ])
      const result = await handle({
        From: EXAMPLE_SIGNING_PUBLIC_KEY.toString('base64'),
        Tags: [
          { name: 'Action', value: 'Submit-Operator-Certificate' },
          { name: 'Operator-Certificate', value: cert.toString('base64') }
        ]
      })

      expect(result.Messages).to.have.lengthOf(1)
      expect(result.Messages[0].Data).to.equal('OK')
    })

    it('Rejects Operator Certs from unknown Signing Keys', async () => {
      const okcc = Buffer.concat([
        EXAMPLE_FINGERPRINT,
        EXAMPLE_MASTER_ID_PUBLIC_KEY.subarray(32)
      ])
      await handle({
        From: EXAMPLE_RSA_IDENTITY_PUBLIC_KEY.toString('base64'),
        Tags: [
          { name: 'Action', value: 'Submit-Onion-Key-Cross-Certificate' },
          {
            name: 'Onion-Key-Cross-Certificate',
            value: okcc.toString('base64')
          }
        ]
      })
      const cert = Buffer.concat([
        EXAMPLE_FINGERPRINT,
        Buffer.from(ALICE_ADDRESS.substring(2), 'hex')
      ])
      const result = await handle({
        From: EXAMPLE_SIGNING_PUBLIC_KEY.toString('base64'),
        Tags: [
          { name: 'Action', value: 'Submit-Operator-Certificate' },
          { name: 'Operator-Certificate', value: cert.toString('base64') }
        ]
      })

      expect(result.Error)
        .to.be.a('string')
        .that.includes('Invalid certificate')
    })

    it('Rejects Operator Certs of unknown Fingerprints', async () => {
      const cert = Buffer.concat([
        Buffer.from(FINGERPRINT_A, 'hex'),
        Buffer.from(ALICE_ADDRESS.substring(2), 'hex')
      ])
      const result = await handle({
        From: EXAMPLE_SIGNING_PUBLIC_KEY.toString('base64'),
        Tags: [
          { name: 'Action', value: 'Submit-Operator-Certificate' },
          { name: 'Operator-Certificate', value: cert.toString('base64') }
        ]
      })

      expect(result.Error)
        .to.be.a('string')
        .that.includes('Invalid certificate')
    })
  })

  describe('Fingerprint Certificates', () => {
    it('Accepts Fingerprint Certs', async () => {
      const okcc = Buffer.concat([
        EXAMPLE_FINGERPRINT,
        EXAMPLE_MASTER_ID_PUBLIC_KEY.subarray(32)
      ])
      await handle({
        From: EXAMPLE_RSA_IDENTITY_PUBLIC_KEY.toString('base64'),
        Tags: [
          { name: 'Action', value: 'Submit-Onion-Key-Cross-Certificate' },
          {
            name: 'Onion-Key-Cross-Certificate',
            value: okcc.toString('base64')
          }
        ]
      })
      await handle({
        From: EXAMPLE_MASTER_ID_PUBLIC_KEY.subarray(32).toString('base64'),
        Tags: [
          { name: 'Action', value: 'Submit-Signing-Certificate' },
          {
            name: 'Signing-Certificate',
            value: EXAMPLE_SIGNING_CERT.toString('base64')
          }
        ]
      })
      const operatorCert = Buffer.concat([
        EXAMPLE_FINGERPRINT,
        Buffer.from(ALICE_ADDRESS.substring(2), 'hex')
      ])
      await handle({
        From: EXAMPLE_SIGNING_PUBLIC_KEY.toString('base64'),
        Tags: [
          { name: 'Action', value: 'Submit-Operator-Certificate' },
          {
            name: 'Operator-Certificate',
            value: operatorCert.toString('base64')
          }
        ]
      })

      const result = await handle({
        From: ALICE_ADDRESS,
        Tags: [
          { name: 'Action', value: 'Submit-Fingerprint-Certificate' },
          {
            name: 'Fingerprint-Certificate',
            value: EXAMPLE_FINGERPRINT.toString('hex')
          }
        ]
      })

      expect(result.Messages).to.have.lengthOf(1)
      expect(result.Messages[0].Data).to.equal('OK')
    })

    it('Rejects Fingerprint Certs of unknown Fingerprints', async () => {
      const result = await handle({
        From: ALICE_ADDRESS,
        Tags: [
          { name: 'Action', value: 'Submit-Fingerprint-Certificate' },
          {
            name: 'Fingerprint-Certificate',
            value: EXAMPLE_FINGERPRINT.toString('hex')
          }
        ]
      })

      expect(result.Error)
        .to.be.a('string')
        .that.includes('Invalid certificate')
    })
  })

  describe('Operator Renouncing Fingerprints', () => { it('TODO') })

  describe('Admin Removing Fingerprints', () => { it('TODO') })

  describe('Blocking Operator Address', () => { it('TODO') })

  describe('Registration Credits', () => { it('TODO') })

  describe('Families', () => { it('TODO') })

  describe('TODO -> various view methods', () => { it('TODO') })

  // describe('Claiming', () => {
  //   it('Allows anyone to submit fingerprint/address proofs', async () => {
  //     const result = await handle({
  //       From: ALICE_PUBKEY,
  //       Tags: [
  //         { name: 'Action', value: 'Submit-Fingerprint-Proof' },
  //         { name: 'Address', value: ALICE_ADDRESS }
  //       ]
  //     })

  //     expect(result.Messages).to.have.lengthOf(1)
  //     expect(result.Messages[0].Data).to.equal('OK')
  //   })

  //   it('Validates fingerprint/address proofs', async () => {
  //     const noAddressResult = await handle({
  //       From: ALICE_PUBKEY,
  //       Tags: [
  //         { name: 'Action', value: 'Submit-Fingerprint-Proof' }
  //       ]
  //     })
      
  //     expect(noAddressResult.Error).to.be.a('string')
  //     expect(noAddressResult.Error).to.include('Invalid address')

  //     const smallAddressResult = await handle({
  //       From: ALICE_PUBKEY,
  //       Tags: [
  //         { name: 'Action', value: 'Submit-Fingerprint-Proof' },
  //         { name: 'Address', value: '0xabcdef1234567890' }
  //       ]
  //     })

  //     expect(smallAddressResult.Error).to.be.a('string')
  //     expect(smallAddressResult.Error).to.include('Invalid address')

  //     const badAddressResult = await handle({
  //       From: ALICE_PUBKEY,
  //       Tags: [
  //         { name: 'Action', value: 'Submit-Fingerprint-Proof' },
  //         {
  //           name: 'Address',
  //           value: '0xinvalid-address-invalid-address-invalidd'
  //         }
  //       ]
  //     })

  //     expect(badAddressResult.Error).to.be.a('string')
  //     expect(badAddressResult.Error).to.include('Invalid address')
  //   })

  //   it('Errors when proof already exists for fingerprint', async () => {
  //     await handle({
  //       From: ALICE_PUBKEY,
  //       Tags: [
  //         { name: 'Action', value: 'Submit-Fingerprint-Proof' },
  //         { name: 'Address', value: ALICE_ADDRESS }
  //       ]
  //     })

  //     const result = await handle({
  //       From: ALICE_PUBKEY,
  //       Tags: [
  //         { name: 'Action', value: 'Submit-Fingerprint-Proof' },
  //         { name: 'Address', value: ALICE_ADDRESS }
  //       ]
  //     })

  //     expect(result.Error).to.be.a('string')
  //     expect(result.Error).to.include(
  //       'Fingerprint is already claimable by address'
  //     )
  //   })
  // })
})
