import { ContractError, ContractInteraction } from 'warp-contracts'

import BigNumber from 'bignumber.js'

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
import {
  ADDRESS_REQUIRED,
  Claimable,
  EvmAddress,
  INVALID_ADDRESS,
  Fingerprint,
  assertValidEvmAddress,
  assertValidFingerprint
} from './relay-registry'

export const INVALID_DISTRIBUTION_AMOUNT = 'Invalid distribution amount'
export const INVALID_TIMESTAMP = 'Invalid timestamp'
export const INVALID_SCORES = 'Invalid scores'
export const DUPLICATE_FINGERPRINT_SCORES = 'Duplicate fingerprint in scores'
export const NO_PENDING_SCORES = 'No pending scores to distribute from'
export const NO_DISTRIBUTION_TO_CANCEL = 'No distribution to cancel'
export const CANNOT_BACKDATE_SCORES = 'Cannot backdate scores'
export const INVALID_MULTIPLIERS_INPUT = 'Invalid multipliers input'
export const INVALID_MULTIPLIER_VALUE = 'Invalid multiplier value'
export const INVALID_BONUS_AMOUNT = 'Invalid bonus amount'

export type Score = {
  score: string
  address: string
  fingerprint: string
}

export type DistributionState = OwnableState & EvolvableState & {
  tokensDistributedPerSecond: string
  pendingDistributions: {
    [timestamp: string]: {
      bonus?: string
      scores: Score[]
    }
  }
  claimable: {
    [address: string]: string
  }
  previousDistributions: {
    [timestamp: string]: {
      totalScore: string
      totalDistributed: string
      timeElapsed: string
      tokensDistributedPerSecond: string
      bonusTokens?: string
    }
  }
  multipliers: {
    [fingerprint: string]: string
  }
}

export interface SetTokenDistributionRate extends ContractFunctionInput {
  function: 'setTokenDistributionRate'
  tokensDistributedPerSecond: string
}

export interface AddScores extends ContractFunctionInput {
  function: 'addScores'
  timestamp: string
  scores: Score[]
}

export interface Distribute extends ContractFunctionInput {
  function: 'distribute'
  timestamp: string
}

export interface CancelDistribution extends ContractFunctionInput {
  function: 'cancelDistribution'
  timestamp: string
}

export interface SetMultipliers extends ContractFunctionInput {
  function: 'setMultipliers'
  multipliers: { [fingerprint: string]: string }
}

export interface SetDistributionBonus extends ContractFunctionInput {
  function: 'setDistributionBonus'
  timestamp: string
  bonus: string
}

export function isValidTimestamp(timestamp: any): timestamp is string {
  return typeof timestamp === 'string'
    && timestamp.length >= 13
    && !Number.isNaN(Number.parseInt(timestamp || ''))
}

export function areValidScores(scores?: Score[]): scores is Score[] {
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
          && typeof score === 'string'
          && BigNumber(score).gte(0)
      } catch (error) {
        return false
      }
    }
  )
}

export class DistributionContract extends Evolvable(Object) {
  constructor(state: Partial<DistributionState>) {
    if (!state.tokensDistributedPerSecond) {
      state.tokensDistributedPerSecond = '0'
    }

    if (!state.pendingDistributions) {
      state.pendingDistributions = {}
    }

    if (!state.claimable) {
      state.claimable = {}
    }

    if (!state.previousDistributions) {
      state.previousDistributions = {}
    }

    if (!state.multipliers) {
      state.multipliers = {}
    }

    super(state)
  }

  private getLatestDistribution(state: DistributionState): number | false {
    const timestamps = Object.keys(state.previousDistributions)
    if (timestamps.length < 1) { return false }

    let latestTimestamp = Number.parseInt(timestamps[0])
    for (let i = 0; i < timestamps.length; i++) {
      const timestamp = Number.parseInt(timestamps[i])
      if (latestTimestamp < timestamp) {
        latestTimestamp = timestamp
      }
    }
    
    return latestTimestamp
  }

  private isTimestampNotBackdated(
    state: DistributionState,
    timestamp: string
  ): boolean {
    const latestDistribution = this.getLatestDistribution(state)
    
    if (latestDistribution) {
      return Number.parseInt(timestamp) > latestDistribution
    }

    return true
  }

  private initializeNewDistribution(
    state: DistributionState,
    timestamp: string
  ) {
    state.pendingDistributions[timestamp] = { scores: [] }
  }

  @OnlyOwner
  setTokenDistributionRate(
    state: DistributionState,
    action: ContractInteraction<PartialFunctionInput<SetTokenDistributionRate>>
  ) {
    const { input: { tokensDistributedPerSecond } } = action

    ContractAssert(
      typeof tokensDistributedPerSecond === 'string'
        && BigNumber(tokensDistributedPerSecond).gte(0),
      INVALID_DISTRIBUTION_AMOUNT
    )

    state.tokensDistributedPerSecond = tokensDistributedPerSecond

    return { state, result: true }
  }

  @OnlyOwner
  addScores(
    state: DistributionState,
    action: ContractInteraction<PartialFunctionInput<AddScores>>
  ) {
    const { timestamp, scores } = action.input

    ContractAssert(isValidTimestamp(timestamp), INVALID_TIMESTAMP)
    ContractAssert(areValidScores(scores), INVALID_SCORES)
    ContractAssert(
      this.isTimestampNotBackdated(state, timestamp),
      CANNOT_BACKDATE_SCORES
    )

    if (!state.pendingDistributions[timestamp]) {
      this.initializeNewDistribution(state, timestamp)
    }

    for (let i = 0; i < scores.length; i++) {
      const score = scores[i]

      ContractAssert(
        !state.pendingDistributions[timestamp].scores.find(
          ({ fingerprint }) => fingerprint === score.fingerprint
        ),
        DUPLICATE_FINGERPRINT_SCORES
      )

      state.pendingDistributions[timestamp].scores.push(score)
    }

    return { state, result: true }
  }

