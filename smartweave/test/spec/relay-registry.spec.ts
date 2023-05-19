import 'mocha'
import { expect } from 'chai'
import { ContractError, ContractInteraction } from 'warp-contracts'

import {
  ADDRESS_REQUIRED,
  FINGERPRINT_ALREADY_CLAIMABLE,
  FINGERPRINT_NOT_CLAIMABLE,
  FINGERPRINT_REQUIRED,
  INVALID_ADDRESS,
  INVALID_FINGERPRINT,
  INVALID_INPUT,
  RelayRegistryHandle,
  RelayRegistryState,
} from '../../src/contracts'
import { ERROR_ONLY_OWNER } from '../../src/util'

const OWNER  = '0x1111111111111111111111111111111111111111'
const ALICE  = '0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa'
const BOB    = '0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB'
const CHARLS = '0xCcCCccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC'
const fingerprintA = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
const fingerprintB = 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB'
const fingerprintC = 'CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC'
let initState: RelayRegistryState
function resetState() {
  initState = {
    owner: OWNER,
    claimable: {}
  }
}

function createInteraction(
  caller: string,
  input: any,
  interactionType: 'write' | 'view' = 'write'
): ContractInteraction<any> {
  return { caller, interactionType, input }
}

describe('Relay Registry Contract', () => {
  beforeEach(resetState)

  it('Initializes state with owner as deployer', () => {
    expect(initState.owner).to.equal(OWNER)
  })

  it('Throws on invalid input', () => {
    expect(
      () => RelayRegistryHandle(initState, { caller: ALICE, input: {} } as any)
    ).to.throw(ContractError, INVALID_INPUT)
  })

  it('Allows Owner to add claimable relays', () => {
    const addClaimableInteraction = createInteraction(OWNER, {
      function: 'addClaimable',
      fingerprint: fingerprintA,
      address: ALICE
    })

    const { state } = RelayRegistryHandle(initState, addClaimableInteraction)

    expect(state.claimable).to.deep.equal({ [fingerprintA]: ALICE })
  })

  it('Prevents non-owners from adding claimable relays', () => {
    const interaction = createInteraction(ALICE, {
      function: 'addClaimable',
      fingerprint: fingerprintA,
      address: ALICE
    })
    
    expect(
      () => RelayRegistryHandle(initState, interaction)
    ).to.throw(ContractError, ERROR_ONLY_OWNER)
  })

  it('Requires & validates fingerprints when adding claimable relays', () => {
    const missingFingerprintInteraction = createInteraction(OWNER, {
      function: 'addClaimable',
      address: ALICE
    })

    expect(
      () => RelayRegistryHandle(initState, missingFingerprintInteraction)
    ).to.throw(ContractError, FINGERPRINT_REQUIRED)

    const invalidFingerprintInteraction = createInteraction(OWNER, {
      function: 'addClaimable',
      fingerprint: 'invalid-fingerprint',
      address: ALICE
    })

    expect(
      () => RelayRegistryHandle(initState, invalidFingerprintInteraction)
    ).to.throw(ContractError, INVALID_FINGERPRINT)
  })

  it('Requires & validates addresses when adding claimable relays', () => {
    const missingAddressInteraction = createInteraction(OWNER, {
      function: 'addClaimable',
      fingerprint: fingerprintA
    })

    expect(
      () => RelayRegistryHandle(initState, missingAddressInteraction)
    ).to.throw(ContractError, ADDRESS_REQUIRED)  
    
    const invalidAddressInteraction = createInteraction(OWNER, {
      function: 'addClaimable',
      fingerprint: fingerprintA,
      address: 'invalid-address'
    })

    expect(
      () => RelayRegistryHandle(initState, invalidAddressInteraction)
    ).to.throw(ContractError, INVALID_ADDRESS)
  })

  it('Throws when adding a claimable relay that is already claimable', () => {
    const addClaimableInteraction = createInteraction(OWNER, {
      function: 'addClaimable',
      fingerprint: fingerprintA,
      address: ALICE
    })

    RelayRegistryHandle(initState, addClaimableInteraction)

    expect(
      () => RelayRegistryHandle(initState, addClaimableInteraction)
    ).to.throw(ContractError, FINGERPRINT_ALREADY_CLAIMABLE)
  })

  it('Throws when adding a claimable relay that is already verified')
  
  it('Allows Owner to remove claimable relays', () => {
    const addClaimableInteractionA = createInteraction(OWNER, {
      function: 'addClaimable',
      fingerprint: fingerprintA,
      address: ALICE
    })
    const addClaimableInteractionB = createInteraction(OWNER, {
      function: 'addClaimable',
      fingerprint: fingerprintB,
      address: BOB
    })
    const removeClaimableInteraction = createInteraction(OWNER, {
      function: 'removeClaimable',
      fingerprint: fingerprintA
    })

    RelayRegistryHandle(initState, addClaimableInteractionA)
    RelayRegistryHandle(initState, addClaimableInteractionB)
    const { state } = RelayRegistryHandle(initState, removeClaimableInteraction)

    expect(state.claimable).to.deep.equal({ [fingerprintB]: BOB })
  })

  it('Requires & validates fingerprints when removing claimable relays', () => {
    const missingFingerprintInteraction = createInteraction(OWNER, {
      function: 'removeClaimable'
    })

    expect(
      () => RelayRegistryHandle(initState, missingFingerprintInteraction)
    ).to.throw(ContractError, FINGERPRINT_REQUIRED)

    const invalidFingerprintInteraction = createInteraction(OWNER, {
      function: 'removeClaimable',
      fingerprint: 'invalid-fingerprint'
    })

    expect(
      () => RelayRegistryHandle(initState, invalidFingerprintInteraction)
    ).to.throw(ContractError, INVALID_FINGERPRINT)
  })

  it('Throws when removing a claimable relay that is not claimed', () => {
    const removeClaimableInteraction = createInteraction(OWNER, {
      function: 'removeClaimable',
      fingerprint: fingerprintA
    })

    expect(
      () => RelayRegistryHandle(initState, removeClaimableInteraction)
    ).to.throw(ContractError, FINGERPRINT_NOT_CLAIMABLE)
  })

  it('Throws when removing a claimable relay that is verified')

  it('Provides a view method of claimable relays', () => {
    const addClaimableInteractionA = createInteraction(OWNER, {
      function: 'addClaimable',
      address: ALICE,
      fingerprint: fingerprintA
    })
    const addClaimableInteractionB = createInteraction(OWNER, {
      function: 'addClaimable',
      address: BOB,
      fingerprint: fingerprintB
    })
    const addClaimableInteractionC = createInteraction(OWNER, {
      function: 'addClaimable',
      address: CHARLS,
      fingerprint: fingerprintC
    })

    RelayRegistryHandle(initState, addClaimableInteractionA)
    RelayRegistryHandle(initState, addClaimableInteractionB)
    RelayRegistryHandle(initState, addClaimableInteractionC)

    const viewAllClaimable = createInteraction(OWNER, {
      function: 'claimable'
    }, 'view')
    
    const { result } = RelayRegistryHandle(initState, viewAllClaimable)

    expect(result).to.deep.equal({
      [fingerprintA]: ALICE,
      [fingerprintB]: BOB,
      [fingerprintC]: CHARLS
    })
  })

  it('Provides a view method of claimable relays by address', () => {
    const addClaimableInteractionA = createInteraction(OWNER, {
      function: 'addClaimable',
      address: ALICE,
      fingerprint: fingerprintA
    })
    const addClaimableInteractionB = createInteraction(OWNER, {
      function: 'addClaimable',
      address: BOB,
      fingerprint: fingerprintB
    })
    const addClaimableInteractionC = createInteraction(OWNER, {
      function: 'addClaimable',
      address: ALICE,
      fingerprint: fingerprintC
    })

    RelayRegistryHandle(initState, addClaimableInteractionA)
    RelayRegistryHandle(initState, addClaimableInteractionB)
    RelayRegistryHandle(initState, addClaimableInteractionC)

    const viewAliceClaimable = createInteraction(OWNER, {
      function: 'claimable',
      address: ALICE
    }, 'view')
    const viewBobClaimable = createInteraction(OWNER, {
      function: 'claimable',
      address: BOB
    }, 'view')

    const { result: aliceResult } = RelayRegistryHandle(
      initState,
      viewAliceClaimable
    )
    const { result: bobResult } = RelayRegistryHandle(
      initState,
      viewBobClaimable
    )

    expect(aliceResult).to.deep.equal([ fingerprintA, fingerprintC ])
    expect(bobResult).to.deep.equal([ fingerprintB ])
  })

  it('Validates address when viewing claimable relays by address')

  it('Provides a view method to check if a relay is claimable', () => {
    const addClaimableInteraction = createInteraction(OWNER, {
      function: 'addClaimable',
      address: ALICE,
      fingerprint: fingerprintA
    })

    RelayRegistryHandle(initState, addClaimableInteraction)

    const isAliceFingerprintAClaimableInteraction = createInteraction(ALICE, {
      function: 'isClaimable',
      address: ALICE,
      fingerprint: fingerprintA
    }, 'view')
    const isBobFingerprintAClaimableInteraction = createInteraction(ALICE, {
      function: 'isClaimable',
      address: BOB,
      fingerprint: fingerprintA
    })
    const isAliceFingerprintBClaimableInteraction = createInteraction(ALICE, {
      function: 'isClaimable',
      address: ALICE,
      fingerprint: fingerprintB
    })

    const { result: isAliceFingerprintAClaimable } = RelayRegistryHandle(
      initState,
      isAliceFingerprintAClaimableInteraction
    )
    const { result: isBobFingerprintAClaimable } = RelayRegistryHandle(
      initState,
      isBobFingerprintAClaimableInteraction
    )
    const { result: isAliceFingerprintBClaimable } = RelayRegistryHandle(
      initState,
      isAliceFingerprintBClaimableInteraction
    )

    expect(
      isAliceFingerprintAClaimable,
      'Alice with fingerprint A should be claimable'
    ).to.be.true
    expect(
      isBobFingerprintAClaimable,
      'Bob with fingerprint A should not be claimable'
    ).to.be.false
    expect(
      isAliceFingerprintBClaimable,
      'Alice with fingerprint B should not be claimable'
    ).to.be.false
  })

  it('Requires & validates fingerprints when checking if relay is claimable')

  it('Requires & validates address when checking if relay is claimable')

  it('Allows claiming of claimable relays')

  it('Requires address to match caller when claiming a relay')

  it('Requires & validates fingerprint when claiming a relay')

  it('Throws if a relay being claimed is not claimable')

  it('Allows renouncing of verified/claimed relays')

  it('Requires & validates fingerprint when renouncing a relay')

  it('Requires address to match caller when renouncing a relay')

  it('Throws if a relay is not verified/claimed when renouncing')

  it('Allows Owner to remove verified relays')

  it('Prevents non-owners from removing verified relays')

  it('Requires & validates fingerprint when removing verified relays')

  it('Provides a view method of verified relays')

  it('Provides a view method of verified relays by address')

  it('Validates address when viewing verified relays by address')

  it('Provides a view method to check if a relay is verified')

  it('Requires & validates fingerprint when checking if a relay is verified')
})
