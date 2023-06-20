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
  PartialFunctionInput
} from '../util'

export const INVALID_DISTRIBUTION_AMOUNT = 'Invalid distribution amount'

export type DistributionState = OwnableState & EvolvableState & {
  distributionAmount: number
}

export interface SetDistributionAmount extends ContractFunctionInput {
  function: 'setDistributionAmount',
  distributionAmount: number
}

export class DistributionContract extends Evolvable(Object) {
  @OnlyOwner
  setDistributionAmount(
    state: DistributionState,
    action: ContractInteraction<PartialFunctionInput<SetDistributionAmount>>
  ): HandlerResult<DistributionState, any> {
    const { input: { distributionAmount } } = action

    ContractAssert(
      !!distributionAmount && distributionAmount > -1,
      INVALID_DISTRIBUTION_AMOUNT
    )

    state.distributionAmount = distributionAmount

    return { state, result: true }
  }
}

export default function handle(
  state: DistributionState,
  action: ContractInteraction<any>
): HandlerResult<DistributionState, any> {
  const contract = new DistributionContract()

  switch (action.input.function) {
    case 'setDistributionAmount':
      return contract.setDistributionAmount(state, action)
    default:
      throw new ContractError(INVALID_INPUT)
  }
}
