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
  OnlyOwner,
  OwnableState,
  PartialFunctionInput
} from '../util'

export const FINGERPRINT_REQUIRED = 'Fingerprint required'
export const INVALID_FINGERPRINT = 'Invalid fingerprint'
export const DUPLICATE_FINGERPRINT = 'Duplicate fingerprint'
export const FINGERPRINT_ALREADY_VERIFIED = 'Fingerprint already verified'
export const FINGERPRINT_NOT_VERIFIED = 'Fingerprint not verified'
export const NOT_RELAY_OWNER = 'Not relay owner'
export const ADDRESS_REQUIRED = 'Address required'
export const INVALID_ADDRESS = 'Invalid address'
export const INVALID_INPUT = 'Invalid input'
export const NO_CLAIM_TO_VERIFY = 'No claim to verify'
export const UPPER_HEX_CHARS = '0123456789ABCDEF'

export type Fingerprint = string
export type EvmAddress = string

export type RelayRegistryState = OwnableState & EvolvableState & {
  claims: { [address in EvmAddress as string]: Fingerprint[] }
  verified: { [fingerprint: Fingerprint]: EvmAddress }
}

export interface Register extends ContractFunctionInput {
  function: 'register'
  fingerprint: Fingerprint
}

export interface Verify extends ContractFunctionInput {
  function: 'verify'
  fingerprint: Fingerprint
  address: EvmAddress
}

export interface Unregister extends ContractFunctionInput {
  function: 'unregister'
  fingerprint: Fingerprint
}

export interface RemoveStale extends ContractFunctionInput {
  function: 'remove-stale'
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
    ContractAssert(
      address
        .substring(2)
        .split('')
        .every(c => UPPER_HEX_CHARS.includes(c)),
        INVALID_ADDRESS
    )
  }

  private assertNotAlreadyVerified(
    state: RelayRegistryState,
    fingerprint: Fingerprint
  ) {
    ContractAssert(
      !Object.keys(state.verified).includes(fingerprint),
      FINGERPRINT_ALREADY_VERIFIED
    )
  }

  private cleanupClaims(
    state: RelayRegistryState,
    cleanupFingerprint: Fingerprint
  ) {
    for (const address in state.claims) {
      const claimIndex = state.claims[address].indexOf(cleanupFingerprint)
      state.claims[address].splice(claimIndex, 1)
    }
  }

  register(
    state: RelayRegistryState,
    action: ContractInteraction<PartialFunctionInput<Register>>
  ): HandlerResult<RelayRegistryState, any> {
    const { caller, input: { fingerprint } } = action

    this.assertValidFingerprint(fingerprint)
    this.assertNotAlreadyVerified(state, fingerprint)

    if (!state.claims[caller]) {
      state.claims[caller] = [ fingerprint ]
    } else {
      const alreadyClaimed = state.claims[caller].includes(fingerprint)

      if (!alreadyClaimed) {
        state.claims[caller].push(fingerprint)
      } else {
        throw new ContractError(DUPLICATE_FINGERPRINT)
      }
    }

    return { state, result: true }
  }

  @OnlyOwner
  verify(
    state: RelayRegistryState,
    action: ContractInteraction<PartialFunctionInput<Verify>>
  ): HandlerResult<RelayRegistryState, any> {
    const { fingerprint, address } = action.input
    
    this.assertValidFingerprint(fingerprint)
    this.assertValidEvmAddress(address)
    ContractAssert(!!state.claims[address], NO_CLAIM_TO_VERIFY)
    ContractAssert(
      state.claims[address].includes(fingerprint),
      NO_CLAIM_TO_VERIFY
    )

    this.cleanupClaims(state, fingerprint)
    state.verified[fingerprint] = address

    return { state, result: true }
  }

  unregister(
    state: RelayRegistryState,
    action: ContractInteraction<PartialFunctionInput<Unregister>>
  ): HandlerResult<RelayRegistryState, any> {
    const { caller, input: { fingerprint } } = action

    this.assertValidFingerprint(fingerprint)
    ContractAssert(caller === state.verified[fingerprint], NOT_RELAY_OWNER)

    delete state.verified[fingerprint]

    return { state, result: true }
  }

  @OnlyOwner
  removeStale(
    state: RelayRegistryState,
    action: ContractInteraction<PartialFunctionInput<RemoveStale>>
  ): HandlerResult<RelayRegistryState, any> {
    const { fingerprint } = action.input

    this.assertValidFingerprint(fingerprint)
    ContractAssert(!!state.verified[fingerprint], FINGERPRINT_NOT_VERIFIED)

    delete state.verified[fingerprint]

    return { state, result: true }
  }
}

export default function handle(
  state: RelayRegistryState,
  action: ContractInteraction<any>
): HandlerResult<RelayRegistryState, any> {
  const contract = new RelayRegistryContract()

  switch (action.input.function) {
    case 'register':
      return contract.register(state, action)
    case 'verify':
      return contract.verify(state, action)
    case 'unregister':
      return contract.unregister(state, action)
    case 'remove-stale':
      return contract.removeStale(state, action)
    case 'evolve':
      return contract.evolve(
        state,
        action
      ) as HandlerResult<RelayRegistryState, any>
    default:
      throw new ContractError(INVALID_INPUT)
  }
}
