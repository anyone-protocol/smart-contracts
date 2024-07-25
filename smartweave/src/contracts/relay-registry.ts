import {
  ContractError,
  ContractInteraction,
  HandlerResult
} from 'warp-contracts'

import {
  ContractAssert,
  Evolvable,
  EvolvableState,
  INVALID_INPUT,
  OnlyOwner,
  OwnableState,
  PartialFunctionInput,
  SmartWeave,
  UPPER_HEX_CHARS,
  assertValidEvmAddress,
  assertValidFingerprint,
  assertValidPublicKey
} from '../util'
import {
  ContractFunctionInput,
  EvmAddress,
  Fingerprint,
  PublicKey
} from '../common/types'
import { ENABLED_REQUIRED, FAMILIES_REQUIRED, FINGERPRINTS_MUST_BE_ARRAY, INVALID_FAMILY } from '../common/errors'

export const FINGERPRINT_ALREADY_CLAIMABLE = 'Fingerprint already claimable'
export const FINGERPRINT_NOT_CLAIMABLE = 'Fingerprint not claimable'
export const FINGERPRINT_NOT_CLAIMABLE_BY_ADDRESS =
  'Fingerprint not claimable by this address'
export const FINGERPRINT_ALREADY_CLAIMED = 'Fingerprint already claimed'
export const FINGERPRINT_NOT_CLAIMED_BY_ADDRESS =
  'Fingerprint not claimed by address'
export const REGISTRATION_CREDIT_REQUIRED =
  'A Registration Credit is required to claim a fingerprint'
export const ADDRESS_ALREADY_BLOCKED = 'Address already blocked'
export const ADDRESS_NOT_BLOCKED = 'Address not blocked'
export const ADDRESS_IS_BLOCKED = 'Address is blocked'
export const FAMILY_REQUIRED = 'Family required'
export const FAMILY_NOT_SET = 'Subsequent relay claims require family to be set'
export const HARDWARE_ALREADY_VERIFIED = 'Hardware has already been verified'
export const SERIAL_NOT_REGISTERED = 'Serial has not been registered'
export const DUPLICATE_FINGERPRINT = 'Duplicate fingerprint'
export const CREDITS_MUST_BE_ARRAY =
  'Credits must be a valid array of address & fingerprint tuples'
export const REGISTRATION_CREDIT_NOT_FOUND = 'Registration credit not found'
export const HARDWARE_VERIFIED_MUST_BE_BOOLEAN_OR_UNDEFINED =
  'Argument hardwareVerified must be boolean or undefined'
export const RELAYS_MUST_BE_VALID_ARRAY =
  'Argument relays must be an array of (fingerprint, address, hardwareVerified)'
export const NICKNAME_MUST_BE_VALID =
  'Nickname must be no more than 20 alphanumeric characters'

export type RelayRegistryState = OwnableState & EvolvableState & {
  claimable: { [fingerprint in Fingerprint as string]: EvmAddress }
  verified: { [fingerprint in Fingerprint as string]: EvmAddress }
  registrationCredits: {
    [address in EvmAddress as string]: Fingerprint[]
  }
  blockedAddresses: EvmAddress[]
  families: { [fingerprint in Fingerprint as string]: Fingerprint[] }
  registrationCreditsRequired: boolean
  encryptionPublicKey: string
  verifiedHardware: { [fingerprint in Fingerprint as string]: 1 }
  familyRequired: boolean
  nicknames: { [fingerprint in Fingerprint as string]: string }
}

export interface AddClaimable extends ContractFunctionInput {
  function: 'addClaimable'
  fingerprint: Fingerprint
  address: EvmAddress
  hardwareVerified?: boolean
  nickname?: string
}

export interface AddClaimableBatched extends ContractFunctionInput {
  function: 'addClaimableBatched'
  relays: {
    fingerprint: Fingerprint
    address: EvmAddress
    hardwareVerified?: boolean
    nickname?: string
  }[]
}

