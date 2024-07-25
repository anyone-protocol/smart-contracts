import 'mocha'
import { expect } from 'chai'
import { ContractError, ContractInteraction } from 'warp-contracts'

import {
  FINGERPRINT_ALREADY_CLAIMABLE,
  FINGERPRINT_ALREADY_CLAIMED,
  FINGERPRINT_NOT_CLAIMABLE,
  FINGERPRINT_NOT_CLAIMABLE_BY_ADDRESS,
  FINGERPRINT_NOT_CLAIMED_BY_ADDRESS,
  RelayRegistryHandle,
  RelayRegistryState,
  ADDRESS_ALREADY_BLOCKED,
  ADDRESS_IS_BLOCKED,
  ADDRESS_NOT_BLOCKED,
  REGISTRATION_CREDIT_REQUIRED,
  FAMILY_REQUIRED,
  FAMILY_NOT_SET,
  HARDWARE_ALREADY_VERIFIED,
  DUPLICATE_FINGERPRINT,
  REGISTRATION_CREDIT_NOT_FOUND,
  HARDWARE_VERIFIED_MUST_BE_BOOLEAN_OR_UNDEFINED,
  RELAYS_MUST_BE_VALID_ARRAY,
  NICKNAME_MUST_BE_VALID
} from '../../src/contracts'
import { ERROR_ONLY_OWNER, INVALID_INPUT } from '../../src/util'
import {
  ADDRESS_REQUIRED,
  ENABLED_REQUIRED,
  FAMILIES_REQUIRED,
  FINGERPRINT_REQUIRED,
  INVALID_ADDRESS,
  INVALID_FAMILY,
  INVALID_FINGERPRINT,
  PUBLIC_KEY_REQUIRED
} from '../../src/common/errors'

const OWNER  = '0x1111111111111111111111111111111111111111'
const ALICE  = '0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa'
const BOB    = '0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB'
const CHARLS = '0xCcCCccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC'
const fingerprintA = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
const fingerprintB = 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB'
const fingerprintC = 'CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC'
const encryptionPrivateKey =
  'c72033fd8bf4e9e4d7d70e890bd73e2fa32cc420030c1b2da3e902856bb536d7'
const encryptionPublicKeyBase64 = 'u579ySzMngWIBGxrMCCPxDExuJuxhWMrHvvt3ZFPyBE='
const encryptionPublicKeyHex =
  '0xbb9efdc92ccc9e0588046c6b30208fc43131b89bb185632b1efbeddd914fc811'

