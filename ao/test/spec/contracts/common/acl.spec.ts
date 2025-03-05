import { expect } from 'chai'

import {
  ALICE_ADDRESS,
  AOTestHandle,
  BOB_ADDRESS,
  CHARLS_ADDRESS,
  createLoader,
  OWNER_ADDRESS
} from '~/test/util/setup'

const contractsWithACL = [
  'acl-test',

  // NB: This basically tests that these contracts have the ACL module and
  //     that it is wired-up through handlers
  'operator-registry',
  'relay-rewards',
  'staking-rewards'
]

for (const contractName of contractsWithACL) {
  describe(`ACL - ${contractName}`, () => {
    let handle: AOTestHandle
   
    beforeEach(async () => {
      handle = (await createLoader(contractName)).handle
    })
  
    describe('Granting/Revoking Roles', () => {
      it('Allows Owner to grant/revoke roles', async () => {
        const initialGrantResult = await handle({
          From: OWNER_ADDRESS,
          Tags: [{ name: 'Action', value: 'Update-Roles' }],
          Data: JSON.stringify({
            Grant: { [ALICE_ADDRESS]: [ 'new-mock-role', 'another-mock-role' ] }
          })
        })
        expect(initialGrantResult.Messages).to.have.lengthOf(1)
        expect(initialGrantResult.Messages[0].Data).to.equal('OK')
  
        const subsequentUpdateResult = await handle({
          From: OWNER_ADDRESS,
          Tags: [{ name: 'Action', value: 'Update-Roles' }],
          Data: JSON.stringify({
            Grant: { [BOB_ADDRESS]: [ 'another-mock-role' ] },
            Revoke: { [ALICE_ADDRESS]: [ 'another-mock-role' ] }
          })
        })
        expect(subsequentUpdateResult.Messages).to.have.lengthOf(1)
        expect(subsequentUpdateResult.Messages[0].Data).to.equal('OK')
      })
  
      it('Prevents anyone else from granting/revoking roles', async () => {
        const result = await handle({
          From: ALICE_ADDRESS,
          Tags: [{ name: 'Action', value: 'Update-Roles' }],
          Data: JSON.stringify({
            Grant: { [ALICE_ADDRESS]: [ 'new-mock-role', 'another-mock-role' ] },
            Revoke: { [BOB_ADDRESS]: ['new-mock-role']}
          })
        })
  
        expect(result.Error)
          .to.be.a('string')
          .that.includes('Permission Denied')
      })
  
      it('Allows Admin to grant/revoke roles', async () => {
        await handle({
          From: OWNER_ADDRESS,
          Tags: [{ name: 'Action', value: 'Update-Roles' }],
          Data: JSON.stringify({ Grant: { [ALICE_ADDRESS]: [ 'admin' ] } })
        })
  
        const result = await handle({
          From: ALICE_ADDRESS,
          Tags: [{ name: 'Action', value: 'Update-Roles' }],
          Data: JSON.stringify({
            Grant: { [ALICE_ADDRESS]: [ 'new-mock-role', 'another-mock-role' ] },
            Revoke: {}
          })
        })
  
        expect(result.Messages).to.have.lengthOf(1)
        expect(result.Messages[0].Data).to.equal('OK')
      })
  
      it('Allows address with Update-Roles role to grant/revoke roles', async () => {
        await handle({
          From: OWNER_ADDRESS,
          Tags: [{ name: 'Action', value: 'Update-Roles' }],
          Data: JSON.stringify({ Grant: { [ALICE_ADDRESS]: [ 'Update-Roles' ] } })
        })
  
        const result = await handle({
          From: ALICE_ADDRESS,
          Tags: [{ name: 'Action', value: 'Update-Roles' }],
          Data: JSON.stringify({
            Grant: { [ALICE_ADDRESS]: [ 'new-mock-role', 'another-mock-role' ] },
            Revoke: {}
          })
        })
  
        expect(result.Messages).to.have.lengthOf(1)
        expect(result.Messages[0].Data).to.equal('OK')
      })
    })
  
    describe('Viewing Roles', () => {
      it('Allows anyone to view roles', async () => {
        await handle({
          From: OWNER_ADDRESS,
          Tags: [{ name: 'Action', value: 'Update-Roles' }],
          Data: JSON.stringify({
            Grant: {
              [ALICE_ADDRESS]: [ 'new-mock-role', 'another-mock-role' ],
              [BOB_ADDRESS]: [ 'another-mock-role' ],
              [CHARLS_ADDRESS]: [ 'admin' ]
            }
          })
        })
  
        const firstResult = await handle({
          From: ALICE_ADDRESS,
          Tags: [{ name: 'Action', value: 'View-Roles' }]
        })
  
        expect(firstResult.Messages).to.have.lengthOf(1)
        expect(JSON.parse(firstResult.Messages[0].Data)).to.deep.equal({
          Roles: {
            'new-mock-role': { [ALICE_ADDRESS]: true },
            'another-mock-role': { [ALICE_ADDRESS]: true, [BOB_ADDRESS]: true },
            'admin': { [CHARLS_ADDRESS]: true }
          }
        })
  
        const revokeResult = await handle({
          From: OWNER_ADDRESS,
          Tags: [{ name: 'Action', value: 'Update-Roles' }],
          Data: JSON.stringify({
            Grant: {
              [BOB_ADDRESS]: [ 'new-mock-role' ]
            },
            Revoke: {
              [ALICE_ADDRESS]: [ 'new-mock-role' ]
            }
          })
        })
  
        const secondResult = await handle({
          From: ALICE_ADDRESS,
          Tags: [{ name: 'Action', value: 'View-Roles' }]
        })
  
        expect(secondResult.Messages).to.have.lengthOf(1)
        expect(JSON.parse(secondResult.Messages[0].Data)).to.deep.equal({
          Roles: {
            'new-mock-role': { [BOB_ADDRESS]: true },
            'another-mock-role': { [ALICE_ADDRESS]: true, [BOB_ADDRESS]: true },
            'admin': { [CHARLS_ADDRESS]: true }
          }
        })
      })
    })
  })
}
