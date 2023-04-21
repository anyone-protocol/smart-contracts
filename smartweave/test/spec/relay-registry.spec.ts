import 'mocha'
import { expect } from 'chai'
import { ContractError, ContractInteraction } from 'warp-contracts'

import {
  INVALID_INPUT,
  Register,
  RelayRegistryHandle,
  RelayRegistryState,
  Verify
} from '../../src/contracts'

const OWNER = '0x1111111111111111111111111111111111111111'
const ALICE = '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
const fingerprintA = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
let initState: RelayRegistryState
function resetState() {
  initState = {
    owner: OWNER,
    claims: {},
    verified: {}
  }
}

describe('Relay Registry Contract', () => {
  beforeEach(resetState)

  it('Initializes state with owner as deployer', () => {
    expect(initState.owner).to.equal(OWNER)
  })

  it('Should throw on invalid input', () => {
    expect(() => {
      RelayRegistryHandle(initState, { caller: ALICE, input: {} } as any)
    }).to.throw(ContractError, INVALID_INPUT)
  })

  it('Allows valid relay registration claims', () => {
    const interaction: ContractInteraction<any> = {
      caller: ALICE,
      input: { function: 'register', fingerprint: fingerprintA },
      interactionType: 'write'
    }

    const { state: { claims } } = RelayRegistryHandle(initState, interaction)

    expect(claims).to.deep.equal({ [ALICE]: [ fingerprintA ] })
  })

  it('Validates fingerprints for relay registration claims', () => {
    const tooShort = 'AAAAAAAAAAAAAAAAAAAA'
    const tooLong = tooShort + tooShort + tooShort
    const badChars = 'XYZAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
    const badInputs = [
      tooShort, tooLong, badChars, 3, null, undefined, {}, []
    ]
    const createRegisterInteraction = (
      fingerprint: any
    ): ContractInteraction<any> => {
      return {
        caller: ALICE,
        interactionType: 'write',
        input: { function: 'register', fingerprint }
      }
    }

    for (let i = 0; i < badInputs.length; i++) {
      const badInput = badInputs[i]
      expect(() => {
        RelayRegistryHandle(initState, createRegisterInteraction(badInput))
      }).to.throw(
        ContractError,
        undefined,
        `Expected to throw when fingerprint is ${badInput}`
      )
    }
  })

  it('Allows owner to verify claims', () => {
    const registerInteraction: ContractInteraction<Register> = {
      caller: ALICE,
      interactionType: 'write',
      input: {
        function: 'register',
        fingerprint: fingerprintA
      }
    }
    const verifyInteraction: ContractInteraction<Verify> = {
      caller: OWNER,
      interactionType: 'write',
      input: {
        function: 'verify',
        fingerprint: fingerprintA,
        address: ALICE
      }
    }

    const { state: { claims } } = RelayRegistryHandle(
      initState,
      registerInteraction
    )
    const { state: { verified }} = RelayRegistryHandle(
      initState,
      verifyInteraction
    )

    expect(claims).to.deep.equal({ [ALICE]: [] })
    expect(verified).to.deep.equal({ [fingerprintA]: ALICE })
  })

  it('Should require contract callers to be EVM Addresses') // TODO -> warp ethers plugin?

  it('Should not allow a user to claim the same fingerprint more than once')

  it('Disallows non-owners from verifying claims')

  it('Requires a valid claim for a verifcation from contract owner')

  it('Is evolvable only by the contract owner')
})
