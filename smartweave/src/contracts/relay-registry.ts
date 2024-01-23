import {
  ContractError,
  ContractInteraction,
  HandlerResult
} from 'warp-contracts'

import {
  ContractAssert,
  ContractFunctionInput,
  Evolvable,
  EvolvableState,
  INVALID_INPUT,
  OnlyOwner,
  OwnableState,
  PartialFunctionInput,
  SmartWeave,
  UPPER_HEX_CHARS
} from '../util'

export const FINGERPRINT_REQUIRED = 'Fingerprint required'
export const INVALID_FINGERPRINT = 'Invalid fingerprint'
export const FINGERPRINT_ALREADY_CLAIMABLE = 'Fingerprint already claimable'
export const FINGERPRINT_NOT_CLAIMABLE = 'Fingerprint not claimable'
export const FINGERPRINT_NOT_CLAIMABLE_BY_ADDRESS =
  'Fingerprint not claimable by this address'
export const FINGERPRINT_ALREADY_CLAIMED = 'Fingerprint already claimed'
export const FINGERPRINT_NOT_CLAIMED_BY_ADDRESS =
  'Fingerprint not claimed by address'
export const ADDRESS_REQUIRED = 'Address required'
export const INVALID_ADDRESS = 'Invalid address'
export const REGISTRATION_CREDIT_REQUIRED =
  'A Registration Credit is required to claim a fingerprint'

export type Fingerprint = string
export type EvmAddress = string

export type RelayRegistryState = OwnableState & EvolvableState & {
  claimable: { [fingerprint in Fingerprint as string]: EvmAddress }
  verified: { [fingerprint in Fingerprint as string]: EvmAddress }
  registrationCredits: { [address in EvmAddress as string]: number }
  blockedAddresses: EvmAddress[]
}

export interface AddClaimable extends ContractFunctionInput {
  function: 'addClaimable'
  fingerprint: Fingerprint
  address: EvmAddress
}

export interface RemoveClaimable extends ContractFunctionInput {
  function: 'removeClaimable'
  fingerprint: Fingerprint
}

export interface Claimable extends ContractFunctionInput {
  function: 'claimable'
  address?: EvmAddress
}

export interface IsClaimable extends ContractFunctionInput {
  function: 'isClaimable'
  fingerprint: Fingerprint
  address: EvmAddress
}

export interface Claim extends ContractFunctionInput {
  function: 'claim'
  fingerprint: Fingerprint
}

export interface Renounce extends ContractFunctionInput {
  function: 'renounce',
  fingerprint: Fingerprint
}

export interface RemoveVerified extends ContractFunctionInput {
  function: 'removeVerified',
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

export interface AddRegistrationCredit extends ContractFunctionInput {
  function: 'addRegistrationCredit'
  address: EvmAddress
}

export interface BlockAddress extends ContractFunctionInput {
  function: 'blockAddress',
  address: EvmAddress
}

export class RelayRegistryContract extends Evolvable(Object) {
  private assertValidFingerprint(
    fingerprint?: string
  ): asserts fingerprint is Fingerprint {
    ContractAssert(!!fingerprint, FINGERPRINT_REQUIRED)
    ContractAssert(typeof fingerprint === 'string', INVALID_FINGERPRINT)
    ContractAssert(fingerprint.length === 40, INVALID_FINGERPRINT)
    ContractAssert(
      fingerprint.split('').every(c => UPPER_HEX_CHARS.includes(c)),
      INVALID_FINGERPRINT
    )
  }

