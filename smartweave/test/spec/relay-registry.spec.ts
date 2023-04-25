import 'mocha'
import { expect } from 'chai'
import { ContractError, ContractInteraction } from 'warp-contracts'

import {
  DUPLICATE_FINGERPRINT,
  FINGERPRINT_ALREADY_VERIFIED,
  INVALID_INPUT,
  Register,
  RelayRegistryHandle,
  RelayRegistryState,
  Verify
} from '../../src/contracts'

const OWNER = '0x1111111111111111111111111111111111111111'
const ALICE = '0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa'
const BOB   = '0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB'
const fingerprintA = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
const fingerprintB = 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB'
let initState: RelayRegistryState
function resetState() {
  initState = {
    owner: OWNER,
    claims: {},
    verified: {}
  }
}

function createRegisterInteraction(
  caller: string,
  fingerprint: any
): ContractInteraction<any> {
  return {
    caller,
    interactionType: 'write',
    input: { function: 'register', fingerprint }
  }
}

function createUnregisterInteraction(
  caller: string,
  fingerprint: any
): ContractInteraction<any> {
  return {
    caller,
    interactionType: 'write',
    input: { function: 'unregister', fingerprint }
  }
}

function createVerifyInteraction(
  caller: string,
  address: string,
  fingerprint: string
): ContractInteraction<any> {
  return {
    caller,
    interactionType: 'write',
    input: { function: 'verify', address, fingerprint }
  }
}