export interface RemoveClaimable extends ContractFunctionInput {
  function: 'removeClaimable'
  fingerprint: Fingerprint
}

export interface IsClaimable extends ContractFunctionInput {
  function: 'isClaimable'
  fingerprint: Fingerprint
  address: EvmAddress
}

export interface Claimable extends ContractFunctionInput {
  function: 'claimable'
  address?: EvmAddress
}

export interface Claim extends ContractFunctionInput {
  function: 'claim'
  fingerprint: Fingerprint
}

export interface Renounce extends ContractFunctionInput {
  function: 'renounce'
  fingerprint: Fingerprint
}

export interface RemoveVerified extends ContractFunctionInput {
  function: 'removeVerified'
  fingerprint: Fingerprint
}

export interface Verified extends ContractFunctionInput {
  function: 'verified'
  address?: EvmAddress
}

export interface IsVerified extends ContractFunctionInput {
  function: 'isVerified'
  fingerprint: Fingerprint
}

export interface AddRegistrationCredits extends ContractFunctionInput {
  function: 'addRegistrationCredits'
  credits: { address: EvmAddress, fingerprint: Fingerprint }[]
}

export interface RemoveRegistrationCredits extends ContractFunctionInput {
  function: 'removeRegistrationCredits'
  credits: { address: EvmAddress, fingerprint: Fingerprint }[]
}

export interface BlockAddress extends ContractFunctionInput {
  function: 'blockAddress'
  address: EvmAddress
}

export interface UnblockAddress extends ContractFunctionInput {
  function: 'unblockAddress'
  address: EvmAddress
}

export interface SetFamilies extends ContractFunctionInput {
  function: 'setFamilies'
  families: {
    fingerprint: Fingerprint
    family: Fingerprint[]
  }[]
}

export interface ToggleRegistrationCreditRequirement
  extends ContractFunctionInput
{
  function: 'toggleRegistrationCreditRequirement'
  enabled: boolean
}

export interface SetEncryptionPublicKey extends ContractFunctionInput {
  function: 'setEncryptionPublicKey'
  encryptionPublicKey: PublicKey
}

export interface VerifySerials extends ContractFunctionInput {
  function: 'verifySerials'
  fingerprints: Fingerprint[]
}

export interface RemoveSerials extends ContractFunctionInput {
  function: 'removeSerials'
  fingerprints: Fingerprint[]
}

export interface GetVerifiedRelays extends ContractFunctionInput {
  function: 'getVerifiedRelays'
}

export interface ToggleFamilyRequirement extends ContractFunctionInput {
  function: 'toggleFamilyRequirement'
  enabled: boolean
}

export class RelayRegistryContract extends Evolvable(Object) {
  constructor(state: Partial<RelayRegistryState>) {
    if (!state.blockedAddresses) {
      state.blockedAddresses = []
    }

    if (!state.claimable) {
      state.claimable = {}
    }

    if (!state.families) {
      state.families = {}
    }

    if (!state.registrationCredits) {
      state.registrationCredits = {}
    }

    if (!state.verified) {
      state.verified = {}
    }

    if (!state.registrationCreditsRequired) {
      state.registrationCreditsRequired = false
    }

    if (!state.encryptionPublicKey) {
      state.encryptionPublicKey = ''
    }

    if (!state.verifiedHardware) {
      state.verifiedHardware = {}
    }

    if (!state.nicknames) {
      state.nicknames = {}
    }

    super(state)
  }

  private isFingerprintClaimable(
    state: RelayRegistryState,
    fingerprint: Fingerprint
  ): boolean {
    return Object.keys(state.claimable).includes(fingerprint)
  }

  private isFingerprintVerified(
    state: RelayRegistryState,
    fingerprint: Fingerprint
  ): boolean {
    return Object.keys(state.verified).includes(fingerprint)
  }

