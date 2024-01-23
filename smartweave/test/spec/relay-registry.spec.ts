import 'mocha'
import { expect } from 'chai'
import { ContractError, ContractInteraction } from 'warp-contracts'

import {
  ADDRESS_REQUIRED,
  FINGERPRINT_ALREADY_CLAIMABLE,
  FINGERPRINT_ALREADY_CLAIMED,
  FINGERPRINT_NOT_CLAIMABLE,
  FINGERPRINT_NOT_CLAIMABLE_BY_ADDRESS,
  FINGERPRINT_NOT_CLAIMED_BY_ADDRESS,
  FINGERPRINT_REQUIRED,
  INVALID_ADDRESS,
  INVALID_FINGERPRINT,
  RelayRegistryHandle,
  RelayRegistryState,
  ADDRESS_ALREADY_BLOCKED,
  ADDRESS_IS_BLOCKED,
  ADDRESS_NOT_BLOCKED,
  REGISTRATION_CREDIT_REQUIRED
} from '../../src/contracts'
import { ERROR_ONLY_OWNER, INVALID_INPUT } from '../../src/util'

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
    claimable: {},
    verified: {},
    registrationCredits: {},
    blockedAddresses: []
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

  describe('Claiming', () => {
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

    it('Throws when adding a claimable relay that is already verified', () => {
      const addClaimableInteraction = createInteraction(OWNER, {
        function: 'addClaimable',
        fingerprint: fingerprintA,
        address: ALICE
      })

      expect(
        () => RelayRegistryHandle(
          { ...initState, verified: { [fingerprintA]: ALICE } },
          addClaimableInteraction
        )
      ).to.throw(ContractError, FINGERPRINT_ALREADY_CLAIMED)
    })
    
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

    it('Throws when removing a claimable relay that is verified', () => {
      const removeClaimableInteraction = createInteraction(OWNER, {
        function: 'removeClaimable',
        fingerprint: fingerprintA
      })

      expect(
        () => RelayRegistryHandle(
          { ...initState, verified: { [fingerprintA]: ALICE } },
          removeClaimableInteraction
        )
      ).to.throw(ContractError, FINGERPRINT_ALREADY_CLAIMED)
    })

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

    it('Validates address when viewing claimable relays by address', () => {
      const invalidAddressInteraction = createInteraction(ALICE, {
        function: 'claimable',
        address: 'invalid-address'
      })

      expect(
        () => RelayRegistryHandle(initState, invalidAddressInteraction)
      ).to.throw(ContractError, INVALID_ADDRESS)
    })

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

    it('Requires & validates fingerprints when checking if relay is claimable', () => {
      const missingFinterprintInteraction = createInteraction(ALICE, {
        function: 'isClaimable',
        address: ALICE
      }, 'view')
      const invalidFingerprintInteraction = createInteraction(ALICE, {
        function: 'isClaimable',
        address: ALICE,
        fingerprint: 'invalid-fingerprint'
      }, 'view')

      expect(
        () => RelayRegistryHandle(initState, missingFinterprintInteraction)
      ).to.throw(ContractError, FINGERPRINT_REQUIRED)
      expect(
        () => RelayRegistryHandle(initState, invalidFingerprintInteraction)
      ).to.throw(ContractError, INVALID_FINGERPRINT)
    })

    it('Requires & validates address when checking if relay is claimable', () => {
      const missingAddressInteraction = createInteraction(ALICE, {
        function: 'isClaimable',
        fingerprint: fingerprintA
      }, 'view')
      const invalidAddressInteraction = createInteraction(ALICE, {
        function: 'isClaimable',
        fingerprint: fingerprintA,
        address: 'invalid-address'
      }, 'view')

      expect(
        () => RelayRegistryHandle(initState, missingAddressInteraction)
      ).to.throw(ContractError, ADDRESS_REQUIRED)
      expect(
        () => RelayRegistryHandle(initState, invalidAddressInteraction)
      ).to.throw(ContractError, INVALID_ADDRESS)
    })

    it('Requires Registration Credits to claim a relay', () => {
      const aliceClaimFingerprintA = createInteraction(ALICE, {
        function: 'claim',
        fingerprint: fingerprintA
      })

      expect(
        () => RelayRegistryHandle({
          ...initState,
          claimable: { [fingerprintA]: ALICE }
        }, aliceClaimFingerprintA)
      ).to.throw(ContractError, REGISTRATION_CREDIT_REQUIRED)
    })

    it('Allows claiming a relay with a Registration Credit', () => {
      const aliceClaimFingerprintA = createInteraction(ALICE, {
        function: 'claim',
        fingerprint: fingerprintA
      })

      const { state } = RelayRegistryHandle({
        ...initState,
        claimable: {
          [fingerprintA]: ALICE,
          [fingerprintB]: BOB,
          [fingerprintC]: ALICE
        },
        registrationCredits: {
          [ALICE]: 1
        }
      }, aliceClaimFingerprintA)

      expect(state.claimable).to.deep.equal({
        [fingerprintB]: BOB,
        [fingerprintC]: ALICE
      })
      expect(state.verified).to.deep.equal({
        [fingerprintA]: ALICE
      })
      expect(state.registrationCredits).to.deep.equal({
        [ALICE]: 0
      })
    })

    it('Requires address to match caller when claiming a relay', () => {
      const addClaimableAliceFingerprintA = createInteraction(OWNER, {
        function: 'addClaimable',
        fingerprint: fingerprintA,
        address: ALICE
      })

      RelayRegistryHandle(initState, addClaimableAliceFingerprintA)

      const bobClaimFingerprintA = createInteraction(BOB, {
        function: 'claim',
        fingerprint: fingerprintA
      })

      expect(
        () => RelayRegistryHandle(initState, bobClaimFingerprintA)
      ).to.throw(ContractError, FINGERPRINT_NOT_CLAIMABLE_BY_ADDRESS)
    })

    it('Requires & validates fingerprint when claiming a relay', () => {
      const missingFingerprintInteraction = createInteraction(ALICE, {
        function: 'claim'
      })
      const invalidFingerprintInteraction = createInteraction(ALICE, {
        function: 'claim',
        fingerprint: 'invalid-fingerprint'
      })

      expect(
        () => RelayRegistryHandle(initState, missingFingerprintInteraction)
      ).to.throw(ContractError, FINGERPRINT_REQUIRED)
      expect(
        () => RelayRegistryHandle(initState, invalidFingerprintInteraction)
      ).to.throw(ContractError, INVALID_FINGERPRINT)
    })

    it('Throws if a relay being claimed is not claimable', () => {
      const aliceClaimFingerprintAInteraction = createInteraction(ALICE, {
        function: 'claim',
        fingerprint: fingerprintA
      })

      expect(
        () => RelayRegistryHandle(initState, aliceClaimFingerprintAInteraction)
      ).to.throw(FINGERPRINT_NOT_CLAIMABLE_BY_ADDRESS)
    })
  })

  describe('Renouncing', () => {
    it('Allows renouncing of verified/claimed relays', () => {
      const aliceRenounceFingerprintAInteraction = createInteraction(ALICE, {
        function: 'renounce',
        fingerprint: fingerprintA
      })
      const { state } = RelayRegistryHandle(
        { ...initState, verified: { [fingerprintA]: ALICE } },
        aliceRenounceFingerprintAInteraction
      )

      expect(state.claimable).to.deep.equal({})
      expect(state.verified).to.deep.equal({})
    })

    it('Requires & validates fingerprint when renouncing a relay', () => {
      const missingFingerprintInteraction = createInteraction(ALICE, {
        function: 'renounce'
      })
      const invalidFingerprintInteraction = createInteraction(ALICE, {
        function: 'renounce',
        fingerprint: 'invalid-fingerprint'
      })

      expect(
        () => RelayRegistryHandle(initState, missingFingerprintInteraction)
      ).to.throw(ContractError, FINGERPRINT_REQUIRED)
      expect(
        () => RelayRegistryHandle(initState, invalidFingerprintInteraction)
      ).to.throw(ContractError, INVALID_FINGERPRINT)
    })

    it('Requires address to match caller when renouncing a relay', () => {
      const bobRenounceFingerprintAInteraction = createInteraction(BOB, {
        function: 'renounce',
        fingerprint: fingerprintA
      })

      expect(
        () => RelayRegistryHandle(
          { ...initState, verified: { [fingerprintA]: ALICE } },
          bobRenounceFingerprintAInteraction
        )
      ).to.throw(ContractError, FINGERPRINT_NOT_CLAIMED_BY_ADDRESS)
    })

    it('Throws if a relay is not verified/claimed when renouncing', () => {
      const aliceRenounceFingerprintAInteraction = createInteraction(ALICE, {
        function: 'renounce',
        fingerprint: fingerprintA
      })

      expect(
        () => RelayRegistryHandle(initState, aliceRenounceFingerprintAInteraction)
      ).to.throw(ContractError, FINGERPRINT_NOT_CLAIMED_BY_ADDRESS)
    })
  })

  describe('Removing', () => {
    it('Allows Owner to remove verified relays', () => {
      const removeVerifiedInteraction = createInteraction(OWNER, {
        function: 'removeVerified',
        fingerprint: fingerprintA
      })
      const { state } = RelayRegistryHandle(
        { ...initState, verified: { [fingerprintA]: ALICE } },
        removeVerifiedInteraction
      )

      expect(state.claimable).to.deep.equal({})
      expect(state.verified).to.deep.equal({})
    })

    it('Prevents non-owners from removing verified relays', () => {
      const bobRemoveVerifiedInteraction = createInteraction(BOB, {
        function: 'removeVerified',
        fingerprint: fingerprintA
      })

      expect(
        () => RelayRegistryHandle(
          { ...initState, verified: { [fingerprintA]: ALICE } },
          bobRemoveVerifiedInteraction
        )
      ).to.throw(ContractError, ERROR_ONLY_OWNER)
    })

    it('Requires & validates fingerprint when removing verified relays', () => {
      const missingFingerprintInteraction = createInteraction(OWNER, {
        function: 'removeVerified'
      })
      const invalidFingerprintInteraction = createInteraction(OWNER, {
        function: 'removeVerified',
        fingerprint: 'invalid-fingerprint'
      })

      expect(
        () => RelayRegistryHandle(initState, missingFingerprintInteraction)
      ).to.throw(ContractError, FINGERPRINT_REQUIRED)
      expect(
        () => RelayRegistryHandle(initState, invalidFingerprintInteraction)
      ).to.throw(ContractError, INVALID_FINGERPRINT)
    })
  })

  describe('Verifying', () => {
    it('Provides a view method of verified relays', () => {
      const viewVerifiedRelaysInteraction = createInteraction(ALICE, {
        function: 'verified'
      }, 'view')
      
      const { state, result } = RelayRegistryHandle(
        {
          ...initState,
          claimable: {
            [fingerprintB]: BOB
          },
          verified: {
            [fingerprintA]: ALICE,
            [fingerprintC]: ALICE
          }
        },
        viewVerifiedRelaysInteraction
      )

      expect(result).to.deep.equal(state.verified)
    })

    it('Provides a view method of verified relays by address', () => {
      const viewAliceVerifiedRelaysInteraction = createInteraction(ALICE, {
        function: 'verified',
        address: ALICE
      }, 'view')
      const viewBobVerifiedRelaysInteraction = createInteraction(ALICE, {
        function: 'verified',
        address: BOB
      }, 'view')

      const state = {
        ...initState,
        verified: {
          [fingerprintA]: ALICE,
          [fingerprintB]: BOB,
          [fingerprintC]: ALICE
        }
      }

      const { result: aliceViewVerifiedResult } = RelayRegistryHandle(
        state,
        viewAliceVerifiedRelaysInteraction
      )
      const { result: bobViewVerifiedResult } = RelayRegistryHandle(
        state,
        viewBobVerifiedRelaysInteraction
      )

      expect(aliceViewVerifiedResult).to.deep.equal([
        fingerprintA,
        fingerprintC
      ])
      expect(bobViewVerifiedResult).to.deep.equal([ fingerprintB ])
    })

    it('Validates address when viewing verified relays by address', () => {
      const invalidAddressInteraction = createInteraction(ALICE, {
        function: 'verified',
        address: 'invalid-address'
      }, 'view')

      expect(
        () => RelayRegistryHandle(initState, invalidAddressInteraction)
      ).to.throw(ContractError, INVALID_ADDRESS)
    })

    it('Provides a view method to check if a relay is verified', () => {
      const isVerifiedFingerprintAInteraction = createInteraction(ALICE, {
        function: 'isVerified',
        fingerprint: fingerprintA
      }, 'view')
      const isVerifiedFingerprintBInteraction = createInteraction(ALICE, {
        function: 'isVerified',
        fingerprint: fingerprintB
      }, 'view')

      const state = { ...initState, verified: { [fingerprintA]: ALICE } }

      const { result: isVerifiedFingerprintA } = RelayRegistryHandle(
        state,
        isVerifiedFingerprintAInteraction
      )
      const { result: isVerifiedFingerprintB } = RelayRegistryHandle(
        state,
        isVerifiedFingerprintBInteraction
      )

      expect(isVerifiedFingerprintA).to.be.true
      expect(isVerifiedFingerprintB).to.be.false
    })

    it('Requires & validates fingerprint when checking if a relay is verified', () => {
      const missingFingerprintInteraction = createInteraction(ALICE, {
        function: 'isVerified'
      }, 'view')
      const invalidFingerprintInteraction = createInteraction(ALICE, {
        function: 'isVerified',
        fingerprint: 'invalid-fingerprint'
      }, 'view')

      expect(
        () => RelayRegistryHandle(initState, missingFingerprintInteraction)
      ).to.throw(ContractError, FINGERPRINT_REQUIRED)
      expect(
        () => RelayRegistryHandle(initState, invalidFingerprintInteraction)
      ).to.throw(ContractError, INVALID_FINGERPRINT)
    })
  })

  describe('Registration Credits', () => {
    it('Allows Owner give a Registration Credit to an address', () => {
      const addRegistrationCredit = createInteraction(OWNER, {
        function: 'addRegistrationCredit',
        address: ALICE
      })

      const { state } = RelayRegistryHandle(initState, addRegistrationCredit)

      expect(state.registrationCredits).to.deep.equal({ [ALICE]: 1 })
    })

    it('Prevents non-owners from giving Registration Credits', () => {
      const addRegistrationCredit = createInteraction(ALICE, {
        function: 'addRegistrationCredit',
        address: ALICE
      })

      expect(
        () => RelayRegistryHandle(initState, addRegistrationCredit)
      ).to.throw(ContractError, ERROR_ONLY_OWNER)
    })

    it('Requires & validates address when giving Registration Credits', () => {
      const noAddressInteraction = createInteraction(OWNER, {
        function: 'addRegistrationCredit'
      })
      const invalidAddressInteraction = createInteraction(OWNER, {
        function: 'addRegistrationCredit',
        address: '0xbadbeef'
      })

      expect(
        () => RelayRegistryHandle(initState, noAddressInteraction)
      ).to.throw(ContractError, ADDRESS_REQUIRED)
      expect(
        () => RelayRegistryHandle(initState, invalidAddressInteraction)
      ).to.throw(ContractError, INVALID_ADDRESS)
    })
  })

  describe('Blocking Registration', () => {
    it('Allows Owner to block an address from claiming relays', () => {
      const blockInteraction = createInteraction(OWNER, {
        function: 'blockAddress',
        address: ALICE
      })

      const { state } = RelayRegistryHandle(initState, blockInteraction)

      expect(state.blockedAddresses).to.deep.equal([ALICE])
    })

    it('Requires & validates address when blocking', () => {
      const noAddressInteraction = createInteraction(OWNER, {
        function: 'blockAddress'
      })
      const invalidAddressInteraction = createInteraction(OWNER, {
        function: 'blockAddress',
        address: '0xbadbeef'
      })

      expect(
        () => RelayRegistryHandle(initState, noAddressInteraction)
      ).to.throw(ContractError, ADDRESS_REQUIRED)
      expect(
        () => RelayRegistryHandle(initState, invalidAddressInteraction)
      ).to.throw(ContractError, INVALID_ADDRESS)
    })

    it('Throws if address already blocked', () => {
      const blockInteraction = createInteraction(OWNER, {
        function: 'blockAddress',
        address: ALICE
      })

      expect(
        () => RelayRegistryHandle(
          {
            ...initState,
            blockedAddresses: [ALICE]
          },
          blockInteraction
        )
      ).to.throw(ContractError, ADDRESS_ALREADY_BLOCKED)
    })

    it('Prevents non-owners from blocking an address', () => {
      const blockInteraction = createInteraction(ALICE, {
        function: 'blockAddress',
        address: ALICE
      })

      expect(
        () => RelayRegistryHandle(initState, blockInteraction)
      ).to.throw(ContractError, ERROR_ONLY_OWNER)
    })

    it('Allows Owner to unblock an address from claiming relays', () => {
      const unblockInteraction = createInteraction(OWNER, {
        function: 'unblockAddress',
        address: BOB
      })

      const { state } = RelayRegistryHandle(
        {
          ...initState,
          blockedAddresses: [ ALICE, BOB, CHARLS ]
        },
        unblockInteraction
      )

      expect(state.blockedAddresses).to.deep.equal([ALICE, CHARLS])
    })

    it('Throws if unblocking an address that is not blocked', () => {
      const unblockInteraction = createInteraction(OWNER, {
        function: 'unblockAddress',
        address: BOB
      })

      expect(
        () => RelayRegistryHandle(initState, unblockInteraction)
      ).to.throw(ContractError, ADDRESS_NOT_BLOCKED)
    })

    it('Requires & validates address when unblocking', () => {
      const noAddressInteraction = createInteraction(OWNER, {
        function: 'unblockAddress'
      })
      const invalidAddressInteraction = createInteraction(OWNER, {
        function: 'unblockAddress',
        address: '0xbadbeef'
      })

      expect(
        () => RelayRegistryHandle(initState, noAddressInteraction)
      ).to.throw(ContractError, ADDRESS_REQUIRED)
      expect(
        () => RelayRegistryHandle(initState, invalidAddressInteraction)
      ).to.throw(ContractError, INVALID_ADDRESS)
    })

    it('Prevents non-owners from unblocking an address', () => {
      const unblockInteraction = createInteraction(ALICE, {
        function: 'unblockAddress',
        address: BOB
      })

      expect(
        () => RelayRegistryHandle(initState, unblockInteraction)
      ).to.throw(ContractError, ERROR_ONLY_OWNER)
    })

    it('Allows adding a relay as claimable even if address is blocked', () => {
      const addClaimableInteraction = createInteraction(OWNER, {
        function: 'addClaimable',
        fingerprint: fingerprintA,
        address: ALICE
      })

      const { state } = RelayRegistryHandle(
        {
          ...initState,
          blockedAddresses: [ALICE]
        },
        addClaimableInteraction
      )

      expect(state.claimable).to.deep.equal({ [fingerprintA]: ALICE })
    })

    it('Prevents claiming a relay if address is blocked', () => {
      const claimInteraction = createInteraction(ALICE, {
        function: 'claim',
        fingerprint: fingerprintA
      })

      expect(
        () => RelayRegistryHandle(
          {
            ...initState,
            claimable: { [fingerprintA]: ALICE },
            blockedAddresses: [ALICE],
            registrationCredits: { [ALICE]: 1 }
          },
          claimInteraction
        )
      ).to.throw(ContractError, ADDRESS_IS_BLOCKED)
    })
  })
})
