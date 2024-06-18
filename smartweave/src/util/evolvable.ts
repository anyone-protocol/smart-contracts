import {
  ContractInteraction,
  EvolveState,
  HandlerResult
} from 'warp-contracts'

import {
  Constructor,
  ContractAssert,
  OwnableState,
  PartialFunctionInput
} from './'
import { ContractFunctionInput } from '../common/types'

export const NEW_CONTRACT_SRC_REQUIRED = 'New Contract Src required'

export type EvolvableState = Partial<EvolveState> & OwnableState
export type EvolvableResult = any

export interface Evolve extends ContractFunctionInput {
  function: 'evolve'
  newContractSrc: string
}

export function Evolvable<Contract extends Constructor>(
  ContractBase: Contract
) {
  return class EvolvableContract extends ContractBase {
    evolve(
      state: EvolvableState,
      action: ContractInteraction<PartialFunctionInput<Evolve>>
    ) {
      const { input, caller } = action

      ContractAssert(
        state.owner === caller,
        'Only the owner can evolve the contract.'
      )

      ContractAssert(
        !!(input.newContractSrc || input.value),
        'New Contract Source ID is required to evolve.'
      )

      state.evolve = input.newContractSrc || input.value

      return { state, result: true }
    }
  }
}