let initState: RelayRegistryState
function resetState() {
  initState = {
    owner: OWNER,
    claimable: {},
    verified: {},
    registrationCredits: {},
    blockedAddresses: [],
    families: {},
    registrationCreditsRequired: false,
    encryptionPublicKey: '',
    verifiedHardware: {},
    familyRequired: false,
    nicknames: {}
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

  it('Throws on invalid input', () => {
    expect(
      () => RelayRegistryHandle(initState, { caller: ALICE, input: {} } as any)
    ).to.throw(ContractError, INVALID_INPUT)
  })

  it('Ensures state properties after evolution', () => {
    const addClaimableInteraction = createInteraction(OWNER, {
      function: 'addClaimable',
      fingerprint: fingerprintA,
      address: ALICE
    })

    const { state } = RelayRegistryHandle(
      { owner: OWNER } as any,
      addClaimableInteraction
    )

    expect(state.claimable).to.exist
    expect(state.blockedAddresses).to.exist
    expect(state.families).to.exist
    expect(state.registrationCredits).to.exist
    expect(state.verified).to.exist
    expect(state.registrationCreditsRequired).to.exist
    expect(state.encryptionPublicKey).to.exist
    expect(state.verifiedHardware).to.exist
    expect(state.registrationCredits).to.exist
    expect(state.nicknames).to.exist
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
          claimable: { [fingerprintA]: ALICE },
          registrationCreditsRequired: true
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
          [ALICE]: [fingerprintA]
        },
        registrationCreditsRequired: true
      }, aliceClaimFingerprintA)

      expect(state.claimable).to.deep.equal({
        [fingerprintB]: BOB,
        [fingerprintC]: ALICE
      })
      expect(state.verified).to.deep.equal({
        [fingerprintA]: ALICE
      })
      expect(state.registrationCredits).to.deep.equal({
        [ALICE]: []
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

    it('Does not require registration credits for verified hardware', () => {
      const aliceClaimFingerprintA = createInteraction(ALICE, {
        function: 'claim',
        fingerprint: fingerprintA
      })

      const { state } = RelayRegistryHandle({
        ...initState,
        claimable: { [fingerprintA]: ALICE },
        registrationCreditsRequired: true,
        verifiedHardware: { [fingerprintA]: 1 }
      }, aliceClaimFingerprintA)

      expect(state.verified[fingerprintA]).equals(ALICE)
    })

    it('Allows Owner to add claimable relays in a batch', () => {
      const addClaimableBatched = createInteraction(OWNER, {
        function: 'addClaimableBatched',
        relays: [
          {
            fingerprint: fingerprintB,
            address: BOB
          }, {
            fingerprint: fingerprintC,
            address: CHARLS,
            hardwareVerified: true
          }
        ]
      })

      const { state } = RelayRegistryHandle(initState, addClaimableBatched)

      expect(state.claimable).to.deep.equal({
        [fingerprintB]: BOB,
        [fingerprintC]: CHARLS
      })
      expect(state.verifiedHardware).to.deep.equal({ [fingerprintC]: 1 })
    })

    it('Prevents non-owners from adding claimable relays in a batch', () => {
      const aliceAddClaimableBatched = createInteraction(ALICE, {
        function: 'addClaimableBatched',
        relays: [{
          fingerprint: fingerprintA,
          address: ALICE
        }]
      })

      expect(
        () => RelayRegistryHandle(initState, aliceAddClaimableBatched)
      ).to.throw(ERROR_ONLY_OWNER)
    })

    it('Validates when adding claimable relays in a batch', () => {
      const undefinedRelays = createInteraction(OWNER, {
        function: 'addClaimableBatched'
      })

      expect(
        () => RelayRegistryHandle(initState, undefinedRelays)
      ).to.throw(RELAYS_MUST_BE_VALID_ARRAY)

      const noRelays = createInteraction(OWNER, {
        function: 'addClaimableBatched',
        relays: []
      })

      expect(
        () => RelayRegistryHandle(initState, noRelays)
      ).to.throw(RELAYS_MUST_BE_VALID_ARRAY)
    })

    it('Allows Owner to add a nickname when adding a claimable relay', () => {
      const nickname = 'CHARLS'
      const addClaimableWithNickname = createInteraction(OWNER, {
        function: 'addClaimable',
        fingerprint: fingerprintC,
        address: CHARLS,
        nickname
      })

      const { state } = RelayRegistryHandle(initState, addClaimableWithNickname)

      expect(state.nicknames[fingerprintC]).to.equal(nickname)
    })

    it('Validates nicknames when adding a claimable relay', () => {
      const nonStringNickname = createInteraction(OWNER, {
        function: 'addClaimable',
        fingerprint: fingerprintC,
        address: CHARLS,
        nickname: 3
      })

      expect(
        () => RelayRegistryHandle(initState, nonStringNickname)
      ).to.throw(NICKNAME_MUST_BE_VALID)

      const tooLongNickname = createInteraction(OWNER, {
        function: 'addClaimable',
        fingerprint: fingerprintC,
        address: CHARLS,
        nickname: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
      })

      expect(
        () => RelayRegistryHandle(initState, tooLongNickname)
      ).to.throw(NICKNAME_MUST_BE_VALID)
    })

    it('Allows Owner to add a nickname when adding a claimable batch', () => {
      const aliceNickname = 'ALICE'
      const charlsNickname = 'BOB'
      const addBatchWithNicknames = createInteraction(OWNER, {
        function: 'addClaimableBatched',
        relays: [
          {
            fingerprint: fingerprintA,
            address: ALICE,
            nickname: aliceNickname
          },
          {
            fingerprint: fingerprintB,
            address: BOB
          },
          {
            fingerprint: fingerprintC,
            address: CHARLS,
            nickname: charlsNickname
          }
        ]
      })

      const { state } = RelayRegistryHandle(initState, addBatchWithNicknames)

      expect(state.nicknames).to.deep.equal({
        [fingerprintA]: aliceNickname,
        [fingerprintC]: charlsNickname
      })
    })

    it('Validates nicknames when adding a relay as a claimable batch', () => {
      const nonStringNickname = createInteraction(OWNER, {
        function: 'addClaimableBatched',
        relays: [{
          fingerprint: fingerprintC,
          address: CHARLS,
          nickname: 3
        }]
      })

      expect(
        () => RelayRegistryHandle(initState, nonStringNickname)
      ).to.throw(NICKNAME_MUST_BE_VALID)

      const tooLongNickname = createInteraction(OWNER, {
        function: 'addClaimableBatched',
        relays: [{
          fingerprint: fingerprintC,
          address: CHARLS,
          nickname: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
        }]
      })

      expect(
        () => RelayRegistryHandle(initState, tooLongNickname)
      ).to.throw(NICKNAME_MUST_BE_VALID)
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

    it('Gracefully handles delete verifiedHardware on renounce', () => {
      const renounceNonHardware = createInteraction(ALICE, {
        function: 'renounce',
        fingerprint: fingerprintA
      })

      const { state } = RelayRegistryHandle(
        {
          ...initState,
          verified: { [fingerprintA]: ALICE }
        },
        renounceNonHardware
      )

      expect(state.verified).to.deep.equal({})
    })

    it('Should remove nicknames of renounced relays', () => {
      const nickname = 'alice'
      const renounceNicknameRelay = createInteraction(ALICE, {
        function: 'renounce',
        fingerprint: fingerprintA
      })

      const { state } = RelayRegistryHandle(
        {
          ...initState,
          verified: { [fingerprintA]: ALICE },
          nicknames: { [fingerprintA]: nickname }
        },
        renounceNicknameRelay
      )

      expect(state.nicknames).to.deep.equal({})
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

    it('Should remove nicknames of removed relays', () => {
      const nickname = 'alice'
      const removeNicknameRelay = createInteraction(OWNER, {
        function: 'removeVerified',
        fingerprint: fingerprintA
      })

      const { state } = RelayRegistryHandle(
        {
          ...initState,
          verified: { [fingerprintA]: ALICE },
          nicknames: { [fingerprintA]: nickname }
        },
        removeNicknameRelay
      )
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
        function: 'addRegistrationCredits',
        credits: [
          { address: ALICE, fingerprint: fingerprintA },
          { address: BOB, fingerprint: fingerprintB },
          { address: ALICE, fingerprint: fingerprintC }
        ]
      })

      const { state } = RelayRegistryHandle(initState, addRegistrationCredit)

      expect(state.registrationCredits).to.deep.equal(
        {
          [ALICE]: [fingerprintA, fingerprintC],
          [BOB]: [fingerprintB]
        }
      )
    })

    it('Prevents non-owners from giving Registration Credits', () => {
      const addRegistrationCredit = createInteraction(ALICE, {
        function: 'addRegistrationCredits',
        address: ALICE
      })

      expect(
        () => RelayRegistryHandle(initState, addRegistrationCredit)
      ).to.throw(ContractError, ERROR_ONLY_OWNER)
    })

    it('Validates when giving Registration Credits', () => {
      const noAddress = createInteraction(OWNER, {
        function: 'addRegistrationCredits',
        credits: [{ fingerprint: fingerprintA }]
      })
      const invalidAddress = createInteraction(OWNER, {
        function: 'addRegistrationCredits',
        credits: [{
          address: '0xbadbeef',
          fingerprint: fingerprintA
        }]
      })
      const missingFingerprint = createInteraction(OWNER, {
        function: 'addRegistrationCredits',
        credits: [{
          address: ALICE
        }]
      })
      const invalidFingerprint = createInteraction(OWNER, {
        function: 'addRegistrationCredits',
        credits: [{
          address: ALICE,
          fingerprint: 'invalid-fingerprint'
        }]
      })
      const duplicateFingerprint = createInteraction(OWNER, {
        function: 'addRegistrationCredits',
        credits: [{
          address: ALICE,
          fingerprint: fingerprintA
        }]
      })

      expect(
        () => RelayRegistryHandle(initState, noAddress)
      ).to.throw(ContractError, ADDRESS_REQUIRED)
      expect(
        () => RelayRegistryHandle(initState, invalidAddress)
      ).to.throw(ContractError, INVALID_ADDRESS)
      expect(
        () => RelayRegistryHandle(initState, missingFingerprint)
      ).to.throw(ContractError, FINGERPRINT_REQUIRED)
      expect(
        () => RelayRegistryHandle(initState, invalidFingerprint)
      ).to.throw(ContractError, INVALID_FINGERPRINT)
      expect(
        () => RelayRegistryHandle(
          {
            ...initState,
            registrationCredits: { [ALICE]: [fingerprintA] }
          },
          duplicateFingerprint
        )
      ).to.throw(DUPLICATE_FINGERPRINT)
    })

    it('Allows Owner to remove registration credits', () => {
      const removeRegistrationCredits = createInteraction(OWNER, {
        function: 'removeRegistrationCredits',
        credits: [
          { address: BOB, fingerprint: fingerprintB },
          { address: ALICE, fingerprint: fingerprintC }
        ]
      })

      const { state } = RelayRegistryHandle(
        {
          ...initState,
          registrationCredits: {
            [ALICE]: [fingerprintA, fingerprintC],
            [BOB]: [fingerprintB]
          }
        },
        removeRegistrationCredits
      )

      expect(state.registrationCredits).to.deep.equal(
        {
          [ALICE]: [fingerprintA],
          [BOB]: []
        }
      )
    })

    it('Prevents non-owners from removing registration credits', () => {
      const removeRegistrationCredits = createInteraction(ALICE, {
        function: 'removeRegistrationCredits',
        address: ALICE
      })

      expect(
        () => RelayRegistryHandle(initState, removeRegistrationCredits)
      ).to.throw(ContractError, ERROR_ONLY_OWNER)
    })

    it('Validates when removing registration credits', () => {
      const noAddress = createInteraction(OWNER, {
        function: 'removeRegistrationCredits',
        credits: [{ fingerprint: fingerprintA }]
      })
      const invalidAddress = createInteraction(OWNER, {
        function: 'removeRegistrationCredits',
        credits: [{
          address: '0xbadbeef',
          fingerprint: fingerprintA
        }]
      })
      const missingFingerprint = createInteraction(OWNER, {
        function: 'removeRegistrationCredits',
        credits: [{
          address: ALICE
        }]
      })
      const invalidFingerprint = createInteraction(OWNER, {
        function: 'removeRegistrationCredits',
        credits: [{
          address: ALICE,
          fingerprint: 'invalid-fingerprint'
        }]
      })
      const creditNotFound = createInteraction(OWNER, {
        function: 'removeRegistrationCredits',
        credits: [{
          address: ALICE,
          fingerprint: fingerprintA
        }]
      })

      expect(
        () => RelayRegistryHandle(initState, noAddress)
      ).to.throw(ContractError, ADDRESS_REQUIRED)
      expect(
        () => RelayRegistryHandle(initState, invalidAddress)
      ).to.throw(ContractError, INVALID_ADDRESS)
      expect(
        () => RelayRegistryHandle(initState, missingFingerprint)
      ).to.throw(ContractError, FINGERPRINT_REQUIRED)
      expect(
        () => RelayRegistryHandle(initState, invalidFingerprint)
      ).to.throw(ContractError, INVALID_FINGERPRINT)
      expect(
        () => RelayRegistryHandle(initState, creditNotFound)
      ).to.throw(REGISTRATION_CREDIT_NOT_FOUND)
    })

    it('Allows Owner to disable registration credit requirement', () => {
      const disableRequirement = createInteraction(OWNER, {
        function: 'toggleRegistrationCreditRequirement',
        enabled: false
      })

      const { state } = RelayRegistryHandle(initState, disableRequirement)

      expect(state.registrationCreditsRequired).to.be.false
    })

    it('Prevents non-owners from disabling registration credits', () => {
      const aliceDisableRequirement = createInteraction(ALICE, {
        function: 'toggleRegistrationCreditRequirement',
        enabled: false
      })

      expect(
        () => RelayRegistryHandle(initState, aliceDisableRequirement)
      ).to.throw(ERROR_ONLY_OWNER)
    })

    it('Allows Owner to enable registration credit requirement', () => {
      const enableRequirement = createInteraction(OWNER, {
        function: 'toggleRegistrationCreditRequirement',
        enabled: true
      })

      const { state } = RelayRegistryHandle(initState, enableRequirement)

      expect(state.registrationCreditsRequired).to.be.true
    })

    it('Prevents non-owners from enabling registration credits', () => {
      const aliceEnableRequirement = createInteraction(ALICE, {
        function: 'toggleRegistrationCreditRequirement',
        enabled: true
      })

      expect(
        () => RelayRegistryHandle(initState, aliceEnableRequirement)
      ).to.throw(ERROR_ONLY_OWNER)
    })

    it('Validates input when toggling registration credit requirement', () => {
      const undefinedToggle = createInteraction(OWNER, {
        function: 'toggleRegistrationCreditRequirement'
      })

      expect(
        () => RelayRegistryHandle(initState, undefinedToggle)
      ).to.throw(ENABLED_REQUIRED)

      const zeroToggle = createInteraction(OWNER, {
        function: 'toggleRegistrationCreditRequirement',
        enabled: 0
      })

      expect(
        () => RelayRegistryHandle(initState, zeroToggle)
      ).to.throw(ENABLED_REQUIRED)

      const positiveToggle = createInteraction(OWNER, {
        function: 'toggleRegistrationCreditRequirement',
        enabled: 12
      })

      expect(
        () => RelayRegistryHandle(initState, positiveToggle)
      ).to.throw(ENABLED_REQUIRED)

      const objectToggle = createInteraction(OWNER, {
        function: 'toggleRegistrationCreditRequirement',
        enabled: { enabled: true }
      })

      expect(
        () => RelayRegistryHandle(initState, objectToggle)
      ).to.throw(ENABLED_REQUIRED)

      const stringToggle = createInteraction(OWNER, {
        function: 'toggleRegistrationCreditRequirement',
        enabled: 'true'
      })

      expect(
        () => RelayRegistryHandle(initState, stringToggle)
      ).to.throw(ENABLED_REQUIRED)
    })

    it('Does not require credits to claim a relay when disabled', () => {
      const aliceClaimFingerprintA = createInteraction(ALICE, {
        function: 'claim',
        fingerprint: fingerprintA
      })

      const { state } = RelayRegistryHandle({
        ...initState,
        claimable: { [fingerprintA]: ALICE },
        registrationCreditsRequired: false
      }, aliceClaimFingerprintA)

      expect(state.verified[fingerprintA]).equals(ALICE)
    })

    it('Requires credits to claim a relay when enabled', () => {
      const aliceClaimFingerprintA = createInteraction(ALICE, {
        function: 'claim',
        fingerprint: fingerprintA
      })

      expect(
        () => RelayRegistryHandle({
          ...initState,
          claimable: { [fingerprintA]: ALICE },
          registrationCreditsRequired: true
        }, aliceClaimFingerprintA)
      ).to.throw(ContractError, REGISTRATION_CREDIT_REQUIRED)
    })

    it('Requires credits to match fingerprint being claimed', () => {
      const differentFingerprint = createInteraction(ALICE, {
        function: 'claim',
        fingerprint: fingerprintB
      })

      expect(
        () => RelayRegistryHandle(
          {
            ...initState,
            claimable: {
              [fingerprintA]: ALICE,
              [fingerprintB]: ALICE,
              [fingerprintC]: ALICE
            },
            registrationCreditsRequired: true,
            registrationCredits: {
              [ALICE]: [fingerprintA, fingerprintC]
            }
          },
          differentFingerprint
        )
      ).to.throw(REGISTRATION_CREDIT_REQUIRED)
    })

    it('Consumes registration credits when enabled', () => {
      const claimRelay = createInteraction(ALICE, {
        function: 'claim',
        fingerprint: fingerprintA
      })

      const { state } = RelayRegistryHandle(
        {
          ...initState,
          claimable: {
            [fingerprintA]: ALICE
          },
          registrationCreditsRequired: true,
          registrationCredits: {
            [ALICE]: [fingerprintA, fingerprintB, fingerprintC]
          }
        },
        claimRelay
      )

      expect(state.registrationCredits[ALICE])
        .to.deep.equal([fingerprintB, fingerprintC])
    })

    it('Does not consume registration credits when disabled', () => {
      const claimRelay = createInteraction(ALICE, {
        function: 'claim',
        fingerprint: fingerprintA
      })

      const { state } = RelayRegistryHandle(
        {
          ...initState,
          claimable: {
            [fingerprintA]: ALICE
          },
          registrationCreditsRequired: false,
          registrationCredits: {
            [ALICE]: [fingerprintA, fingerprintB, fingerprintC]
          }
        },
        claimRelay
      )

      expect(state.registrationCredits[ALICE])
        .to.deep.equal([fingerprintA, fingerprintB, fingerprintC])
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
            registrationCredits: { [ALICE]: [fingerprintA] }
          },
          claimInteraction
        )
      ).to.throw(ContractError, ADDRESS_IS_BLOCKED)
    })
  })

  describe('Families', () => {
    it('Allows Owner to set relay families', () => {
      const setFamilies = createInteraction(OWNER, {
        function: 'setFamilies',
        families: [
          {
            fingerprint: fingerprintA,
            family: [ fingerprintC ]
          },
          {
            fingerprint: fingerprintC,
            family: [ fingerprintA ]
          }
        ]
      })

      const { state } = RelayRegistryHandle(initState, setFamilies)

      expect(state.families).to.deep.equal({
        [fingerprintA]: [fingerprintC],
        [fingerprintC]: [fingerprintA]
      })
    })

    it('Prevents non-owners from setting relay families', () => {
      const aliceSetFamilies = createInteraction(ALICE, {
        function: 'setFamilies',
        families: [
          {
            fingerprint: fingerprintA,
            family: [ fingerprintC ]
          },
          {
            fingerprint: fingerprintC,
            family: [ fingerprintA ]
          }
        ]
      })

      expect(
        () => RelayRegistryHandle(initState, aliceSetFamilies)
      ).to.throw(ERROR_ONLY_OWNER)
    })

    it('Validates when setting relay families', () => {
      const missingFamilies = createInteraction(OWNER, {
        function: 'setFamilies'      
      })

      expect(
        () => RelayRegistryHandle(initState, missingFamilies)
      ).to.throw(FAMILIES_REQUIRED)

      const noFamilies = createInteraction(OWNER, {
        function: 'setFamilies',
        families: []
      })

      expect(
        () => RelayRegistryHandle(initState, noFamilies)
      ).to.throw(FAMILIES_REQUIRED)

      const nonArrayFamilies = createInteraction(OWNER, {
        function: 'setFamilies',
        families: { weewoo: 'boop' }
      })

      expect(
        () => RelayRegistryHandle(initState, nonArrayFamilies)
      ).to.throw(FAMILIES_REQUIRED)

      const noFingerprintFamily = createInteraction(OWNER, {
        function: 'setFamilies',
        families: [{
          family: []
        }]
      })

      expect(
        () => RelayRegistryHandle(initState, noFingerprintFamily)
      ).to.throw(FINGERPRINT_REQUIRED)

      const invalidFingerprintFamily = createInteraction(OWNER, {
        function: 'setFamilies',
        families: [{
          fingerprint: 'invalid',
          family: []
        }]
      })

      expect(
        () => RelayRegistryHandle(initState, invalidFingerprintFamily)
      ).to.throw(INVALID_FINGERPRINT)

      const nonStringFingerprintFamily = createInteraction(OWNER, {
        function: 'setFamilies',
        families: [{
          fingerprint: {},
          family: []
        }]
      })

      expect(
        () => RelayRegistryHandle(initState, nonStringFingerprintFamily)
      ).to.throw(INVALID_FINGERPRINT)

      const noFamilyFamily = createInteraction(OWNER, {
        function: 'setFamilies',
        families: [{
          fingerprint: fingerprintA
        }]
      })

      expect(
        () => RelayRegistryHandle(initState, noFamilyFamily)
      ).to.throw(INVALID_FAMILY)

      const invalidFamilyFingerprintsFamily = createInteraction(OWNER, {
        function: 'setFamilies',
        families: [{
          fingerprint: fingerprintA,
          family: [{}, 1, undefined, null, 'invalid']
        }]
      })

      expect(
        () => RelayRegistryHandle(initState, invalidFamilyFingerprintsFamily)
      ).to.throw(INVALID_FINGERPRINT)

      const someInvalidFamilyFingerprintsFamily = createInteraction(OWNER, {
        function: 'setFamilies',
        families: [{
          fingerprint: fingerprintA,
          family: [fingerprintC, 'invalid', null]
        }]
      })

      expect(
        () => RelayRegistryHandle(initState, someInvalidFamilyFingerprintsFamily)
      ).to.throw(INVALID_FINGERPRINT)
    })

    it('Prevents claiming of more than 1 relay if family not set', () => {
      const secondRelayNoFamily = createInteraction(ALICE, {
        function: 'claim',
        fingerprint: fingerprintC
      })

      expect(
        () => RelayRegistryHandle(
          {
            ...initState,
            familyRequired: true,
            claimable: { [fingerprintC]: ALICE },
            registrationCredits: { [ALICE]: [fingerprintC] },
            verified: { [fingerprintA]: ALICE }
          },
          secondRelayNoFamily
        )
      ).to.throw(ContractError, FAMILY_NOT_SET)
    })

    it('Prevents claiming of more relays if all families not set', () => {
      const latestRelayNoFamily = createInteraction(ALICE, {
        function: 'claim',
        fingerprint: fingerprintC
      })

      expect(
        () => RelayRegistryHandle(
          {
            ...initState,
            familyRequired: true,
            registrationCredits: { [ALICE]: [fingerprintC] },
            claimable: { [fingerprintC]: ALICE },
            verified: {
              [fingerprintA]: ALICE,
              [fingerprintB]: ALICE
            },
            families: {
              [fingerprintA]: [fingerprintB],
              [fingerprintB]: [fingerprintA]
            }
          },
          latestRelayNoFamily
        )
      ).to.throw(ContractError, FAMILY_NOT_SET)
    })

    it('Allows Owner to toggle family requirements', () => {
      const toggleFamilyOn = createInteraction(OWNER, {
        function: 'toggleFamilyRequirement',
        enabled: true
      })

      const { state } = RelayRegistryHandle(initState, toggleFamilyOn)

      expect(state.familyRequired).to.be.true
    })

    it('Prevents non-owners from toggling family requirements', () => {
      const aliceToggleFamilyOn = createInteraction(ALICE, {
        function: 'toggleFamilyRequirement',
        enabled: true
      })

      expect(
        () => RelayRegistryHandle(initState, aliceToggleFamilyOn)
      ).to.throw(ERROR_ONLY_OWNER)
    })

    it('Validates input when toggling family requirements', () => {
      const undefinedToggle = createInteraction(OWNER, {
        function: 'toggleFamilyRequirement'
      })

      expect(
        () => RelayRegistryHandle(initState, undefinedToggle)
      ).to.throw(ENABLED_REQUIRED)

      const zeroToggle = createInteraction(OWNER, {
        function: 'toggleFamilyRequirement',
        enabled: 0
      })

      expect(
        () => RelayRegistryHandle(initState, zeroToggle)
      ).to.throw(ENABLED_REQUIRED)

      const positiveToggle = createInteraction(OWNER, {
        function: 'toggleFamilyRequirement',
        enabled: 12
      })

      expect(
        () => RelayRegistryHandle(initState, positiveToggle)
      ).to.throw(ENABLED_REQUIRED)

      const objectToggle = createInteraction(OWNER, {
        function: 'toggleFamilyRequirement',
        enabled: { enabled: true }
      })

      expect(
        () => RelayRegistryHandle(initState, objectToggle)
      ).to.throw(ENABLED_REQUIRED)

      const stringToggle = createInteraction(OWNER, {
        function: 'toggleFamilyRequirement',
        enabled: 'true'
      })

      expect(
        () => RelayRegistryHandle(initState, stringToggle)
      ).to.throw(ENABLED_REQUIRED)
    })

    it('Does not require family registration when disabled', () => {
      const aliceClaimA = createInteraction(ALICE, {
        function: 'claim',
        fingerprint: fingerprintA
      })

      const aliceClaimB = createInteraction(ALICE, {
        function: 'claim',
        fingerprint: fingerprintB
      })

      const noFamilyState = {
        ...initState,
        claimable: {
          [fingerprintA]: ALICE,
          [fingerprintB]: ALICE
        },
        registrationCreditsRequired: false,
        familyRequired: false
      }
      RelayRegistryHandle(noFamilyState, aliceClaimA)
      const { state } = RelayRegistryHandle(noFamilyState, aliceClaimB)

      expect(state.verified).to.deep.equal({
        [fingerprintA]: ALICE,
        [fingerprintB]: ALICE
      })
    })

    it('Requires family registration when enabled', () => {
      const aliceClaimA = createInteraction(ALICE, {
        function: 'claim',
        fingerprint: fingerprintA
      })

      const aliceClaimB = createInteraction(ALICE, {
        function: 'claim',
        fingerprint: fingerprintB
      })

      const familyRequiredState = {
        ...initState,
        claimable: {
          [fingerprintA]: ALICE,
          [fingerprintB]: ALICE
        },
        registrationCreditsRequired: false,
        familyRequired: true
      }
      RelayRegistryHandle(familyRequiredState, aliceClaimA)
      expect(
        () => RelayRegistryHandle(familyRequiredState, aliceClaimB)
      ).to.throw(FAMILY_NOT_SET)
    })

    it('Allows relays with registered families to claim when enabled', () => {
      const aliceClaimB = createInteraction(ALICE, {
        function: 'claim',
        fingerprint: fingerprintB
      })

      const { state } = RelayRegistryHandle(
        {
          ...initState,
          claimable: {
            [fingerprintB]: ALICE
          },
          verified: {
            [fingerprintA]: ALICE,
            [fingerprintC]: ALICE
          },
          families: {
            [fingerprintA]: [fingerprintA, fingerprintB, fingerprintC],
            [fingerprintB]: [fingerprintA, fingerprintB, fingerprintC],
            [fingerprintC]: [fingerprintA, fingerprintB, fingerprintC]
          },
          registrationCreditsRequired: false,
          familyRequired: true
        },
        aliceClaimB
      )

      expect(state.verified).to.deep.equal({
        [fingerprintA]: ALICE,
        [fingerprintB]: ALICE,
        [fingerprintC]: ALICE
      })
    })
  })

  describe('Encryption', () => {
    it('Allows Owner to set a public key to receive encrypted messages', () => {
      const setKey = createInteraction(OWNER, {
        function: 'setEncryptionPublicKey',
        encryptionPublicKey: encryptionPublicKeyHex
      })

      const { state } = RelayRegistryHandle(initState, setKey)

      expect(state.encryptionPublicKey).to.equal(encryptionPublicKeyHex)
    })

    it('Prevents non-owners from setting public encryption key', () => {
      const aliceSetKey = createInteraction(ALICE, {
        function: 'setEncryptionPublicKey',
        encryptionPublicKey: encryptionPublicKeyHex
      })

      expect(
        () => RelayRegistryHandle(initState, aliceSetKey)
      ).to.throw(ERROR_ONLY_OWNER)
    })

    it('Requires & validates when setting public encryption key', () => {
      const missingKey = createInteraction(OWNER, {
        function: 'setEncryptionPublicKey'
      })

      expect(
        () => RelayRegistryHandle(initState, missingKey)
      ).to.throw(PUBLIC_KEY_REQUIRED)

      const badKey = createInteraction(OWNER, {
        function: 'setEncryptionPublicKey',
        encryptionPublicKey: 'bad-key'
      })

      expect(
        () => RelayRegistryHandle(initState, badKey)
      ).to.throw(PUBLIC_KEY_REQUIRED)
    })
  })

  describe('Verified Hardware', () => {
    it('Allows Owner to verify hardware', () => {
      const verifySerial = createInteraction(OWNER, {
        function: 'verifySerials',
        fingerprints: [fingerprintA]
      })

      const { state } = RelayRegistryHandle(initState, verifySerial)

      expect(state.verifiedHardware).to.deep.equal({ [fingerprintA]: 1 })
    })

    it('Prevents non-owners from verifying hardware serials', () => {
      const aliceVerifySerial = createInteraction(ALICE, {
        function: 'verifySerials',
        fingerprints: [fingerprintA]
      })

      expect(
        () => RelayRegistryHandle(initState, aliceVerifySerial)
      ).to.throw(ERROR_ONLY_OWNER)
    })

    it('Allows Owner to remove serials', () => {
      const removeSerial = createInteraction(OWNER, {
        function: 'removeSerials',
        fingerprints: [fingerprintA]
      })

      const { state } = RelayRegistryHandle(
        {
          ...initState,
          verified: {
            [fingerprintA]: ALICE
          },
          verifiedHardware: { [fingerprintA]: 1 }
        },
        removeSerial
      )

      expect(state.verifiedHardware).to.not.have.property(fingerprintA)
    })

    it('Prevents non-owners from removing serials', () => {
      const aliceRemoveSerial = createInteraction(ALICE, {
        function: 'removeSerials',
        fingerprints: [fingerprintA]
      })

      expect(
        () => RelayRegistryHandle(initState, aliceRemoveSerial)
      ).to.throw(ERROR_ONLY_OWNER)
    })

    it('Provides view method of verified relays (software & hardware)', () => {
      const viewVerifiedRelays = createInteraction(ALICE, {
        function: 'getVerifiedRelays'
      }, 'view')

      const { result } = RelayRegistryHandle(
        {
          ...initState,
          verified: {
            [fingerprintA]: ALICE,
            [fingerprintB]: BOB,
            [fingerprintC]: CHARLS
          },
          verifiedHardware: { [fingerprintC]: 1 }
        },
        viewVerifiedRelays
      )

      expect(result).to.deep.equal({
        verified: {
          [fingerprintA]: ALICE,
          [fingerprintB]: BOB
        },
        verifiedHardware: {
          [fingerprintC]: CHARLS
        }
      })
    })

    it('Cleans up verified hardware on renounce of relay', () => {
      const renounce = createInteraction(ALICE, {
        function: 'renounce',
        fingerprint: fingerprintA
      })

      const { state } = RelayRegistryHandle(
        {
          ...initState,
          verified: { [fingerprintA]: ALICE },
          verifiedHardware: { [fingerprintA]: 1 }
        },
        renounce
      )

      expect(state.verifiedHardware[fingerprintA]).to.not.exist
    })

    it('Prevents Owner from redundant hardware verifications', () => {
      const verifyHardwareAgain = createInteraction(OWNER, {
        function: 'verifySerials',
        fingerprints: [fingerprintA]
      })

      expect(
        () => RelayRegistryHandle(
          {
            ...initState,
            verifiedHardware: { [fingerprintA]: 1 }
          },
          verifyHardwareAgain
        )
      ).to.throw(HARDWARE_ALREADY_VERIFIED)
    })

    it('Allows Owner to verify hardware when adding relay as claimable', () => {
      const addClaimableHardware = createInteraction(OWNER, {
        function: 'addClaimable',
        fingerprint: fingerprintA,
        address: ALICE,
        hardwareVerified: true
      })

      const { state } = RelayRegistryHandle(initState, addClaimableHardware)

      expect(state.verifiedHardware).to.deep.equal({ [fingerprintA]: 1 })
    })

    it('Validates verifying hardware when adding relay as claimable', () => {
      const addClaimableNumberHardware = createInteraction(OWNER, {
        function: 'addClaimable',
        fingerprint: fingerprintA,
        address: ALICE,
        hardwareVerified: 1
      })

      expect(
        () => RelayRegistryHandle(initState, addClaimableNumberHardware)
      ).to.throw(HARDWARE_VERIFIED_MUST_BE_BOOLEAN_OR_UNDEFINED)
    })
  })
})
