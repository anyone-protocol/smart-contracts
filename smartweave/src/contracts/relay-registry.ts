import {
  ContractError,
  ContractInteraction,
  HandlerResult
} from 'warp-contracts'

import {
  ContractAssert,
  ContractFunctionInput,
  OwnableState,
  PartialFunctionInput
} from '../util'

export const FINGERPRINT_REQUIRED = 'Fingerprint required'
export const INVALID_FINGERPRINT = 'Invalid fingerprint'
export const ADDRESS_REQUIRED = 'Address required'
export const INVALID_ADDRESS = 'Invalid address'
export const INVALID_INPUT = 'Invalid input'
export const NO_CLAIM_TO_VERIFY = 'No claim to verify'
export const UPPER_HEX_CHARS = '0123456789ABCDEF'

export type Fingerprint = string
export type EvmAddress = string

export type RelayRegistryState = OwnableState & {
  claims: { [address in EvmAddress as string]: Fingerprint[] }
  verified: { [fingerprint: Fingerprint]: EvmAddress }
}

export interface Register extends ContractFunctionInput {
  fingerprint: Fingerprint
}

export interface Verify extends ContractFunctionInput {
  fingerprint: Fingerprint
  address: EvmAddress
}



export class RelayRegistryContract {
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
    fingerprint?: string
  ): asserts fingerprint is Fingerprint {
    ContractAssert(!!fingerprint, ADDRESS_REQUIRED)
    ContractAssert(typeof fingerprint === 'string', INVALID_ADDRESS)
    ContractAssert(fingerprint.length === 42, INVALID_ADDRESS)
    ContractAssert(
      fingerprint
        .substring(2)
        .split('')
        .every(c => UPPER_HEX_CHARS.includes(c)),
        INVALID_ADDRESS
    )
  }

  register(
    state: RelayRegistryState,
    action: ContractInteraction<PartialFunctionInput<Register>>
  ): HandlerResult<RelayRegistryState, any> {
    const { fingerprint } = action.input

    this.assertValidFingerprint(fingerprint)

    if (!state.claims[action.caller]) {
      state.claims[action.caller] = [ fingerprint ]
    } else {
      state.claims[action.caller].push(fingerprint)
    }

    return { state, result: true }
  }

  verify(
    state: RelayRegistryState,
    action: ContractInteraction<PartialFunctionInput<Verify>>
  ): HandlerResult<RelayRegistryState, any> {
    const { fingerprint, address } = action.input

    this.assertValidFingerprint(fingerprint)
    this.assertValidEvmAddress(address)
    ContractAssert(!!state.claims[address], NO_CLAIM_TO_VERIFY)
    const claimIndex = state.claims[address].indexOf(fingerprint)
    ContractAssert(claimIndex >= 0, NO_CLAIM_TO_VERIFY)

    state.claims[address].splice(claimIndex, 1)
    state.verified[fingerprint] = address

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
    default:
      throw new ContractError(INVALID_INPUT)
  }
}