  @OnlyOwner
  addClaimable(
    state: RelayRegistryState,
    action: ContractInteraction<PartialFunctionInput<AddClaimable>>
  ) {
    const {
      input: { address, fingerprint, hardwareVerified, nickname }
    } = action

    assertValidFingerprint(fingerprint)
    assertValidEvmAddress(address)
    ContractAssert(
      !this.isFingerprintClaimable(state, fingerprint),
      FINGERPRINT_ALREADY_CLAIMABLE
    )
    ContractAssert(
      !this.isFingerprintVerified(state, fingerprint),
      FINGERPRINT_ALREADY_CLAIMED
    )
    ContractAssert(
      typeof hardwareVerified === 'boolean'
      || typeof hardwareVerified === 'undefined',
      HARDWARE_VERIFIED_MUST_BE_BOOLEAN_OR_UNDEFINED
    )

    if (hardwareVerified) {
      ContractAssert(
        !state.verifiedHardware[fingerprint],
        HARDWARE_ALREADY_VERIFIED
      )
      state.verifiedHardware[fingerprint] = 1
    }

    if (nickname) {
      ContractAssert(
        typeof nickname === 'string'
        && nickname.length > 0
        && nickname.length <= 20,
        NICKNAME_MUST_BE_VALID
      )
      state.nicknames[fingerprint] = nickname
    }

    state.claimable[fingerprint] = address

    return { state, result: true }
  }

  @OnlyOwner
  addClaimableBatched(
    state: RelayRegistryState,
    action: ContractInteraction<PartialFunctionInput<AddClaimableBatched>>
  ) {
    const { caller, interactionType, input: { relays } } = action

    ContractAssert(Array.isArray(relays), RELAYS_MUST_BE_VALID_ARRAY)
    ContractAssert(relays.length > 0, RELAYS_MUST_BE_VALID_ARRAY)
    
    for (let i = 0; i < relays.length; i++) {
      this.addClaimable(state, {
        caller,
        interactionType,
        input: {
          function: 'addClaimable',
          ...relays[i]
        }
      })
    }

    return { state, result: true }
  }

  @OnlyOwner
  removeClaimable(
    state: RelayRegistryState,
    action: ContractInteraction<PartialFunctionInput<AddClaimable>>
  ) {
    const { input: { fingerprint } } = action

    assertValidFingerprint(fingerprint)
    ContractAssert(
      !this.isFingerprintVerified(state, fingerprint),
      FINGERPRINT_ALREADY_CLAIMED
    )
    ContractAssert(
      this.isFingerprintClaimable(state, fingerprint),
      FINGERPRINT_NOT_CLAIMABLE
    )

    delete state.claimable[fingerprint]

    return { state, result: true }
  }

  claimable(
    state: RelayRegistryState,
    action: ContractInteraction<PartialFunctionInput<Claimable>>
  ) {
    const { input: { address } } = action

    if (address) {
      assertValidEvmAddress(address)

      return {
        state,
        result: Object
          .keys(state.claimable)
          .filter(fp => state.claimable[fp] === address)
      }
    }

    return { state, result: state.claimable }
  }

  isClaimable(
    state: RelayRegistryState,
    action: ContractInteraction<PartialFunctionInput<IsClaimable>>
  ) {
    const { input: { address, fingerprint } } = action
      
    assertValidFingerprint(fingerprint)
    assertValidEvmAddress(address)

    return {
      state,
      result: Object.keys(state.claimable).includes(fingerprint)
        && state.claimable[fingerprint] === address
    }
  }