  private assertValidEvmAddress(
    address?: string
  ): asserts address is EvmAddress {
    ContractAssert(!!address, ADDRESS_REQUIRED)
    ContractAssert(typeof address === 'string', INVALID_ADDRESS)
    ContractAssert(address.length === 42, INVALID_ADDRESS)
    
    try {
      const checksumAddress = SmartWeave.extensions.ethers.utils.getAddress(
        address
      )
      ContractAssert(address === checksumAddress, INVALID_ADDRESS)
    } catch (error) {
      throw new ContractError(INVALID_ADDRESS)
    }
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
    const { input: { address, fingerprint } } = action

    this.assertValidFingerprint(fingerprint)
    this.assertValidEvmAddress(address)
    ContractAssert(
      !this.isFingerprintClaimable(state, fingerprint),
      FINGERPRINT_ALREADY_CLAIMABLE
    )
    ContractAssert(
      !this.isFingerprintVerified(state, fingerprint),
      FINGERPRINT_ALREADY_CLAIMED
    )
    
    state.claimable[fingerprint] = address

    return { state, result: true }
  }

  @OnlyOwner
  removeClaimable(
    state: RelayRegistryState,
    action: ContractInteraction<PartialFunctionInput<AddClaimable>>
  ) {
    const { input: { fingerprint } } = action

    this.assertValidFingerprint(fingerprint)
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
      this.assertValidEvmAddress(address)

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
      
    this.assertValidFingerprint(fingerprint)
    this.assertValidEvmAddress(address)

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

    this.assertValidFingerprint(fingerprint)

    ContractAssert(
      caller === state.claimable[fingerprint],
      FINGERPRINT_NOT_CLAIMABLE_BY_ADDRESS
    )
    ContractAssert(
      !!state.registrationCredits[caller],
      REGISTRATION_CREDIT_REQUIRED
    )
    
    state.registrationCredits[caller] = state.registrationCredits[caller] - 1
    state.verified[fingerprint] = state.claimable[fingerprint]
    delete state.claimable[fingerprint]

    return { state, result: true }
  }

  renounce(
    state: RelayRegistryState,
    action: ContractInteraction<PartialFunctionInput<Renounce>>
  ) {
    const { caller, input: { fingerprint } } = action

    this.assertValidFingerprint(fingerprint)

    ContractAssert(
      caller === state.verified[fingerprint],
      FINGERPRINT_NOT_CLAIMED_BY_ADDRESS
    )

    delete state.verified[fingerprint]

    return { state, result: true }
  }

  @OnlyOwner
  removeVerified(
    state: RelayRegistryState,
    action: ContractInteraction<PartialFunctionInput<RemoveVerified>>
  ) {
    const { input: { fingerprint } } = action

    this.assertValidFingerprint(fingerprint)

    delete state.verified[fingerprint]

    return { state, result: true }
  }

  verified(
    state: RelayRegistryState,
    action: ContractInteraction<PartialFunctionInput<Verified>>
  ) {
    const { input: { address } } = action

    if (address) {
      this.assertValidEvmAddress(address)

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

    this.assertValidFingerprint(fingerprint)

    return {
      state,
      result: Object.keys(state.verified).includes(fingerprint)
    }
  }

  @OnlyOwner
  addRegistrationCredit(
    state: RelayRegistryState,
    action: ContractInteraction<PartialFunctionInput<AddRegistrationCredit>>
  ) {
    const { input: { address } } = action

    this.assertValidEvmAddress(address)
    
    state.registrationCredits[address] =
      (state.registrationCredits[address] || 0) + 1

    return { state, result: true }
  }

  @OnlyOwner
  blockAddress(
    state: RelayRegistryState,
    action: ContractInteraction<PartialFunctionInput<BlockAddress>>
  ) {
    const { input: { address } } = action

    // this.assertValidEvmAddress(address)
    state.blockedAddresses.push(address!)

    return { state, result: true }
  }
}

export function handle(
  state: RelayRegistryState,
  action: ContractInteraction<any>
) {
  const contract = new RelayRegistryContract()

  switch (action.input.function) {
    case 'addClaimable':
      return contract.addClaimable(state, action)
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
    case 'addRegistrationCredit':
      return contract.addRegistrationCredit(state, action)
    case 'blockAddress':
      return contract.blockAddress(state, action)
    case 'evolve':
      return contract.evolve(
        state,
        action
      ) as HandlerResult<RelayRegistryState, any>
    default:
      throw new ContractError(INVALID_INPUT)
  }
}
