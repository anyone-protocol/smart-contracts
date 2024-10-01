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

/**
 * Test scenario helper functions
 * 
 * A full registration process is:
 *  1) Fingerprint Identity (RSA) submits Onion Key Cross Certificate
 *  2) Master Identity (ED25519) submits Signing Certificate
 *  3) Signing Identity (ED25519) submits Operator Certificate
 *  4) Operator Address (SECP256K1 aka EVM) submits Fingerprint Certificate
 */
async function setupOnionKeyCrossCertificate(
  handle: AOTestHandle,
  debug = false
) {
  const okcc = Buffer.concat([
    EXAMPLE_FINGERPRINT,
    EXAMPLE_MASTER_ID_PUBLIC_KEY.subarray(32)
  ])
  const setupOnionKeyCrossCertificateResult = await handle({
    From: EXAMPLE_RSA_IDENTITY_PUBLIC_KEY.toString('base64'),
    Tags: [
      { name: 'Action', value: 'Submit-Onion-Key-Cross-Certificate' },
      {
        name: 'Onion-Key-Cross-Certificate',
        value: okcc.toString('base64')
      }
    ]
  })

  if (debug) {
    console.log(
      'setupOnionKeyCrossCertificateResult',
      setupOnionKeyCrossCertificateResult
    )
  }
}

async function setupSigningCertificate(handle: AOTestHandle, debug = false) {
  await setupOnionKeyCrossCertificate(handle)

  const setupSigningCertificateResult = await handle({
    From: EXAMPLE_MASTER_ID_PUBLIC_KEY.subarray(32).toString('base64'),
    Tags: [
      { name: 'Action', value: 'Submit-Signing-Certificate' },
      {
        name: 'Signing-Certificate',
        value: EXAMPLE_SIGNING_CERT.toString('base64')
      }
    ]
  })

  if (debug) {
    console.log('setupSigningCertificateResult', setupSigningCertificateResult)
  }
}

async function setupOperatorCertificate(handle: AOTestHandle, debug = false) {
  await setupSigningCertificate(handle)

  const operatorCert = Buffer.concat([
    EXAMPLE_FINGERPRINT,
    Buffer.from(ALICE_ADDRESS.substring(2), 'hex')
  ])
  const setupOperatorCertificateResult = await handle({
    From: EXAMPLE_SIGNING_PUBLIC_KEY.toString('base64'),
    Tags: [
      { name: 'Action', value: 'Submit-Operator-Certificate' },
      {
        name: 'Operator-Certificate',
        value: operatorCert.toString('base64')
      }
    ]
  })

  if (debug) {
    console.log(
      'setupOperatorCertificateResult',
      setupOperatorCertificateResult
    )
  }
}

async function setupFingerprintCertificates(
  handle: AOTestHandle,
  debug = false
) {
  await setupOperatorCertificate(handle)

  const setupFingerprintCertificatesResult = await handle({
    From: ALICE_ADDRESS,
    Tags: [
      { name: 'Action', value: 'Submit-Fingerprint-Certificate' },
      {
        name: 'Fingerprint-Certificate',
        value: EXAMPLE_FINGERPRINT.toString('hex').toUpperCase()
      }
    ]
  })

  if (debug) {
    console.log(
      'setupFingerprintCertificatesResult',
      setupFingerprintCertificatesResult
    )
  }
}