  claim(
    state: RelayRegistryState,
    action: ContractInteraction<PartialFunctionInput<Claim>>
  ) {
    const { caller, input: { fingerprint } } = action

    assertValidFingerprint(fingerprint)
    ContractAssert(
      caller === state.claimable[fingerprint],
      FINGERPRINT_NOT_CLAIMABLE_BY_ADDRESS
    )
    ContractAssert(
      !state.blockedAddresses.includes(caller),
      ADDRESS_IS_BLOCKED
    )
    const hasVerifiedSerialProof = !!state.verifiedHardware[fingerprint]
    const hasRegistrationCredit =
      !!state.registrationCredits[caller]
        && state.registrationCredits[caller].includes(fingerprint)
    if (state.registrationCreditsRequired === true) {
      ContractAssert(
        hasRegistrationCredit || hasVerifiedSerialProof,
        REGISTRATION_CREDIT_REQUIRED
      )
    }

    if (state.familyRequired) {
      const verifiedFingerprintsBelongingToCaller = Object
        .keys(state.verified)
        .filter(fp => state.verified[fp] === caller)
      const claimingRelayFamily =
        (state.families[fingerprint] || []).slice(0)
      const claimingFamilyIncludesAllVerifiedRelays =
        verifiedFingerprintsBelongingToCaller
          .every(cf => claimingRelayFamily.includes(cf))
      ContractAssert(
        claimingFamilyIncludesAllVerifiedRelays,
        FAMILY_NOT_SET
      )
      for (let i = 0; i < verifiedFingerprintsBelongingToCaller.length; i++) {
        ContractAssert(
          state.families[verifiedFingerprintsBelongingToCaller[i]]
            .includes(fingerprint),
          FAMILY_NOT_SET
        )
      }
    }
    
    if (state.registrationCreditsRequired === true && hasRegistrationCredit) {
      const removeIdx = state.registrationCredits[caller].indexOf(fingerprint)
      state.registrationCredits[caller].splice(removeIdx, 1)
    }

    state.verified[fingerprint] = state.claimable[fingerprint]
    delete state.claimable[fingerprint]

    return { state, result: true }
  }

  renounce(
    state: RelayRegistryState,
    action: ContractInteraction<PartialFunctionInput<Renounce>>
  ) {
    const { caller, input: { fingerprint } } = action

    assertValidFingerprint(fingerprint)

    ContractAssert(
      caller === state.verified[fingerprint],
      FINGERPRINT_NOT_CLAIMED_BY_ADDRESS
    )

    delete state.verified[fingerprint]
    delete state.verifiedHardware[fingerprint]
    delete state.nicknames[fingerprint]

    return { state, result: true }
  }

  @OnlyOwner
  removeVerified(
    state: RelayRegistryState,
    action: ContractInteraction<PartialFunctionInput<RemoveVerified>>
  ) {
    const { input: { fingerprint } } = action

    assertValidFingerprint(fingerprint)

    delete state.verified[fingerprint]
    delete state.verifiedHardware[fingerprint]

    return { state, result: true }
  }

  verified(
    state: RelayRegistryState,
    action: ContractInteraction<PartialFunctionInput<Verified>>
  ) {
    const { input: { address } } = action

    if (address) {
      assertValidEvmAddress(address)

      return {
        state,
        result: Object
          .keys(state.verified)
          .filter(fp => state.verified[fp] === address)
      }
    }

    return { state, result: state.verified }
  }

  isVerified(
    state: RelayRegistryState,
    action: ContractInteraction<PartialFunctionInput<IsVerified>>
  ) {
    const { input: { fingerprint } } = action

    assertValidFingerprint(fingerprint)

    return {
      state,
      result: Object.keys(state.verified).includes(fingerprint)
    }
  }

  @OnlyOwner
  addRegistrationCredits(
    state: RelayRegistryState,
    action: ContractInteraction<PartialFunctionInput<AddRegistrationCredits>>
  ) {
    const { input: { credits } } = action

    ContractAssert(Array.isArray(credits), CREDITS_MUST_BE_ARRAY)

    for (let i = 0; i < credits.length; i++) {
      const { address, fingerprint } = credits[i]
      assertValidEvmAddress(address)
      assertValidFingerprint(fingerprint)
      if (!state.registrationCredits[address]) {
        state.registrationCredits[address] = []
      }
      ContractAssert(
        !state.registrationCredits[address].includes(fingerprint),
        DUPLICATE_FINGERPRINT
      )
      state.registrationCredits[address].push(fingerprint)
    }

    return { state, result: true }
  }

