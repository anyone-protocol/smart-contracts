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
    // TODO -> assert not already verified
    return Object.keys(state.claimable).includes(fingerprint)
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

    const result = address
      ? Object
        .keys(state.claimable)
        .filter(fp => state.claimable[fp] === address)
      : state.claimable

    return { state, result }
  }

  isClaimable(
    state: RelayRegistryState,
    action: ContractInteraction<PartialFunctionInput<Claimable>>
  ): HandlerResult<RelayRegistryState, boolean> {
    const { input: { address, fingerprint } } = action

    const result = Object.keys(state.claimable).includes(fingerprint)
      && state.claimable[fingerprint] === address

    return { state, result }
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
    case 'evolve':
      return contract.evolve(
        state,
        action
      ) as HandlerResult<RelayRegistryState, any>
    default:
      throw new ContractError(INVALID_INPUT)
  }
}