  @OnlyOwner
  distribute(
    state: DistributionState,
    action: ContractInteraction<PartialFunctionInput<Distribute>>
  ) {
    const { timestamp } = action.input

    ContractAssert(isValidTimestamp(timestamp), INVALID_TIMESTAMP)
    ContractAssert(
      !!state.pendingDistributions[timestamp]
      && state.pendingDistributions[timestamp].scores.length > 0,
      NO_PENDING_SCORES
    )

    const lastDistribution = this.getLatestDistribution(state)
    let distributionAmount = BigNumber(state.tokensDistributedPerSecond)
    let totalDistributed = BigNumber(0)
    const { bonus, scores } = state.pendingDistributions[timestamp]
    const totalScore = scores.reduce<BigNumber>(
      (total, { fingerprint, score }) => total.plus(
        BigNumber(score).times(state.multipliers[fingerprint] || '1')
      ),
      BigNumber(0)
    )
    let timeElapsed = '0'
    if (!lastDistribution) {
      distributionAmount = BigNumber(0)
    } else {
      const elapsedSinceLastDistribution =
        Number.parseInt(timestamp) - lastDistribution
      timeElapsed = elapsedSinceLastDistribution.toString()
      distributionAmount = BigNumber(state.tokensDistributedPerSecond)
        .times(BigNumber(elapsedSinceLastDistribution))
        .dividedBy(1000)
        .plus(bonus || '0')

      for (let i = 0; i < scores.length; i++) {
        const { score, address, fingerprint } = scores[i]
        const claimable = BigNumber(score)
          .times(state.multipliers[fingerprint] || '1')
          .dividedBy(totalScore)
          .times(distributionAmount)
          .integerValue(BigNumber.ROUND_FLOOR)
        totalDistributed = totalDistributed.plus(claimable)
        const previouslyClaimable = state.claimable[address] || '0'
        state.claimable[address] = BigNumber(previouslyClaimable)
          .plus(claimable)
          .toString()
      }
    }

    state.previousDistributions[timestamp] = {
      totalScore: totalScore.toString(),
      timeElapsed,
      totalDistributed: totalDistributed.toString(),
      tokensDistributedPerSecond: state.tokensDistributedPerSecond
    }
    if (bonus) {
      state.previousDistributions[timestamp].bonusTokens = bonus
    }
    delete state.pendingDistributions[timestamp]

    return { state, result: true }
  }

  @OnlyOwner
  cancelDistribution(
    state: DistributionState,
    action: ContractInteraction<PartialFunctionInput<Distribute>>
  ) {
    const { timestamp } = action.input

    ContractAssert(isValidTimestamp(timestamp), INVALID_TIMESTAMP)
    ContractAssert(
      !!state.pendingDistributions[timestamp],
      NO_DISTRIBUTION_TO_CANCEL
    )

    delete state.pendingDistributions[timestamp]

    return { state, result: true }
  }

  claimable(
    state: DistributionState,
    action: ContractInteraction<PartialFunctionInput<Claimable>>
  ) {
    const { address } = action.input

    assertValidEvmAddress(address)

    return {
      state,
      result: state.claimable[address] || '0'
    }
  }

  @OnlyOwner
  setMultipliers(
    state: DistributionState,
    action: ContractInteraction<PartialFunctionInput<SetMultipliers>>
  ) {
    const { multipliers } = action.input

    ContractAssert(typeof multipliers === 'object', INVALID_MULTIPLIERS_INPUT)

    for (const fingerprint in multipliers) {
      const multiplier = multipliers[fingerprint]
      assertValidFingerprint(fingerprint)
      ContractAssert(
        !BigNumber(multiplier).isNaN(),
        INVALID_MULTIPLIER_VALUE
      )

      state.multipliers[fingerprint] = multiplier
    }

    return { state, result: true }
  }

  @OnlyOwner
  setDistributionBonus(
    state: DistributionState,
    action: ContractInteraction<PartialFunctionInput<SetMultipliers>>
  ) {
    const { timestamp, bonus } = action.input

    ContractAssert(isValidTimestamp(timestamp), INVALID_TIMESTAMP)
    ContractAssert(typeof bonus === 'string', INVALID_BONUS_AMOUNT)
    const bigNumberBonus = BigNumber(bonus)
    ContractAssert(!bigNumberBonus.isNaN(), INVALID_BONUS_AMOUNT)
    ContractAssert(bigNumberBonus.isPositive(), INVALID_BONUS_AMOUNT)
    ContractAssert(bigNumberBonus.isInteger(), INVALID_BONUS_AMOUNT)

    if (!state.pendingDistributions[timestamp]) {
      this.initializeNewDistribution(state, timestamp)
    }

    state.pendingDistributions[timestamp].bonus = bonus

    return { state, result: true }
  }
}

export function handle(
  state: DistributionState,
  action: ContractInteraction<any>
) {
  const contract = new DistributionContract(state)

  switch (action.input.function) {
    case 'setTokenDistributionRate':
      return contract.setTokenDistributionRate(state, action)
    case 'addScores':
      return contract.addScores(state, action)
    case 'distribute':
      return contract.distribute(state, action)
    case 'cancelDistribution':
      return contract.cancelDistribution(state, action)
    case 'claimable':
      return contract.claimable(state, action)
    case 'setMultipliers':
      return contract.setMultipliers(state, action)
    case 'setDistributionBonus':
      return contract.setDistributionBonus(state, action)
    default:
      throw new ContractError(INVALID_INPUT)
  }
}
