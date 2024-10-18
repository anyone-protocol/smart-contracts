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

describe('Relay Directory', () => {
  let handle: AOTestHandle

  beforeEach(async () => {
    handle = (await createLoader('relay-directory')).handle
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
    // it('Accepts Operator Certs', async () => {
    //   const okcc = Buffer.concat([
    //     EXAMPLE_FINGERPRINT,
    //     EXAMPLE_MASTER_ID_PUBLIC_KEY.subarray(32)
    //   ])
    //   await handle({
    //     From: EXAMPLE_RSA_IDENTITY_PUBLIC_KEY.toString('base64'),
    //     Tags: [
    //       { name: 'Action', value: 'Submit-Onion-Key-Cross-Certificate' },
    //       {
    //         name: 'Onion-Key-Cross-Certificate',
    //         value: okcc.toString('base64')
    //       }
    //     ]
    //   })
    //   await handle({
    //     From: EXAMPLE_MASTER_ID_PUBLIC_KEY.subarray(32).toString('base64'),
    //     Tags: [
    //       { name: 'Action', value: 'Submit-Signing-Certificate' },
    //       {
    //         name: 'Signing-Certificate',
    //         value: EXAMPLE_SIGNING_CERT.toString('base64')
    //       }
    //     ]
    //   })

    //   const cert = Buffer.concat([
    //     EXAMPLE_FINGERPRINT,
    //     Buffer.from(ALICE_ADDRESS.substring(2), 'hex')
    //   ])
    //   const result = await handle({
    //     From: EXAMPLE_SIGNING_PUBLIC_KEY.toString('base64'),
    //     Tags: [
    //       { name: 'Action', value: 'Submit-Operator-Certificate' },
    //       { name: 'Operator-Certificate', value: cert.toString('base64') }
    //     ]
    //   })

    //   expect(result.Messages).to.have.lengthOf(1)
    //   expect(result.Messages[0].Data).to.equal('OK')
    // })

    // it('Rejects Operator Certs from unknown Signing Keys', async () => {
    //   const okcc = Buffer.concat([
    //     EXAMPLE_FINGERPRINT,
    //     EXAMPLE_MASTER_ID_PUBLIC_KEY.subarray(32)
    //   ])
    //   await handle({
    //     From: EXAMPLE_RSA_IDENTITY_PUBLIC_KEY.toString('base64'),
    //     Tags: [
    //       { name: 'Action', value: 'Submit-Onion-Key-Cross-Certificate' },
    //       {
    //         name: 'Onion-Key-Cross-Certificate',
    //         value: okcc.toString('base64')
    //       }
    //     ]
    //   })
    //   const cert = Buffer.concat([
    //     EXAMPLE_FINGERPRINT,
    //     Buffer.from(ALICE_ADDRESS.substring(2), 'hex')
    //   ])
    //   const result = await handle({
    //     From: EXAMPLE_SIGNING_PUBLIC_KEY.toString('base64'),
    //     Tags: [
    //       { name: 'Action', value: 'Submit-Operator-Certificate' },
    //       { name: 'Operator-Certificate', value: cert.toString('base64') }
    //     ]
    //   })

    //   expect(result.Error)
    //     .to.be.a('string')
    //     .that.includes('Invalid certificate')
    // })

    // it('Rejects Operator Certs of unknown Fingerprints', async () => {
    //   const cert = Buffer.concat([
    //     Buffer.from(FINGERPRINT_A, 'hex'),
    //     Buffer.from(ALICE_ADDRESS.substring(2), 'hex')
    //   ])
    //   const result = await handle({
    //     From: EXAMPLE_SIGNING_PUBLIC_KEY.toString('base64'),
    //     Tags: [
    //       { name: 'Action', value: 'Submit-Operator-Certificate' },
    //       { name: 'Operator-Certificate', value: cert.toString('base64') }
    //     ]
    //   })

    //   expect(result.Error)
    //     .to.be.a('string')
    //     .that.includes('Invalid certificate')
    // })
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
        // await addRegistrationCredit(handle, ALICE_ADDRESS, fingerprint)

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
})
