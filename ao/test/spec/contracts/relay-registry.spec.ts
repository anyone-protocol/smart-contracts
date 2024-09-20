import { expect } from 'chai'

import {
  AOTestHandle,
  createLoader
} from '~/test/util/setup'

describe('Relay Registry', () => {
  let handle: AOTestHandle

  beforeEach(async () => {
    handle = (await createLoader()).handle
  })

  describe('Signing Certificates', () => {
    it.skip('Allows anyone to submit a Signing Certificate', async () => {})
  })

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
