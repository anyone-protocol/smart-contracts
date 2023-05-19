import { ContractError, ContractInteraction, HandlerResult } from 'warp-contracts'

import {
  ContractAssert,
  ContractFunctionInput,
  Evolvable,
  EvolvableState,
  OnlyOwner,
  OwnableState,
  PartialFunctionInput,
  SmartWeave
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
// export const DUPLICATE_FINGERPRINT = 'Duplicate fingerprint'
// export const FINGERPRINT_ALREADY_VERIFIED = 'Fingerprint already verified'
// export const FINGERPRINT_NOT_VERIFIED = 'Fingerprint not verified'
// export const NOT_RELAY_OWNER = 'Not relay owner'
export const ADDRESS_REQUIRED = 'Address required'
export const INVALID_ADDRESS = 'Invalid address'
export const INVALID_INPUT = 'Invalid input'
// export const NO_CLAIM_TO_VERIFY = 'No claim to verify'
export const UPPER_HEX_CHARS = '0123456789ABCDEF'

export type Fingerprint = string
export type EvmAddress = string

export type RelayRegistryState = OwnableState & EvolvableState & {
  claimable: { [address in Fingerprint as string]: EvmAddress }
  verified: { [address in Fingerprint as string]: EvmAddress }
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
  ): HandlerResult<RelayRegistryState, any> {
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
  ): HandlerResult<RelayRegistryState, any> {
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
  ): HandlerResult<
    RelayRegistryState,
    RelayRegistryState['claimable'] | Fingerprint[]
  > {
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
  ): HandlerResult<RelayRegistryState, boolean> {
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
  ): HandlerResult<RelayRegistryState, any> {
    const { caller, input: { fingerprint } } = action

    this.assertValidFingerprint(fingerprint)

    ContractAssert(
      caller === state.claimable[fingerprint],
      FINGERPRINT_NOT_CLAIMABLE_BY_ADDRESS
    )

    state.verified[fingerprint] = state.claimable[fingerprint]
    delete state.claimable[fingerprint]

    return { state, result: true }
  }

  renounce(
    state: RelayRegistryState,
    action: ContractInteraction<PartialFunctionInput<Renounce>>
  ): HandlerResult<RelayRegistryState, any> {
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
  ): HandlerResult<RelayRegistryState, any> {
    const { input: { fingerprint } } = action

    this.assertValidFingerprint(fingerprint)

    delete state.verified[fingerprint]

    return { state, result: true }
  }

  verified(
    state: RelayRegistryState,
    action: ContractInteraction<PartialFunctionInput<Verified>>
  ): HandlerResult<
    RelayRegistryState,
    RelayRegistryState['verified'] | Fingerprint[]
  > {
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
  ): HandlerResult<RelayRegistryState, boolean> {
    const { input: { fingerprint } } = action

    this.assertValidFingerprint(fingerprint)

    return {
      state,
      result: Object.keys(state.verified).includes(fingerprint)
    }
  }
}

export default function handle(
  state: RelayRegistryState,
  action: ContractInteraction<any>
): HandlerResult<RelayRegistryState, any> {
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
    case 'evolve':
      return contract.evolve(
        state,
        action
      ) as HandlerResult<RelayRegistryState, any>
    default:
      throw new ContractError(INVALID_INPUT)
  }
}