  @OnlyOwner
  removeRegistrationCredits(
    state: RelayRegistryState,
    action: ContractInteraction<PartialFunctionInput<RemoveRegistrationCredits>>
  ) {
    const { input: { credits } } = action

    ContractAssert(Array.isArray(credits), CREDITS_MUST_BE_ARRAY)

    for (let i = 0; i < credits.length; i++) {
      const { address, fingerprint } = credits[i]
      assertValidEvmAddress(address)
      assertValidFingerprint(fingerprint)
      if (!state.registrationCredits[address]) {
        state.registrationCredits[address] = []
      }
      const foundIdx = state.registrationCredits[address].indexOf(fingerprint)
      ContractAssert(foundIdx > -1, REGISTRATION_CREDIT_NOT_FOUND)

      state.registrationCredits[address].splice(foundIdx, 1)
    }

    return { state, result: true }


    return { state, result: true }
  }

  @OnlyOwner
  blockAddress(
    state: RelayRegistryState,
    action: ContractInteraction<PartialFunctionInput<BlockAddress>>
  ) {
    const { input: { address } } = action

    assertValidEvmAddress(address)
    ContractAssert(
      !state.blockedAddresses.includes(address),
      ADDRESS_ALREADY_BLOCKED
    )
    state.blockedAddresses.push(address)

    return { state, result: true }
  }

  @OnlyOwner
  unblockAddress(
    state: RelayRegistryState,
    action: ContractInteraction<PartialFunctionInput<UnblockAddress>>
  ) {
    const { input: { address } } = action

    assertValidEvmAddress(address)
    const blockedIndex = state.blockedAddresses.indexOf(address)
    ContractAssert(blockedIndex > -1, ADDRESS_NOT_BLOCKED)
    state.blockedAddresses.splice(blockedIndex, 1)

    return { state, result: true }
  }

  @OnlyOwner
  setFamilies(
    state: RelayRegistryState,
    action: ContractInteraction<PartialFunctionInput<SetFamilies>>
  ) {
    const { input: { families } } = action

    ContractAssert(Array.isArray(families), FAMILIES_REQUIRED)
    ContractAssert(families.length > 0, FAMILIES_REQUIRED)
    
    for (const { fingerprint, family } of families) {
      assertValidFingerprint(fingerprint)
      ContractAssert(Array.isArray(family), INVALID_FAMILY)
      for (const familyFingerprint of family) {
        assertValidFingerprint(familyFingerprint)
      }

      state.families[fingerprint] = family
    }    

    return { state, result: true }
  }

  @OnlyOwner
  toggleRegistrationCreditRequirement(
    state: RelayRegistryState,
    action: ContractInteraction<
      PartialFunctionInput<ToggleRegistrationCreditRequirement>
    >
  ) {
    const { input: { enabled } } = action

    ContractAssert(typeof enabled === 'boolean', ENABLED_REQUIRED)

    state.registrationCreditsRequired = enabled

    return { state, result: true }
  }

  @OnlyOwner
  setEncryptionPublicKey(
    state: RelayRegistryState,
    action: ContractInteraction<PartialFunctionInput<SetEncryptionPublicKey>>
  ) {
    const { input: { encryptionPublicKey } } = action

    assertValidPublicKey(encryptionPublicKey)

    state.encryptionPublicKey = encryptionPublicKey

    return { state, result: true }
  }

  @OnlyOwner
  verifySerials(
    state: RelayRegistryState,
    action: ContractInteraction<PartialFunctionInput<VerifySerials>>
  ) {
    const { input: { fingerprints } } = action

    ContractAssert(Array.isArray(fingerprints), FINGERPRINTS_MUST_BE_ARRAY)

    for (let i = 0; i < fingerprints.length; i++) {
      const fingerprint = fingerprints[i]
      assertValidFingerprint(fingerprint)
      ContractAssert(
        !state.verifiedHardware[fingerprint],
        HARDWARE_ALREADY_VERIFIED
      )
  
      state.verifiedHardware[fingerprint] = 1
    }

    return { state, result: true }
  }

