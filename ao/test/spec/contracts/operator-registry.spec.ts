import { expect } from 'chai'

import {
  ALICE_ADDRESS,
  AOTestHandle,
  BOB_ADDRESS,
  CHARLS_ADDRESS,
  createLoader,
  EXAMPLE_FINGERPRINT,
  FINGERPRINT_A,
  FINGERPRINT_B,
  FINGERPRINT_C,
  FINGERPRINT_D,
  FINGERPRINT_E,
  FINGERPRINT_F,
  OWNER_ADDRESS
} from '~/test/util/setup'

async function setupAdminAddOperatorCertificates(
  handle: AOTestHandle,
  address: string,
  fingerprint: string,  
  debug = false
) {
  const setupAdminAddOperatorCertificatesResult = await handle({
    From: OWNER_ADDRESS,
    Tags: [
      { name: 'Action', value: 'Admin-Submit-Operator-Certificates' }
    ],
    Data: JSON.stringify([{ fingerprint, address }])
  })

  if (debug) {
    console.log(
      'setupAdminAddOperatorCertificatesResult',
      setupAdminAddOperatorCertificatesResult
    )
  }
}

async function setupFingerprintCertificates(
  handle: AOTestHandle,
  debug = false
) {
  await setupAdminAddOperatorCertificates(
    handle,
    ALICE_ADDRESS,
    EXAMPLE_FINGERPRINT.toString('hex').toUpperCase()
  )

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

describe('Operator Registry', () => {
  let handle: AOTestHandle

  beforeEach(async () => {
    handle = (await createLoader('operator-registry')).handle
  })

  describe('Admin Submit Operator Certificates', () => {
    it('Accepts Operator Certificates from Admin', async () => {
      const certs = [
        { fingerprint: FINGERPRINT_A, address: ALICE_ADDRESS },
        { fingerprint: FINGERPRINT_B, address: BOB_ADDRESS },
        { fingerprint: FINGERPRINT_C, address: CHARLS_ADDRESS },
        { fingerprint: FINGERPRINT_D, address: ALICE_ADDRESS },
        { fingerprint: FINGERPRINT_E, address: BOB_ADDRESS },
        { fingerprint: FINGERPRINT_F, address: CHARLS_ADDRESS }
      ]

      const result = await handle({
        From: OWNER_ADDRESS,
        Tags: [{ name: 'Action', value: 'Admin-Submit-Operator-Certificates' }],
        Data: JSON.stringify(certs)
      })

      expect(result.Messages).to.have.lengthOf(1)
      expect(result.Messages[0].Data).to.equal('OK')
    })

    it('Lists Operator Certificates submitted by Admin', async () => {
      const certs = [
        { fingerprint: FINGERPRINT_A, address: ALICE_ADDRESS },
        { fingerprint: FINGERPRINT_B, address: BOB_ADDRESS },
        { fingerprint: FINGERPRINT_C, address: CHARLS_ADDRESS },
        { fingerprint: FINGERPRINT_D, address: ALICE_ADDRESS },
        { fingerprint: FINGERPRINT_E, address: BOB_ADDRESS },
        { fingerprint: FINGERPRINT_F, address: CHARLS_ADDRESS }
      ]

      await handle({
        From: OWNER_ADDRESS,
        Tags: [{ name: 'Action', value: 'Admin-Submit-Operator-Certificates' }],
        Data: JSON.stringify(certs)
      })

      const listResult = await handle({
        From: ALICE_ADDRESS,
        Tags: [{ name: 'Action', value: 'List-Operator-Certificates' }]
      })

      expect(listResult.Messages).to.have.lengthOf(1)
      expect(JSON.parse(listResult.Messages[0].Data)).to.deep.equal({
        [FINGERPRINT_A]: '0x' + ALICE_ADDRESS.substring(2).toUpperCase(),
        [FINGERPRINT_B]: '0x' + BOB_ADDRESS.substring(2).toUpperCase(),
        [FINGERPRINT_C]: '0x' + CHARLS_ADDRESS.substring(2).toUpperCase(),
        [FINGERPRINT_D]: '0x' + ALICE_ADDRESS.substring(2).toUpperCase(),
        [FINGERPRINT_E]: '0x' + BOB_ADDRESS.substring(2).toUpperCase(),
        [FINGERPRINT_F]: '0x' + CHARLS_ADDRESS.substring(2).toUpperCase()
      })
    })

    it('Validates Operator Certificates from Admin', async () => {
      const missingCertsResult = await handle({
        From: OWNER_ADDRESS,
        Tags: [{ name: 'Action', value: 'Admin-Submit-Operator-Certificates' }]
      })

      expect(missingCertsResult.Error)
        .to.be.a('string')
        .that.includes('Operator Certificates required')

      const invalidFingerprintCerts = await handle({
        From: OWNER_ADDRESS,
        Tags: [{ name: 'Action', value: 'Admin-Submit-Operator-Certificates' }],
        Data: JSON.stringify([
          { fingerprint: FINGERPRINT_A, address: ALICE_ADDRESS },
          { fingerprint: 'invalid-fingerprint' }
        ])
      })

      expect(invalidFingerprintCerts.Error)
        .to.be.a('string')
        .that.includes('Invalid Fingerprint')

      const invalidAddressCerts = await handle({
        From: OWNER_ADDRESS,
        Tags: [{ name: 'Action', value: 'Admin-Submit-Operator-Certificates' }],
        Data: JSON.stringify([
          { fingerprint: FINGERPRINT_A, address: ALICE_ADDRESS },
          { fingerprint: FINGERPRINT_B, address: 'invalid-address' }
        ])
      })

      expect(invalidAddressCerts.Error)
        .to.be.a('string')
        .that.includes('Invalid Address')
    })

    it('Rejects Operator Certificates from non-Admin', async () => {
      const result = await handle({
        From: ALICE_ADDRESS,
        Tags: [{ name: 'Action', value: 'Admin-Submit-Operator-Certificates' }],
        Data: 'mock-certs-data'
      })

      expect(result.Error)
        .to.be.a('string')
        .that.includes('This method is only available to the Owner')
    })
  })

  describe('Fingerprint Certificates', () => {
    it('Accepts Fingerprint Certs', async () => {
      const fingerprint = EXAMPLE_FINGERPRINT.toString('hex').toUpperCase()

      await setupAdminAddOperatorCertificates(
        handle,
        ALICE_ADDRESS,
        fingerprint
      )
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
      await addRegistrationCredit(
        handle,
        ALICE_ADDRESS,
        EXAMPLE_FINGERPRINT.toString('hex').toUpperCase()
      )
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

          await setupAdminAddOperatorCertificates(
            handle,
            ALICE_ADDRESS,
            fingerprint
          )
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
        await setupAdminAddOperatorCertificates(
          handle,
          ALICE_ADDRESS,
          EXAMPLE_FINGERPRINT.toString('hex').toUpperCase()
        )

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
        await setupAdminAddOperatorCertificates(
          handle,
          ALICE_ADDRESS,
          fingerprint
        )
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
        await setupAdminAddOperatorCertificates(
          handle,
          ALICE_ADDRESS,
          fingerprint
        )

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
            { name: 'Action', value: 'Add-Verified-Hardware' }
          ],
          Data: fingerprints.join(',')
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
          .that.includes('Fingerprints required')
      })

      it('Rejects adding VH when invalid fingerprints', async () => {
        const result = await handle({
          From: OWNER_ADDRESS,
          Tags: [{ name: 'Action', value: 'Add-Verified-Hardware' }],
          Data: `${FINGERPRINT_A},invalid-fingerprint`
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
          Tags: [{ name: 'Action', value: 'Add-Verified-Hardware' }],
          Data: fingerprints.join(',')
        })

        const result = await handle({
          From: OWNER_ADDRESS,
          Tags: [{ name: 'Action', value: 'Add-Verified-Hardware' }],
          Data: `${FINGERPRINT_D},${FINGERPRINT_C}`
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
        await setupAdminAddOperatorCertificates(
          handle,
          ALICE_ADDRESS,
          fingerprint
        )

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
          Tags: [{ name: 'Action', value: 'Add-Verified-Hardware' }],
          Data: fingerprint
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
      it('Lists VH Fingerprints', async () => {
        const fingerprints = [
          FINGERPRINT_A,
          FINGERPRINT_B,
          FINGERPRINT_C,
          FINGERPRINT_D
        ]
        await handle({
          From: OWNER_ADDRESS,
          Tags: [{ name: 'Action', value: 'Add-Verified-Hardware' }],
          Data: fingerprints.join(',')
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
          Tags: [{ name: 'Action', value: 'Add-Verified-Hardware' }],
          Data: fingerprints.join(',')
        })

        const result = await handle({
          From: OWNER_ADDRESS,
          Tags: [{ name: 'Action', value: 'Remove-Verified-Hardware' }],
          Data: `${FINGERPRINT_B},${FINGERPRINT_C}`
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
          .that.includes('Fingerprints required')
      })

      it('Rejects removing VH when not added', async () => {
        const result = await handle({
          From: OWNER_ADDRESS,
          Tags: [{ name: 'Action', value: 'Remove-Verified-Hardware' }],
          Data: `${FINGERPRINT_B},${FINGERPRINT_C}`
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
        await setupAdminAddOperatorCertificates(
          handle,
          ALICE_ADDRESS,
          fingerprint
        )
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

  describe('Info Messages', () => {
    it('Provides reply to Info messages', async () => {
      const verifiedRelays = [
        { address: ALICE_ADDRESS, fingerprint: FINGERPRINT_A },
        { address: BOB_ADDRESS, fingerprint: FINGERPRINT_B },
        { address: CHARLS_ADDRESS, fingerprint: FINGERPRINT_C }
      ]
      for (const { address, fingerprint } of verifiedRelays) {
        await setupAdminAddOperatorCertificates(handle, address, fingerprint)
        await addRegistrationCredit(handle, address, fingerprint)
        await handle({
          From: address,
          Tags: [
            { name: 'Action', value: 'Submit-Fingerprint-Certificate' },
            {
              name: 'Fingerprint-Certificate',
              value: fingerprint
            }
          ]
        })
      }
      const unclaimedRelays = [
        { address: ALICE_ADDRESS, fingerprint: FINGERPRINT_D },
        { address: BOB_ADDRESS, fingerprint: FINGERPRINT_E },
        { address: CHARLS_ADDRESS, fingerprint: FINGERPRINT_F },
      ]
      for (const { address, fingerprint } of unclaimedRelays) {
        await setupAdminAddOperatorCertificates(handle, address, fingerprint)
      }

      await handle({
        From: OWNER_ADDRESS,
        Tags: [
          { name: 'Action', value: 'Add-Verified-Hardware' }
        ],
        Data: `${FINGERPRINT_B},${FINGERPRINT_E}`
      })

      const result = await handle({
        From: ALICE_ADDRESS,
        Tags: [{ name: 'Action', value: 'Info' }]
      })

      expect(result.Messages).to.have.lengthOf(1)
      expect(JSON.parse(result.Messages[0].Data))
        .to.deep.equal({ claimed: 3, hardware: 2, total: 6 })
    })
  })

  describe('View State', () => {
    it('Provides reply to View-State messages', async () => {
      const verifiedRelays = [
        { address: ALICE_ADDRESS, fingerprint: FINGERPRINT_A },
        { address: BOB_ADDRESS, fingerprint: FINGERPRINT_B },
        { address: CHARLS_ADDRESS, fingerprint: FINGERPRINT_C }
      ]
      for (const { address, fingerprint } of verifiedRelays) {
        await setupAdminAddOperatorCertificates(handle, address, fingerprint)
        await addRegistrationCredit(handle, address, fingerprint)
        await handle({
          From: address,
          Tags: [
            { name: 'Action', value: 'Submit-Fingerprint-Certificate' },
            {
              name: 'Fingerprint-Certificate',
              value: fingerprint
            }
          ]
        })
      }
      const unclaimedRelays = [
        { address: ALICE_ADDRESS, fingerprint: FINGERPRINT_D },
        { address: BOB_ADDRESS, fingerprint: FINGERPRINT_E },
        { address: CHARLS_ADDRESS, fingerprint: FINGERPRINT_F },
      ]
      for (const { address, fingerprint } of unclaimedRelays) {
        await setupAdminAddOperatorCertificates(handle, address, fingerprint)
      }

      await handle({
        From: OWNER_ADDRESS,
        Tags: [
          { name: 'Action', value: 'Add-Verified-Hardware' }
        ],
        Data: `${FINGERPRINT_B},${FINGERPRINT_E}`
      })

      const result = await handle({
        From: ALICE_ADDRESS,
        Tags: [{ name: 'Action', value: 'View-State' }]
      })

      const parsed = JSON.parse(result.Messages[0].Data)
      expect(result.Messages).to.have.lengthOf(1)
      expect(parsed).to.deep.equal({
        ClaimableFingerprintsToOperatorAddresses: {
          [FINGERPRINT_D]: ALICE_ADDRESS,
          [FINGERPRINT_E]: BOB_ADDRESS,
          [FINGERPRINT_F]: CHARLS_ADDRESS
        },
        VerifiedFingerprintsToOperatorAddresses: {
          [FINGERPRINT_A]: ALICE_ADDRESS,
          [FINGERPRINT_B]: BOB_ADDRESS,
          [FINGERPRINT_C]: CHARLS_ADDRESS
        },
        BlockedOperatorAddresses: [],
        RegistrationCreditsFingerprintsToOperatorAddresses: [],
        VerifiedHardwareFingerprints: {
          [FINGERPRINT_B]: true,
          [FINGERPRINT_E]: true
        }
      })
    })
  })
})