async function addRegistrationCredit(
  handle: AOTestHandle,
  address: string, 
  fingerprint: string,
  debug = false
) {
  const addRegistrationCreditResult = await handle({
    From: OWNER_ADDRESS,
    Tags: [
      { name: 'Action', value: 'Add-Registration-Credit' },
      { name: 'Address', value: address },
      { name: 'Fingerprint', value: fingerprint }
    ]
  })

  if (debug) {
    console.log('addRegistrationCreditResult', addRegistrationCreditResult)
  }
}

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
      const fingerprint = EXAMPLE_FINGERPRINT.toString('hex').toUpperCase()

      await setupOperatorCertificate(handle)
      await addRegistrationCredit(handle, ALICE_ADDRESS, fingerprint)

      const result = await handle({
        From: ALICE_ADDRESS,
        Tags: [
          { name: 'Action', value: 'Submit-Fingerprint-Certificate' },
          {
            name: 'Fingerprint-Certificate',
            value: fingerprint
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

    it('Lists Fingerprint & Operator Address Mappings', async () => {
      await setupFingerprintCertificates(handle)

      const result = await handle({
        From: BOB_ADDRESS,
        Tags: [
          { name: 'Action', value: 'List-Fingerprint-Certificates' }
        ]
      })

      expect(result.Messages).to.have.lengthOf(1)
      expect(JSON.parse(result.Messages[0].Data)).to.deep.equal({
        [EXAMPLE_FINGERPRINT.toString('hex').toUpperCase()]:
          '0x' + ALICE_ADDRESS.substring(2).toUpperCase()
      })
    })
  })

  describe('Operator Renouncing Fingerprint Certificates', () => {
    it('Allows Operators to renounce Fingerprint Certificates', async () => {
      const fingerprint = EXAMPLE_FINGERPRINT.toString('hex').toUpperCase()
      await addRegistrationCredit(handle, ALICE_ADDRESS, fingerprint)
      await setupFingerprintCertificates(handle)

      const result = await handle({
        From: ALICE_ADDRESS,
        Tags: [
          { name: 'Action', value: 'Renounce-Fingerprint-Certificate' },
          {
            name: 'Fingerprint',
            value: fingerprint
          }
        ]
      })

      expect(result.Messages).to.have.lengthOf(1)
      expect(result.Messages[0].Data).to.equal('OK')

      const listResult = await handle({
        From: BOB_ADDRESS,
        Tags: [
          { name: 'Action', value: 'List-Fingerprint-Certificates' }
        ]
      })

      expect(listResult.Messages).to.have.lengthOf(1)
      expect(JSON.parse(listResult.Messages[0].Data)).to.deep.equal([])
    })

    it('Rejects renounces missing a Fingerprint', async () => {
      const result = await handle({
        From: ALICE_ADDRESS,
        Tags: [
          { name: 'Action', value: 'Renounce-Fingerprint-Certificate' }
        ]
      })

      expect(result.Error)
        .to.be.a('string')
        .that.includes('Fingerprint required')
    })

    it('Rejects renounces from non-Operators', async () => {
      await setupFingerprintCertificates(handle)

      const result = await handle({
        From: BOB_ADDRESS,
        Tags: [
          { name: 'Action', value: 'Renounce-Fingerprint-Certificate' },
          {
            name: 'Fingerprint',
            value: EXAMPLE_FINGERPRINT.toString('hex').toUpperCase()
          }
        ]
      })

      expect(result.Error)
        .to.be.a('string')
        .that.includes('Only the Relay Operator can renounce')
    })

    it('Rejects renounces of unknown Fingerprints', async () => {
      const result = await handle({
        From: ALICE_ADDRESS,
        Tags: [
          { name: 'Action', value: 'Renounce-Fingerprint-Certificate' },
          {
            name: 'Fingerprint',
            value: EXAMPLE_FINGERPRINT.toString('hex').toUpperCase()
          }
        ]
      })

      expect(result.Error)
        .to.be.a('string')
        .that.includes('Only the Relay Operator can renounce')
    })
  })

  describe('Admin Removing Fingerprint Certificates', () => {
    it('Allows Admin to remove Fingerprint Certificates', async () => {
      await setupFingerprintCertificates(handle)

      const result = await handle({
        From: OWNER_ADDRESS,
        Tags: [
          { name: 'Action', value: 'Remove-Fingerprint-Certificate' },
          {
            name: 'Fingerprint',
            value: EXAMPLE_FINGERPRINT.toString('hex').toUpperCase()
          }
        ]
      })

      expect(result.Messages).to.have.lengthOf(1)
      expect(result.Messages[0].Data).to.equal('OK')

      const listResult = await handle({
        From: BOB_ADDRESS,
        Tags: [
          { name: 'Action', value: 'List-Fingerprint-Certificates' }
        ]
      })

      expect(listResult.Messages).to.have.lengthOf(1)
      expect(JSON.parse(listResult.Messages[0].Data)).to.deep.equal([])
    })

    it('Rejects removing when missing a Fingerprint', async () => {
      await setupFingerprintCertificates(handle)

      const result = await handle({
        From: OWNER_ADDRESS,
        Tags: [
          { name: 'Action', value: 'Remove-Fingerprint-Certificate' }
        ]
      })

      expect(result.Error)
        .to.be.a('string')
        .that.includes('Fingerprint required')
    })

    it('Rejects removing from non-Admin', async () => {
      await setupFingerprintCertificates(handle)

      const result = await handle({
        From: BOB_ADDRESS,
        Tags: [
          { name: 'Action', value: 'Remove-Fingerprint-Certificate' },
          {
            name: 'Fingerprint',
            value: EXAMPLE_FINGERPRINT.toString('hex').toUpperCase()
          }
        ]
      })

      expect(result.Error)
        .to.be.a('string')
        .that.includes('This method is only available to the Owner')
    })

    it('Rejects removing of unknown Fingerprints', async () => {
      const result = await handle({
        From: OWNER_ADDRESS,
        Tags: [
          { name: 'Action', value: 'Remove-Fingerprint-Certificate' },
          {
            name: 'Fingerprint',
            value: EXAMPLE_FINGERPRINT.toString('hex').toUpperCase()
          }
        ]
      })

      expect(result.Error)
        .to.be.a('string')
        .that.includes('Unknown Fingerprint')
    })
  })

  describe('Blocking Operator Addresses', () => {
    describe('Blocking', () => {
      it('Allows Admin to block addresses', async () => {
        const result = await handle({
          From: OWNER_ADDRESS,
          Tags: [
            { name: 'Action', value: 'Block-Operator-Address' },
            { name: 'Address', value: ALICE_ADDRESS }
          ]
        })

        expect(result.Messages).to.have.lengthOf(1)
        expect(result.Messages[0].Data).to.equal('OK')
      })

      it('Rejects blocking when missing addresses', async () => {
        const result = await handle({
          From: OWNER_ADDRESS,
          Tags: [
            { name: 'Action', value: 'Block-Operator-Address' }
          ]
        })

        expect(result.Error)
          .to.be.a('string')
          .that.includes('Address is required')
      })

      it('Rejects blocking when invalid addresses', async () => {
        const result = await handle({
          From: OWNER_ADDRESS,
          Tags: [
            { name: 'Action', value: 'Block-Operator-Address' },
            { name: 'Address', value: 'invalid-address' }
          ]
        })

        expect(result.Error)
          .to.be.a('string')
          .that.includes('Invalid Address')
      })

      it('Rejects blocking addresses from non-admin', async () => {
        const result = await handle({
          From: BOB_ADDRESS,
          Tags: [
            { name: 'Action', value: 'Block-Operator-Address' },
            { name: 'Address', value: ALICE_ADDRESS }
          ]
        })

        expect(result.Error)
          .to.be.a('string')
          .that.includes('This method is only available to the Owner')
      })

      it(
        'Prevents blocked addresses from submitting Fingerprint Certificates',
        async () => {
          await setupOperatorCertificate(handle)
          await handle({
            From: OWNER_ADDRESS,
            Tags: [
              { name: 'Action', value: 'Block-Operator-Address' },
              { name: 'Address', value: ALICE_ADDRESS }
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

          expect(result.Error)
            .to.be.a('string')
            .that.includes('Address is blocked')
        }
      )
    })

    describe('Listing', () => {
      it('Lists Blocked Addresses', async () => {
        const addresses = [ ALICE_ADDRESS, BOB_ADDRESS, CHARLS_ADDRESS ]
        for (const address of addresses) {
          await handle({
            From: OWNER_ADDRESS,
            Tags: [
              { name: 'Action', value: 'Block-Operator-Address' },
              { name: 'Address', value: address }
            ]
          })
        }

        const result = await handle({
          From: ALICE_ADDRESS,
          Tags: [{ name: 'Action', value: 'List-Blocked-Operator-Addresses' }]
        })

        expect(result.Messages).to.have.lengthOf(1)
        expect(JSON.parse(result.Messages[0].Data))
          .to.deep.equal(Object.fromEntries(addresses.map(a => [a, true])))
      })
    })

    describe('Unblocking', () => {
      it('Allows Admin to unblock addresses', async () => {
        await handle({
          From: OWNER_ADDRESS,
          Tags: [
            { name: 'Action', value: 'Block-Operator-Address' },
            { name: 'Address', value: ALICE_ADDRESS }
          ]
        })

        const result = await handle({
          From: OWNER_ADDRESS,
          Tags: [
            { name: 'Action', value: 'Unblock-Operator-Address' },
            { name: 'Address', value: ALICE_ADDRESS }
          ]
        })

        expect(result.Messages).to.have.lengthOf(1)
        expect(result.Messages[0].Data).to.equal('OK')
      })

      it('Rejects unblocking when missing addresses', async () => {
        const result = await handle({
          From: OWNER_ADDRESS,
          Tags: [
            { name: 'Action', value: 'Unblock-Operator-Address' }
          ]
        })

        expect(result.Error)
          .to.be.a('string')
          .that.includes('Address is required')
      })

      it('Rejects unblocking when invalid addresses', async () => {
        const result = await handle({
          From: OWNER_ADDRESS,
          Tags: [
            { name: 'Action', value: 'Unblock-Operator-Address' },
            { name: 'Address', value: 'invalid-address' }
          ]
        })

        expect(result.Error)
          .to.be.a('string')
          .that.includes('Invalid Address')
      })

      it('Rejects unblocking when address is not blocked', async () => {
        const result = await handle({
          From: OWNER_ADDRESS,
          Tags: [
            { name: 'Action', value: 'Unblock-Operator-Address' },
            { name: 'Address', value: ALICE_ADDRESS }
          ]
        })

        expect(result.Error)
          .to.be.a('string')
          .that.includes('Address is not blocked')
      })

      it('Rejects unblocking addresses from non-admin', async () => {
        const result = await handle({
          From: ALICE_ADDRESS,
          Tags: [
            { name: 'Action', value: 'Unblock-Operator-Address' },
            { name: 'Address', value: ALICE_ADDRESS }
          ]
        })

        expect(result.Error)
          .to.be.a('string')
          .that.includes('This method is only available to the Owner')
      })

      it(
        'Allows unblocked Addresses to submit Fingerprint Certificates again',
        async () => {
          const fingerprint = EXAMPLE_FINGERPRINT.toString('hex').toUpperCase()

          await setupOperatorCertificate(handle)
          await addRegistrationCredit(handle, ALICE_ADDRESS, fingerprint)

          await handle({
            From: OWNER_ADDRESS,
            Tags: [
              { name: 'Action', value: 'Block-Operator-Address' },
              { name: 'Address', value: ALICE_ADDRESS }
            ]
          })
          await handle({
            From: OWNER_ADDRESS,
            Tags: [
              { name: 'Action', value: 'Unblock-Operator-Address' },
              { name: 'Address', value: ALICE_ADDRESS }
            ]
          })

          const result = await handle({
            From: ALICE_ADDRESS,
            Tags: [
              { name: 'Action', value: 'Submit-Fingerprint-Certificate' },
              {
                name: 'Fingerprint-Certificate',
                value: fingerprint
              }
            ]
          })

          expect(result.Messages).to.have.lengthOf(1)
          expect(result.Messages[0].Data).to.equal('OK')
        }
      )
    })
  })

  describe('Registration Credits', () => {
    describe('Adding', () => {
      it('Allows Admin to add RC', async () => {
        const result = await handle({
          From: OWNER_ADDRESS,
          Tags: [
            { name: 'Action', value: 'Add-Registration-Credit' },
            { name: 'Address', value: ALICE_ADDRESS },
            {
              name: 'Fingerprint',
              value: EXAMPLE_FINGERPRINT.toString('hex').toUpperCase()
            }
          ]
        })

        expect(result.Messages).to.have.lengthOf(1)
        expect(result.Messages[0].Data).to.equal('OK')
      })

      it('Rejects adding RC when missing Address', async () => {
        const result = await handle({
          From: OWNER_ADDRESS,
          Tags: [
            { name: 'Action', value: 'Add-Registration-Credit' },
            {
              name: 'Fingerprint',
              value: EXAMPLE_FINGERPRINT.toString('hex').toUpperCase()
            }
          ]
        })

        expect(result.Error)
          .to.be.a('string')
          .that.includes('Address is required')
      })

      it('Rejects adding RC when invalid Address', async () => {
        const result = await handle({
          From: OWNER_ADDRESS,
          Tags: [
            { name: 'Action', value: 'Add-Registration-Credit' },
            { name: 'Address', value: 'invalid-address' },
            {
              name: 'Fingerprint',
              value: EXAMPLE_FINGERPRINT.toString('hex').toUpperCase()
            }
          ]
        })

        expect(result.Error)
          .to.be.a('string')
          .that.includes('Invalid Address')
      })

      it('Rejects adding RC when missing Fingerprint', async () => {
        const result = await handle({
          From: OWNER_ADDRESS,
          Tags: [
            { name: 'Action', value: 'Add-Registration-Credit' },
            { name: 'Address', value: ALICE_ADDRESS }
          ]
        })

        expect(result.Error)
          .to.be.a('string')
          .that.includes('Fingerprint required')
      })

      it('Rejects adding RC when invalid Fingerprint', async () => {
        const result = await handle({
          From: OWNER_ADDRESS,
          Tags: [
            { name: 'Action', value: 'Add-Registration-Credit' },
            { name: 'Address', value: ALICE_ADDRESS },
            {
              name: 'Fingerprint',
              value: 'invalid-fingerprint'
            }
          ]
        })

        expect(result.Error)
          .to.be.a('string')
          .that.includes('Invalid Fingerprint')
      })

      it('Rejects adding duplicate RC', async () => {
        await handle({
          From: OWNER_ADDRESS,
          Tags: [
            { name: 'Action', value: 'Add-Registration-Credit' },
            { name: 'Address', value: ALICE_ADDRESS },
            {
              name: 'Fingerprint',
              value: EXAMPLE_FINGERPRINT.toString('hex').toUpperCase()
            }
          ]
        })
        const result = await handle({
          From: OWNER_ADDRESS,
          Tags: [
            { name: 'Action', value: 'Add-Registration-Credit' },
            { name: 'Address', value: ALICE_ADDRESS },
            {
              name: 'Fingerprint',
              value: EXAMPLE_FINGERPRINT.toString('hex').toUpperCase()
            }
          ]
        })

        expect(result.Error)
          .to.be.a('string')
          .that.includes('Registration Credit already added')
      })

      it('Rejects adding RC from non-admin', async () => {
        const result = await handle({
          From: ALICE_ADDRESS,
          Tags: [
            { name: 'Action', value: 'Add-Registration-Credit' },
            { name: 'Address', value: ALICE_ADDRESS },
            {
              name: 'Fingerprint',
              value: EXAMPLE_FINGERPRINT.toString('hex').toUpperCase()
            }
          ]
        })

        expect(result.Error)
          .to.be.a('string')
          .that.includes('This method is only available to the Owner')
      })

      it('Requires RC when submitting Fingerprint Certificates', async () => {
        await setupOperatorCertificate(handle)

        const resultNoCredit = await handle({
          From: ALICE_ADDRESS,
          Tags: [
            { name: 'Action', value: 'Submit-Fingerprint-Certificate' },
            {
              name: 'Fingerprint-Certificate',
              value: EXAMPLE_FINGERPRINT.toString('hex').toUpperCase()
            }
          ]
        })

        expect(resultNoCredit.Error)
          .to.be.a('string')
          .that.includes('Registration Credit required')

        await handle({
          From: OWNER_ADDRESS,
          Tags: [
            { name: 'Action', value: 'Add-Registration-Credit' },
            { name: 'Address', value: ALICE_ADDRESS },
            {
              name: 'Fingerprint',
              value: EXAMPLE_FINGERPRINT.toString('hex').toUpperCase()
            }
          ]
        })

        const resultWithCredit = await handle({
          From: ALICE_ADDRESS,
          Tags: [
            { name: 'Action', value: 'Submit-Fingerprint-Certificate' },
            {
              name: 'Fingerprint-Certificate',
              value: EXAMPLE_FINGERPRINT.toString('hex').toUpperCase()
            }
          ]
        })

        expect(resultWithCredit.Messages).to.have.lengthOf(1)
        expect(resultWithCredit.Messages[0].Data).to.equal('OK')
      })

      it('Consumes RC when submitting Fingerprint Certificates', async () => {
        const fingerprint = EXAMPLE_FINGERPRINT.toString('hex').toUpperCase()
        await setupOperatorCertificate(handle)
        const credits = {
          [FINGERPRINT_A]: ALICE_ADDRESS,
          [FINGERPRINT_B]: BOB_ADDRESS,
          [FINGERPRINT_C]: CHARLS_ADDRESS
        }
        for (const fingerprint of Object.keys(credits)) {
          await addRegistrationCredit(handle, credits[fingerprint], fingerprint)
        }
        await addRegistrationCredit(handle, ALICE_ADDRESS, fingerprint)

        await handle({
          From: ALICE_ADDRESS,
          Tags: [
            { name: 'Action', value: 'Submit-Fingerprint-Certificate' },
            {
              name: 'Fingerprint-Certificate',
              value: fingerprint
            }
          ]
        })

        const listResult = await handle({
          From: OWNER_ADDRESS,
          Tags: [
            { name: 'Action', value: 'List-Registration-Credits' }
          ]
        })

        expect(listResult.Messages).to.have.lengthOf(1)
        expect(JSON.parse(listResult.Messages[0].Data)).to.deep.equal(credits)
      })
    })

    describe('Listing', () => {
      it('Lists Registration Credits', async () => {
        const credits = {
          [FINGERPRINT_A]: ALICE_ADDRESS,
          [FINGERPRINT_B]: BOB_ADDRESS,
          [FINGERPRINT_C]: CHARLS_ADDRESS,
          [FINGERPRINT_D]: ALICE_ADDRESS
        }

        for (const fingerprint of Object.keys(credits)) {
          await addRegistrationCredit(handle, credits[fingerprint], fingerprint)
        }

        const result = await handle({
          From: OWNER_ADDRESS,
          Tags: [
            { name: 'Action', value: 'List-Registration-Credits' }
          ]
        })

        expect(result.Messages).to.have.lengthOf(1)
        expect(JSON.parse(result.Messages[0].Data)).to.deep.equal(credits)
      })
    })

    describe('Removing', () => {
      it('Allows Admin to remove RC', async () => {
        const credits = {
          [FINGERPRINT_A]: ALICE_ADDRESS,
          [FINGERPRINT_B]: BOB_ADDRESS,
          [FINGERPRINT_C]: CHARLS_ADDRESS,
          [FINGERPRINT_D]: ALICE_ADDRESS
        }

        for (const fingerprint of Object.keys(credits)) {
          await addRegistrationCredit(handle, credits[fingerprint], fingerprint)
        }

        const result = await handle({
          From: OWNER_ADDRESS,
          Tags: [
            { name: 'Action', value: 'Remove-Registration-Credit' },
            { name: 'Address', value: ALICE_ADDRESS },
            { name: 'Fingerprint', value: FINGERPRINT_D }
          ]
        })

        expect(result.Messages).to.have.lengthOf(1)
        expect(result.Messages[0].Data).to.equal('OK')

        const listResult = await handle({
          From: OWNER_ADDRESS,
          Tags: [
            { name: 'Action', value: 'List-Registration-Credits' }
          ]
        })

        expect(listResult.Messages).to.have.lengthOf(1)
        expect(JSON.parse(listResult.Messages[0].Data)).to.deep.equal({
          [FINGERPRINT_A]: ALICE_ADDRESS,
          [FINGERPRINT_B]: BOB_ADDRESS,
          [FINGERPRINT_C]: CHARLS_ADDRESS
        })
      })

      it('Rejects removing RC when missing Address', async () => {
        const result = await handle({
          From: OWNER_ADDRESS,
          Tags: [
            { name: 'Action', value: 'Remove-Registration-Credit' },
            { name: 'Fingerprint', value: FINGERPRINT_D }
          ]
        })

        expect(result.Error)
          .to.be.a('string')
          .that.includes('Address is required')
      })

      it('Rejects removing RC when invalid Address', async () => {
        const result = await handle({
          From: OWNER_ADDRESS,
          Tags: [
            { name: 'Action', value: 'Remove-Registration-Credit' },
            { name: 'Address', value: 'invalid-address' },
            { name: 'Fingerprint', value: FINGERPRINT_D }
          ]
        })

        expect(result.Error)
          .to.be.a('string')
          .that.includes('Invalid Address')
      })

      it('Rejects removing RC when missing Fingerprint', async () => {
        const result = await handle({
          From: OWNER_ADDRESS,
          Tags: [
            { name: 'Action', value: 'Remove-Registration-Credit' },
            { name: 'Address', value: ALICE_ADDRESS }
          ]
        })

        expect(result.Error)
          .to.be.a('string')
          .that.includes('Fingerprint required')
      })

      it('Rejects removing RC when invalid Fingerprint', async () => {
        const result = await handle({
          From: OWNER_ADDRESS,
          Tags: [
            { name: 'Action', value: 'Remove-Registration-Credit' },
            { name: 'Address', value: ALICE_ADDRESS },
            { name: 'Fingerprint', value: 'invalid-fingerprint' }
          ]
        })

        expect(result.Error)
          .to.be.a('string')
          .that.includes('Invalid Fingerprint')
      })

      it('Rejects removing non-existant RC', async () => {
        const result = await handle({
          From: OWNER_ADDRESS,
          Tags: [
            { name: 'Action', value: 'Remove-Registration-Credit' },
            { name: 'Address', value: ALICE_ADDRESS },
            { name: 'Fingerprint', value: FINGERPRINT_D }
          ]
        })

        expect(result.Error)
          .to.be.a('string')
          .that.includes('Registration Credit does not exist')
      })

      it('Rejects removing RC from non-admin', async () => {
        const result = await handle({
          From: ALICE_ADDRESS,
          Tags: [
            { name: 'Action', value: 'Remove-Registration-Credit' },
            { name: 'Address', value: ALICE_ADDRESS },
            { name: 'Fingerprint', value: FINGERPRINT_D }
          ]
        })

        expect(result.Error)
          .to.be.a('string')
          .that.includes('This method is only available to the Owner')
      })

      it('Requires RC when submitting Fingerprint Certificates', async () => {
        const fingerprint = EXAMPLE_FINGERPRINT.toString('hex').toUpperCase()
        await setupOperatorCertificate(handle)

        // 1) Add a registration credit for alice for fingerprint
        await addRegistrationCredit(handle, ALICE_ADDRESS, fingerprint)

        // 2) Remove it
        await handle({
          From: OWNER_ADDRESS,
          Tags: [
            { name: 'Action', value: 'Remove-Registration-Credit' },
            { name: 'Address', value: ALICE_ADDRESS },
            { name: 'Fingerprint', value: fingerprint }
          ]
        })

        // 3) Alice tries to register
        const resultNoCredit = await handle({
          From: ALICE_ADDRESS,
          Tags: [
            { name: 'Action', value: 'Submit-Fingerprint-Certificate' },
            {
              name: 'Fingerprint-Certificate',
              value: fingerprint
            }
          ]
        })

        // 4) Should be rejected as the registration credit was removed
        expect(resultNoCredit.Error)
          .to.be.a('string')
          .that.includes('Registration Credit required')

        // 5) Add the registration credit back again
        await addRegistrationCredit(handle, ALICE_ADDRESS, fingerprint)

        // 6) Now Alice can register
        const resultWithCredit = await handle({
          From: ALICE_ADDRESS,
          Tags: [
            { name: 'Action', value: 'Submit-Fingerprint-Certificate' },
            {
              name: 'Fingerprint-Certificate',
              value: fingerprint
            }
          ]
        })

        expect(resultWithCredit.Messages).to.have.lengthOf(1)
        expect(resultWithCredit.Messages[0].Data).to.equal('OK')
      })
    })
  })

  describe('Verified Hardware', () => {
    describe('Adding', () => {
      it('Allows Admin to add VH Fingerprints', async () => {
        const fingerprints = [
          FINGERPRINT_A,
          FINGERPRINT_B,
          FINGERPRINT_C,
          FINGERPRINT_D
        ]

        const result = await handle({
          From: OWNER_ADDRESS,
          Tags: [
            { name: 'Action', value: 'Add-Verified-Hardware' },
            { name: 'Fingerprints', value: fingerprints.join(',') }
          ]
        })

        expect(result.Messages).to.have.lengthOf(1)
        expect(result.Messages[0].Data).to.equal('OK')
      })

      it('Rejects adding VH when missing fingerprints', async () => {
        const result = await handle({
          From: OWNER_ADDRESS,
          Tags: [
            { name: 'Action', value: 'Add-Verified-Hardware' }
          ]
        })

        expect(result.Error)
          .to.be.a('string')
          .that.includes('A comma-separated list of Fingerprints is required')
      })

      it('Rejects adding VH when invalid fingerprints', async () => {
        const result = await handle({
          From: OWNER_ADDRESS,
          Tags: [
            { name: 'Action', value: 'Add-Verified-Hardware' },
            {
              name: 'Fingerprints',
              value: `${FINGERPRINT_A},invalid-fingerprint`
            }
          ]
        })

        expect(result.Error)
          .to.be.a('string')
          .that.includes('Invalid Fingerprint')
      })

      it('Rejects adding duplicate VH fingerprints', async () => {
        const fingerprints = [
          FINGERPRINT_A,
          FINGERPRINT_B,
          FINGERPRINT_C
        ]

        await handle({
          From: OWNER_ADDRESS,
          Tags: [
            { name: 'Action', value: 'Add-Verified-Hardware' },
            { name: 'Fingerprints', value: fingerprints.join(',') }
          ]
        })

        const result = await handle({
          From: OWNER_ADDRESS,
          Tags: [
            { name: 'Action', value: 'Add-Verified-Hardware' },
            {
              name: 'Fingerprints',
              value: `${FINGERPRINT_D},${FINGERPRINT_C}`
            }
          ]
        })

        expect(result.Error)
          .to.be.a('string')
          .that.includes('Duplicate Fingerprint')
      })

      it('Rejects adding VH from non-admin', async () => {
        const result = await handle({
          From: ALICE_ADDRESS,
          Tags: [
            { name: 'Action', value: 'Add-Verified-Hardware' },
            {
              name: 'Fingerprints',
              value: FINGERPRINT_A
            }
          ]
        })

        expect(result.Error)
          .to.be.a('string')
          .that.includes('This method is only available to the Owner')
      })

      it('Does not require Registration Credits for VH', async () => {
        const fingerprint = EXAMPLE_FINGERPRINT.toString('hex').toUpperCase()
        await setupOperatorCertificate(handle)

        const resultNotVerifiedYet = await handle({
          From: ALICE_ADDRESS,
          Tags: [
            { name: 'Action', value: 'Submit-Fingerprint-Certificate' },
            {
              name: 'Fingerprint-Certificate',
              value: fingerprint
            }
          ]
        })
        
        expect(resultNotVerifiedYet.Error)
          .to.be.a('string')
          .that.includes('Registration Credit required')

        await handle({
          From: OWNER_ADDRESS,
          Tags: [
            { name: 'Action', value: 'Add-Verified-Hardware' },
            { name: 'Fingerprints', value: fingerprint }
          ]
        })

        const resultAfterVerified = await handle({
          From: ALICE_ADDRESS,
          Tags: [
            { name: 'Action', value: 'Submit-Fingerprint-Certificate' },
            {
              name: 'Fingerprint-Certificate',
              value: fingerprint
            }
          ]
        })

        expect(resultAfterVerified.Messages).to.have.lengthOf(1)
        expect(resultAfterVerified.Messages[0].Data).to.equal('OK')
      })
    })

    describe('Listing', () => {
      it('Lists VH', async () => {
        const fingerprints = [
          FINGERPRINT_A,
          FINGERPRINT_B,
          FINGERPRINT_C,
          FINGERPRINT_D
        ]
        await handle({
          From: OWNER_ADDRESS,
          Tags: [
            { name: 'Action', value: 'Add-Verified-Hardware' },
            { name: 'Fingerprints', value: fingerprints.join(',') }
          ]
        })

        const result = await handle({
          From: ALICE_ADDRESS,
          Tags: [{ name: 'Action', value: 'List-Verified-Hardware' }]
        })

        expect(result.Messages).to.have.lengthOf(1)
        expect(JSON.parse(result.Messages[0].Data))
          .to.deep.equal(Object.fromEntries(fingerprints.map(f => [f, true])))
      })
    })

    describe('Removing', () => {
      it('Allows Admin to remove VH Fingerprints', async () => {
        const fingerprints = [
          FINGERPRINT_A,
          FINGERPRINT_B,
          FINGERPRINT_C,
          FINGERPRINT_D
        ]
        await handle({
          From: OWNER_ADDRESS,
          Tags: [
            { name: 'Action', value: 'Add-Verified-Hardware' },
            { name: 'Fingerprints', value: fingerprints.join(',') }
          ]
        })

        const result = await handle({
          From: OWNER_ADDRESS,
          Tags: [
            { name: 'Action', value: 'Remove-Verified-Hardware' },
            { name: 'Fingerprints', value: `${FINGERPRINT_B},${FINGERPRINT_C}` }
          ]
        })

        expect(result.Messages).to.have.lengthOf(1)
        expect(result.Messages[0].Data).to.equal('OK')
      })

      it('Rejects removing VH when missing Fingerprints', async () => {
        const result = await handle({
          From: OWNER_ADDRESS,
          Tags: [
            { name: 'Action', value: 'Remove-Verified-Hardware' }
          ]
        })

        expect(result.Error)
          .to.be.a('string')
          .that.includes('A comma-separated list of Fingerprints is required')
      })

      it('Rejects removing VH when not added', async () => {
        const result = await handle({
          From: OWNER_ADDRESS,
          Tags: [
            { name: 'Action', value: 'Remove-Verified-Hardware' },
            { name: 'Fingerprints', value: `${FINGERPRINT_B},${FINGERPRINT_C}` }
          ]
        })

        expect(result.Error)
          .to.be.a('string')
          .that.includes('Unknown Fingerprint')
      })

      it('Rejects non-Admin removing VH', async () => {
        const result = await handle({
          From: ALICE_ADDRESS,
          Tags: [
            { name: 'Action', value: 'Remove-Verified-Hardware' },
            { name: 'Fingerprints', value: `${FINGERPRINT_B},${FINGERPRINT_C}` }
          ]
        })

        expect(result.Error)
          .to.be.a('string')
          .that.includes('This method is only available to the Owner')
      })

      it('Requires Registration Credits if removed VH', async () => {
        const fingerprint = EXAMPLE_FINGERPRINT.toString('hex').toUpperCase()
        const fingerprints = [
          FINGERPRINT_A,
          FINGERPRINT_B,
          FINGERPRINT_C,
          FINGERPRINT_D,
          fingerprint
        ]
        await setupOperatorCertificate(handle)
        await handle({
          From: OWNER_ADDRESS,
          Tags: [
            { name: 'Action', value: 'Add-Verified-Hardware' },
            { name: 'Fingerprints', value: fingerprints.join(',') }
          ]
        })
        await handle({
          From: OWNER_ADDRESS,
          Tags: [
            { name: 'Action', value: 'Remove-Verified-Hardware' },
            { name: 'Fingerprints', value: fingerprint }
          ]
        })

        const result = await handle({
          From: ALICE_ADDRESS,
          Tags: [
            { name: 'Action', value: 'Submit-Fingerprint-Certificate' },
            {
              name: 'Fingerprint-Certificate',
              value: fingerprint
            }
          ]
        })

        expect(result.Error)
          .to.be.a('string')
          .that.includes('Registration Credit required')
      })
    })
  })

  describe('Families', () => {
    describe('Admin setting Families', () => {
      it('Allows Admin to set Families via Data', async () => {
        const families = {
          [FINGERPRINT_A]: [ FINGERPRINT_A, FINGERPRINT_D ],
          [FINGERPRINT_B]: [ FINGERPRINT_B, FINGERPRINT_C ],
          [FINGERPRINT_C]: [ FINGERPRINT_C, FINGERPRINT_B ],
          [FINGERPRINT_D]: [ FINGERPRINT_D, FINGERPRINT_A ],
          [FINGERPRINT_E]: [ FINGERPRINT_E ]
        }

        const result = await handle({
          From: OWNER_ADDRESS,
          Tags: [{ name: 'Action', value: 'Set-Families' }],
          Data: JSON.stringify(families)
        })

        expect(result.Messages).to.have.lengthOf(1)
        expect(result.Messages[0].Data).to.equal('OK')
      })

      it('Rejects when missing Families', async () => {
        const result = await handle({
          From: OWNER_ADDRESS,
          Tags: [{ name: 'Action', value: 'Set-Families' }]
        })

        expect(result.Error)
          .to.be.a('string')
          .that.includes('Families required as Message Data')
      })

      it('Rejects non-Admin setting Families', async () => {
        const result = await handle({
          From: ALICE_ADDRESS,
          Tags: [{ name: 'Action', value: 'Set-Families' }],
          Data: JSON.stringify({})
        })

        expect(result.Error)
          .to.be.a('string')
          .that.includes('This method is only available to the Owner')
      })

      it('Rejects invalid Families Data', async () => {
        const families = 9999999999

        const result = await handle({
          From: OWNER_ADDRESS,
          Tags: [{ name: 'Action', value: 'Set-Families' }],
          Data: JSON.stringify(families)
        })

        expect(result.Error)
          .to.be.a('string')
          .that.includes('Invalid Families')
      })

      it('Enforces Family when submitting Fingerprint Certs', async () => {
        const fingerprint = EXAMPLE_FINGERPRINT.toString('hex').toUpperCase()
        const familiesBefore = {
          [FINGERPRINT_A]: [ FINGERPRINT_A, fingerprint ]
        }
        await handle({
          From: OWNER_ADDRESS,
          Tags: [{ name: 'Action', value: 'Set-Families' }],
          Data: JSON.stringify(familiesBefore)
        })
        await setupOperatorCertificate(handle)
        await addRegistrationCredit(handle, ALICE_ADDRESS, fingerprint)

        const resultBeforeFamilySet = await handle({
          From: ALICE_ADDRESS,
          Tags: [
            { name: 'Action', value: 'Submit-Fingerprint-Certificate' },
            {
              name: 'Fingerprint-Certificate',
              value: fingerprint
            }
          ]
        })

        expect(resultBeforeFamilySet.Error)
          .to.be.a('string')
          .that.includes('Family not set')

        const familiesAfter = {
          [FINGERPRINT_A]: [ FINGERPRINT_A, fingerprint ],
          [fingerprint]: [ fingerprint, FINGERPRINT_A ]
        }
        await handle({
          From: OWNER_ADDRESS,
          Tags: [{ name: 'Action', value: 'Set-Families' }],
          Data: JSON.stringify(familiesAfter)
        })

        const resultAfterFamilySet = await handle({
          From: ALICE_ADDRESS,
          Tags: [
            { name: 'Action', value: 'Submit-Fingerprint-Certificate' },
            {
              name: 'Fingerprint-Certificate',
              value: fingerprint
            }
          ]
        })

        expect(resultAfterFamilySet.Messages).to.have.lengthOf(1)
        expect(resultAfterFamilySet.Messages[0].Data).to.equal('OK')
      })
    })

    describe('Listing Families', () => {
      it('Allows anyone to list Families', async () => {
        const families = {
          [FINGERPRINT_A]: [ FINGERPRINT_A, FINGERPRINT_D ],
          [FINGERPRINT_B]: [ FINGERPRINT_B, FINGERPRINT_C ],
          [FINGERPRINT_C]: [ FINGERPRINT_C, FINGERPRINT_B ],
          [FINGERPRINT_D]: [ FINGERPRINT_D, FINGERPRINT_A ],
          [FINGERPRINT_E]: [ FINGERPRINT_E ]
        }

        await handle({
          From: OWNER_ADDRESS,
          Tags: [{ name: 'Action', value: 'Set-Families' }],
          Data: JSON.stringify(families)
        })

        const result = await handle({
          From: ALICE_ADDRESS,
          Tags: [{ name: 'Action', value: 'List-Families' }]
        })

        expect(result.Messages).to.have.lengthOf(1)
        expect(JSON.parse(result.Messages[0].Data)).to.deep.equal(families)
      })
    })
  })

  describe('View Full State', () => {
    it('TODO')
  })
})
