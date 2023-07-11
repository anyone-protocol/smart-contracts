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

export const INVALID_DISTRIBUTION_AMOUNT = 'Invalid distribution amount'
export const INVALID_TIMESTAMP = 'Invalid timestamp'
export const INVALID_SCORES = 'Invalid scores'
export const DUPLICATE_FINGERPRINT_SCORES = 'Duplicate fingerprint in scores'
export const NO_PENDING_SCORES = 'No pending scores to distribute from'
export const NO_DISTRIBUTION_TO_CANCEL = 'No distribution to cancel'

export type Score = {
  score: bigint
  address: string
  fingerprint: string
}

export type DistributionState = OwnableState & EvolvableState & {
  distributionAmount: bigint,
  pendingDistributions: {
    [timestamp: string]: Score[]
  },
  claimable: {
    [address: string]: bigint
  }
}

export interface SetDistributionAmount extends ContractFunctionInput {
  function: 'setDistributionAmount',
  distributionAmount: bigint
}

export interface AddScores extends ContractFunctionInput {
  function: 'addScores',
  timestamp: string,
  scores: Score[]
}

export interface Distribute extends ContractFunctionInput {
  function: 'distribute',
  timestamp: string
}

export interface CancelDistribution extends ContractFunctionInput {
  function: 'cancelDistribution',
  timestamp: string
}

export class DistributionContract extends Evolvable(Object) {
  private areValidScores(scores?: Score[]): scores is Score[] {
    return !!scores && scores.length > 0 && scores.every(
      ({ score, address, fingerprint }) => {
        try {
          const checksumAddress = SmartWeave.extensions.ethers.utils.getAddress(
            address
          )
          return typeof address === 'string'
            && address.length === 42
            && address === checksumAddress
            && typeof fingerprint === 'string'
            && fingerprint.length === 40
            && fingerprint.split('').every(c => UPPER_HEX_CHARS.includes(c))
            && typeof score === 'bigint'
            && score >= 0
        } catch (error) {
          return false
        }
      }
    )
  }

  private isValidTimestamp(timestamp: any): timestamp is string {
    return typeof timestamp === 'string'
      && timestamp.length >= 13
      && !Number.isNaN(Number.parseInt(timestamp || ''))
  }

  @OnlyOwner
  setDistributionAmount(
    state: DistributionState,
    action: ContractInteraction<PartialFunctionInput<SetDistributionAmount>>
  ): HandlerResult<DistributionState, any> {
    const { input: { distributionAmount } } = action

    ContractAssert(
      typeof distributionAmount === 'bigint' && distributionAmount > -1,
      INVALID_DISTRIBUTION_AMOUNT
    )

    state.distributionAmount = distributionAmount

    return { state, result: true }
  }

  @OnlyOwner
  addScores(
    state: DistributionState,
    action: ContractInteraction<PartialFunctionInput<AddScores>>
  ): HandlerResult<DistributionState, any> {
    const { timestamp, scores } = action.input

    ContractAssert(this.isValidTimestamp(timestamp), INVALID_TIMESTAMP)
    ContractAssert(this.areValidScores(scores), INVALID_SCORES)

    if (!state.pendingDistributions[timestamp]) {
      state.pendingDistributions[timestamp] = []
    }

    for (let i = 0; i < scores.length; i++) {
      const score = scores[i]

      ContractAssert(
        !state.pendingDistributions[timestamp].find(
          ({ fingerprint }) => fingerprint === score.fingerprint
        ),
        DUPLICATE_FINGERPRINT_SCORES
      )

      state.pendingDistributions[timestamp].push(score)
    }

    return { state, result: true }
  }

  @OnlyOwner
  distribute(
    state: DistributionState,
    action: ContractInteraction<PartialFunctionInput<Distribute>>
  ): HandlerResult<DistributionState, any> {
    const { timestamp } = action.input

    ContractAssert(this.isValidTimestamp(timestamp), INVALID_TIMESTAMP)
    ContractAssert(
      !!state.pendingDistributions[timestamp]
      && state.pendingDistributions[timestamp].length > 0,
      NO_PENDING_SCORES
    )

    const scores = state.pendingDistributions[timestamp]
    for (let i = 0; i < scores.length; i++) {
      const { score, address } = scores[i]
      if (state.claimable[address]) {
        state.claimable[address] += score
      } else {
        state.claimable[address] = score
      }
    }

    delete state.pendingDistributions[timestamp]

    return { state, result: true }
  }

  @OnlyOwner
  cancelDistribution(
    state: DistributionState,
    action: ContractInteraction<PartialFunctionInput<Distribute>>
  ): HandlerResult<DistributionState, any> {
    const { timestamp } = action.input

    ContractAssert(this.isValidTimestamp(timestamp), INVALID_TIMESTAMP)
    ContractAssert(
      !!state.pendingDistributions[timestamp],
      NO_DISTRIBUTION_TO_CANCEL
    )

    delete state.pendingDistributions[timestamp]

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
    case 'addScores':
      return contract.addScores(state, action)
    case 'distribute':
      return contract.distribute(state, action)
    case 'cancelDistribution':
      return contract.cancelDistribution(state, action)
    default:
      throw new ContractError(INVALID_INPUT)
  }
}