function createRemoveStaleInteraction(
  caller: string,
  fingerprint: string
): ContractInteraction<any> {
  return {
    caller,
    interactionType: 'write',
    input: { function: 'remove-stale', fingerprint }
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

    for (let i = 0; i < badInputs.length; i++) {
      const badInput = badInputs[i]
      expect(() => {
        RelayRegistryHandle(
          initState,
          createRegisterInteraction(ALICE, badInput)
        )
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

  it('Disallows a user to claim duplicate fingerprints', () => {
    const registerInteractionA = createRegisterInteraction(ALICE, fingerprintA)
    const registerInteractionB = createRegisterInteraction(ALICE, fingerprintB)

    RelayRegistryHandle(
      initState,
      registerInteractionA
    )
    const { state: { claims } } = RelayRegistryHandle(
      initState,
      registerInteractionB
    )
    expect(
      () => RelayRegistryHandle(initState, registerInteractionA)
    ).to.throw(ContractError, DUPLICATE_FINGERPRINT)
    expect(claims).to.deep.equal({ [ALICE]: [ fingerprintA, fingerprintB ] })
  })

  it('Disallows any user to claim a verified fingerprint', () => {
    const aliceRegisterInteraction = createRegisterInteraction(
      ALICE,
      fingerprintA
    )
    const ownerVerifyInteraction = createVerifyInteraction(
      OWNER,
      ALICE,
      fingerprintA
    )
    const bobRegisterInteraction = createRegisterInteraction(
      BOB,
      fingerprintA
    )

    RelayRegistryHandle(initState, aliceRegisterInteraction)
    RelayRegistryHandle(initState, ownerVerifyInteraction)

    expect(
      () => RelayRegistryHandle(initState, bobRegisterInteraction)
    ).to.throw(ContractError, FINGERPRINT_ALREADY_VERIFIED)
    expect(
      () => RelayRegistryHandle(initState, aliceRegisterInteraction)
    ).to.throw(ContractError, FINGERPRINT_ALREADY_VERIFIED)
  })

  it('Disallows non-owners from verifying claims', () => {
    const aliceRegisterInteraction = createRegisterInteraction(
      ALICE,
      fingerprintA
    )
    const bobRegisterInteraction = createRegisterInteraction(
      BOB,
      fingerprintB
    )
    const aliceVerifyAliceInteraction = createVerifyInteraction(
      ALICE,
      ALICE,
      fingerprintA
    )
    const aliceVerifyBobInteraction = createVerifyInteraction(
      ALICE,
      BOB,
      fingerprintB
    )

    RelayRegistryHandle(initState, aliceRegisterInteraction)
    RelayRegistryHandle(initState, bobRegisterInteraction)

    expect(
      () => RelayRegistryHandle(initState, aliceVerifyAliceInteraction)
    ).to.throw(ContractError)
    expect(
      () => RelayRegistryHandle(initState, aliceVerifyBobInteraction)
    ).to.throw(ContractError)
  })

  it('Requires a valid claim for a verifcation from contract owner', () => {
    const ownerVerifyInteraction = createVerifyInteraction(
      OWNER,
      ALICE,
      fingerprintA
    )

    expect(
      () => RelayRegistryHandle(initState, ownerVerifyInteraction)
    ).to.throw(ContractError)
  })

  it('Requires EVM addresses to be in checksum format', () => {
    const aliceRegisterInteraction = createRegisterInteraction(
      ALICE,
      fingerprintA
    )
    const badEvmAddressInputs = [
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', // no leading 0x
      {},
      null,
      undefined,
      ['', []],
      '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', // not checksum format
    ]

    RelayRegistryHandle(initState, aliceRegisterInteraction)

    for (let i = 0; i < badEvmAddressInputs.length; i++) {
      const badEvmAddress = badEvmAddressInputs[i]
      expect(
        () => RelayRegistryHandle(
          initState,
          createVerifyInteraction(OWNER, badEvmAddress as any, fingerprintA)
        )
      ).to.throw(ContractError)
    }
  })

  it('Removes a fingerprint from all claims when it is verified', () => {
    const aliceRegisterInteraction = createRegisterInteraction(
      ALICE,
      fingerprintA
    )
    const bobRegisterInteraction = createRegisterInteraction(
      BOB,
      fingerprintA
    )
    const ownerVerifyInteraction = createVerifyInteraction(
      OWNER,
      ALICE,
      fingerprintA
    )

    RelayRegistryHandle(initState, aliceRegisterInteraction)
    RelayRegistryHandle(initState, bobRegisterInteraction)
    const { state: { claims, verified } } = RelayRegistryHandle(
      initState,
      ownerVerifyInteraction
    )

    expect(claims).to.deep.equal({ [ALICE]: [], [BOB]: [] })
    expect(verified).to.deep.equal({ [fingerprintA]: ALICE })
  })

  it('Is evolvable only by the contract owner', () => {
    const newContractSrc = '0xNEW-CONTRACT-SRC'
    const noContractSrcEvolve: ContractInteraction<any> = {
      caller: OWNER,
      input: { function: 'evolve' },
      interactionType: 'write'
    }
    const emptyContractSrcEvolve: ContractInteraction<any> = {
      caller: OWNER,
      input: { function: 'evolve', newContractSrc: '' },
      interactionType: 'write'
    }
    const aliceEvolve: ContractInteraction<any> = {
      caller: ALICE,
      input: { function: 'evolve', newContractSrc },
      interactionType: 'write'
    }
    const ownerEvolve: ContractInteraction<any> = {
      caller: OWNER,
      input: { function: 'evolve', newContractSrc },
      interactionType: 'write'
    }

    expect(
      () => RelayRegistryHandle(initState, noContractSrcEvolve)
    ).to.throw(ContractError)
    expect(
      () => RelayRegistryHandle(initState, emptyContractSrcEvolve)
    ).to.throw(ContractError)
    expect(
      () => RelayRegistryHandle(initState, aliceEvolve)
    ).to.throw(ContractError)
    const { state: { evolve } } = RelayRegistryHandle(initState, ownerEvolve)
    expect(evolve).to.equal(newContractSrc)
  })

  it('Should allow verified relay owners to unregister', () => {
    const aliceRegister = createRegisterInteraction(ALICE, fingerprintA)
    const ownerVerifyAlice = createVerifyInteraction(OWNER, ALICE, fingerprintA)
    const bobUnregister = createUnregisterInteraction(BOB, fingerprintA)
    const aliceUnregister = createUnregisterInteraction(ALICE, fingerprintA)

    RelayRegistryHandle(initState, aliceRegister)
    RelayRegistryHandle(initState, ownerVerifyAlice)
    expect(
      () => RelayRegistryHandle(initState, bobUnregister)
    ).to.throw(ContractError)
    const { state: { claims, verified } } = RelayRegistryHandle(
      initState,
      aliceUnregister
    )

    expect(claims).to.deep.equal({ [ALICE]: [] })
    expect(verified).to.deep.equal({})
  })

  it('Should allow the contract owner to remove stale verifications', () => {
    const aliceRegister = createRegisterInteraction(ALICE, fingerprintA)
    const ownerVerifyAlice = createVerifyInteraction(OWNER, ALICE, fingerprintA)
    const bobRemoveStale = createRemoveStaleInteraction(BOB, fingerprintA)
    const ownerRemoveStale = createRemoveStaleInteraction(OWNER, fingerprintA)

    RelayRegistryHandle(initState, aliceRegister)
    RelayRegistryHandle(initState, ownerVerifyAlice)
    expect(
      () => RelayRegistryHandle(initState, bobRemoveStale)
    ).to.throw(ContractError)
    const { state: { claims, verified } } = RelayRegistryHandle(
      initState,
      ownerRemoveStale
    )

    expect(claims).to.deep.equal({ [ALICE]: [] })
    expect(verified).to.deep.equal({})
  })
})