  @OnlyOwner
  removeSerials(
    state: RelayRegistryState,
    action: ContractInteraction<PartialFunctionInput<RemoveSerials>>
  ) {
    const { input: { fingerprints } } = action

    ContractAssert(Array.isArray(fingerprints), FINGERPRINTS_MUST_BE_ARRAY)

    for (let i = 0; i < fingerprints.length; i++) {
      const fingerprint = fingerprints[i]
      assertValidFingerprint(fingerprint)
      ContractAssert(
        !!state.verifiedHardware[fingerprint],
        SERIAL_NOT_REGISTERED
      )

      delete state.verifiedHardware[fingerprint]
    }

    return { state, result: true }
  }

  getVerifiedRelays(
    state: RelayRegistryState,
    action: ContractInteraction<PartialFunctionInput<GetVerifiedRelays>>
  ) {
    const result: {
      verified: RelayRegistryState['verified']
      verifiedHardware: RelayRegistryState['verified']
    } = {
      verified: {},
      verifiedHardware: {}
    }

    const fingerprints = Object.keys(state.verified)
    for (let i = 0; i < fingerprints.length; i++) {
      const fingerprint = fingerprints[i]
      if (!!state.verifiedHardware[fingerprint]) {
        result.verifiedHardware[fingerprint] = state.verified[fingerprint]
      } else {
        result.verified[fingerprint] = state.verified[fingerprint]
      }
    }

    return { state, result }
  }

  @OnlyOwner
  toggleFamilyRequirement(
    state: RelayRegistryState,
    action: ContractInteraction<PartialFunctionInput<ToggleFamilyRequirement>>
  ) {
    const { input: { enabled } } = action

    ContractAssert(typeof enabled === 'boolean', ENABLED_REQUIRED)

    state.familyRequired = enabled

    return { state, result: true }
  }
}

export function handle(
  state: RelayRegistryState,
  action: ContractInteraction<any>
) {
  const contract = new RelayRegistryContract(state)

  switch (action.input.function) {
    case 'addClaimable':
      return contract.addClaimable(state, action)
    case 'addClaimableBatched':
      return contract.addClaimableBatched(state, action)
    case 'removeClaimable':
      return contract.removeClaimable(state, action)
    case 'claimable':
      return contract.claimable(state, action)
    case 'isClaimable':
      return contract.isClaimable(state, action)
    case 'claim':
      return contract.claim(state, action)
    case 'renounce':
      return contract.renounce(state, action)
    case 'removeVerified':
      return contract.removeVerified(state, action)
    case 'verified':
      return contract.verified(state, action)
    case 'isVerified':
      return contract.isVerified(state, action)
    case 'addRegistrationCredits':
      return contract.addRegistrationCredits(state, action)
    case 'removeRegistrationCredits':
      return contract.removeRegistrationCredits(state, action)
    case 'blockAddress':
      return contract.blockAddress(state, action)
    case 'unblockAddress':
      return contract.unblockAddress(state, action)
    case 'setFamilies':
      return contract.setFamilies(state, action)
    case 'toggleRegistrationCreditRequirement':
      return contract.toggleRegistrationCreditRequirement(state, action)
    case 'setEncryptionPublicKey':
      return contract.setEncryptionPublicKey(state, action)
    case 'verifySerials':
      return contract.verifySerials(state, action)
    case 'removeSerials':
      return contract.removeSerials(state, action)
    case 'getVerifiedRelays':
      return contract.getVerifiedRelays(state, action)
    case 'toggleFamilyRequirement':
      return contract.toggleFamilyRequirement(state, action)
    case 'evolve':
      return contract.evolve(
        state,
        action
      ) as HandlerResult<RelayRegistryState, any>
    default:
      throw new ContractError(INVALID_INPUT)
  }
}
