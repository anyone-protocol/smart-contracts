import { ContractError } from 'warp-contracts'
import {
  ContractFunctionInput,
  EvmAddress,
  Fingerprint,
  PublicKey
} from '../common/types'
import { ContractAssert, SmartWeave } from './environment'
import {
  ADDRESS_REQUIRED,
  FINGERPRINT_REQUIRED,
  INVALID_ADDRESS,
  INVALID_FINGERPRINT,
  PUBLIC_KEY_REQUIRED
} from '../common/errors'

export * from './ownable'
export * from './environment'
export * from './evolvable'

export type PartialFunctionInput<T extends ContractFunctionInput> =
  Partial<T> & Pick<T, 'function'>

export interface Constructor<T = {}> {
  new (...args: any[]): T
}

export const INVALID_INPUT = 'Invalid input'
export const UPPER_HEX_CHARS = '0123456789ABCDEF'

export function assertValidFingerprint(
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

export function assertValidEvmAddress(
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

export function assertValidPublicKey(
  publicKey?: string
): asserts publicKey is PublicKey {
  try {
    ContractAssert(typeof publicKey === 'string', PUBLIC_KEY_REQUIRED)
    SmartWeave.extensions.ethers.utils.computeAddress(publicKey)
  } catch (error) {
    throw new ContractError(PUBLIC_KEY_REQUIRED)
  }
}
