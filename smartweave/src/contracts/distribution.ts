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
  Claimable,
  EvmAddress,
  Fingerprint,
  assertValidEvmAddress,
  assertValidFingerprint,
  ENABLED_REQUIRED,
  FINGERPRINTS_MUST_BE_ARRAY
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
export const INVALID_LIMIT = 'Invalid limit - must be a positive integer'
export const VALID_BONUS_NAME_REQUIRED = 'Valid bonus name required'
export const FINGERPRINT_NOT_IN_BONUS = 'Fingerprint is not in bonus'

export type Score = {
  score: string
  address: EvmAddress
  fingerprint: Fingerprint
}

export type DistributionState = OwnableState & EvolvableState & {
  tokensDistributedPerSecond: string
  bonuses: {
    hardware: {
      enabled: boolean
      tokensDistributedPerSecond: string
      fingerprints: Fingerprint[]
    }
  }
  multipliers: {
    [fingerprint: Fingerprint]: string
  }
  pendingDistributions: {
    [timestamp: string]: { scores: Score[] }
  }
  claimable: {
    [address: EvmAddress]: string
  }
  previousDistributions: {
    [timestamp: string]: {
      totalScore: string
      totalDistributed: string
      timeElapsed: string
      tokensDistributedPerSecond: string
      bonusTokens?: string // TODO -> changes to bonuses object?
    }
  }
  previousDistributionsTrackingLimit: number
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

export interface SetHardwareBonusRate extends ContractFunctionInput {
  function: 'setHardwareBonusRate'
  tokensDistributedPerSecond: string
}

export interface ToggleHardwareBonus extends ContractFunctionInput {
  function: 'toggleHardwareBonus'
  enabled: boolean
}

export interface AddFingerprintsToBonus extends ContractFunctionInput {
  function: 'addFingerprintsToBonus'
  bonusName: string
  fingerprints: Fingerprint[]
}

export interface RemoveFingerprintsFromBonus extends ContractFunctionInput {
  function: 'removeFingerprintsFromBonus'
  bonusName: string
  fingerprints: Fingerprint[]
}

export interface SetPreviousDistributionTrackingLimit
  extends ContractFunctionInput
{
  function: 'setPreviousDistributionTrackingLimit'
  limit: number
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

    if (!state.previousDistributionsTrackingLimit) {
      state.previousDistributionsTrackingLimit = 10
    }

    if (!state.bonuses) {
      state.bonuses = {
        hardware: {
          enabled: false,
          tokensDistributedPerSecond: '0',
          fingerprints: []
        }
      }
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

  private finalizeDistribution(
    state: DistributionState,
    timestamp: string,
    totalScore: BigNumber,
    timeElapsed: string,
    totalDistributed: BigNumber
  ) {
    state.previousDistributions[timestamp] = {
      totalScore: totalScore.toString(),
      timeElapsed,
      totalDistributed: totalDistributed.toString(),
      tokensDistributedPerSecond: state.tokensDistributedPerSecond
    }
    // TODO -> bonus
    // if (bonus) {
    //   state.previousDistributions[timestamp].bonusTokens = bonus
    // }

    const previousDistributionTimestamps = Object
      .keys(state.previousDistributions)
      .reverse()
      .slice(state.previousDistributionsTrackingLimit)
    for (let i = 0; i < previousDistributionTimestamps.length; i++) {
      const timestampToRemove = previousDistributionTimestamps[i]
      delete state.previousDistributions[timestampToRemove]
    }

    delete state.pendingDistributions[timestamp]
  }

  private calculateEpochScores(
    state: DistributionState,
    timestamp: string
  ) {
    const { scores } = state.pendingDistributions[timestamp]
    const hwScores = scores.filter(
      ({ address }) => state.bonuses.hardware.fingerprints.includes(address)
    )
    const { baseNetworkScore, hwBonusNetworkScore } = scores.reduce(
      (totals, { fingerprint, score }) => {
        const scoreWithMultiplier = BigNumber(score)
          .times(state.multipliers[fingerprint] || '1')

        let hwScoreWithMultiplier = BigNumber(0)
        if (
          state.bonuses.hardware.enabled
          && state.bonuses.hardware.fingerprints.includes(fingerprint)
        ) {
          hwScoreWithMultiplier = scoreWithMultiplier
        }

        return {
          ...totals,
          baseNetworkScore: totals
            .baseNetworkScore
            .plus(scoreWithMultiplier),
          hwBonusNetworkScore: totals
            .hwBonusNetworkScore
            .plus(hwScoreWithMultiplier)
        }        
      },
      { baseNetworkScore: BigNumber(0), hwBonusNetworkScore: BigNumber(0) }
    )

    return { scores, hwScores, baseNetworkScore, hwBonusNetworkScore }
  }

  private calculateEpochTokens(
    state: DistributionState,
    epochLengthInMs: number,
    scores: Score[],
    baseNetworkScore: BigNumber,
    hwBonusNetworkScore: BigNumber
  ) {
    const baseTokensToDistribute = BigNumber(state.tokensDistributedPerSecond)
      .times(BigNumber(epochLengthInMs))
      .dividedBy(1000)

    const hwBonusTokensToDistribute =
      BigNumber(state.bonuses.hardware.tokensDistributedPerSecond)
        .times(BigNumber(epochLengthInMs))
        .dividedBy(1000)

    let baseActualDistributedTokens = BigNumber(0)
    let hwBonusActualDistributedTokens = BigNumber(0)
    
    for (let i = 0; i < scores.length; i++) {
      const { score, address, fingerprint } = scores[i]

      const baseRedeemableTokens = BigNumber(score)
        .times(state.multipliers[fingerprint] || '1')
        .dividedBy(baseNetworkScore)
        .times(baseTokensToDistribute)
        .integerValue(BigNumber.ROUND_FLOOR)

      baseActualDistributedTokens = baseActualDistributedTokens
        .plus(baseRedeemableTokens)

      let hwBonusRedeemableTokens = BigNumber(0)
      if (
        state.bonuses.hardware.enabled
        && state.bonuses.hardware.fingerprints.includes(fingerprint)
      ) {
        const baseRedeemableTokens = BigNumber(score)
          .times(state.multipliers[fingerprint] || '1')
          .dividedBy(hwBonusNetworkScore)
          .times(hwBonusTokensToDistribute)
          .integerValue(BigNumber.ROUND_FLOOR)
      }
      hwBonusActualDistributedTokens = hwBonusActualDistributedTokens
        .plus(hwBonusRedeemableTokens)
      
      const redeemableTokens = baseRedeemableTokens
        .plus(hwBonusRedeemableTokens)
      const previouslyRedeemableTokens = state.claimable[address] || '0'
      state.claimable[address] = BigNumber(previouslyRedeemableTokens)
        .plus(redeemableTokens)
        .toString()
    }

    const totalActualDistributedTokens = baseActualDistributedTokens
      .plus(hwBonusActualDistributedTokens)

    return {
      baseActualDistributedTokens,
      hwBonusActualDistributedTokens,
      totalActualDistributedTokens
    }
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
    const {
      scores,
      baseNetworkScore,
      hwBonusNetworkScore
    } = this.calculateEpochScores(state, timestamp)
    const epochLengthInMs = lastDistribution
      ? Number.parseInt(timestamp) - lastDistribution
      : 0

    let totalTokensDistributed = BigNumber(0)
    if (lastDistribution) {
      const {
        baseActualDistributedTokens,
        hwBonusActualDistributedTokens,
        totalActualDistributedTokens
      } = this.calculateEpochTokens(
        state,
        epochLengthInMs,
        scores,
        baseNetworkScore,
        hwBonusNetworkScore
      )
      totalTokensDistributed = totalActualDistributedTokens
      console.log('baseActualDistributedTokens', baseActualDistributedTokens.toString())
      console.log('hwBonusActualDistributedTokens', hwBonusActualDistributedTokens.toString())
      console.log('totalActualDistributedTokens', totalActualDistributedTokens.toString())
    }

    // Finalize Distribution
    this.finalizeDistribution(
      state,
      timestamp,
      baseNetworkScore,
      epochLengthInMs.toString(),
      totalTokensDistributed
    )

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
  setHardwareBonusRate(
    state: DistributionState,
    action: ContractInteraction<PartialFunctionInput<SetHardwareBonusRate>>
  ) {
    // const { timestamp, bonus } = action.input
    const { input: { tokensDistributedPerSecond } } = action

    ContractAssert(
      typeof tokensDistributedPerSecond === 'string'
        && BigNumber(tokensDistributedPerSecond).gte(0),
      INVALID_DISTRIBUTION_AMOUNT
    )

    state.bonuses.hardware.tokensDistributedPerSecond =
      tokensDistributedPerSecond

    return { state, result: true }
  }

  @OnlyOwner
  toggleHardwareBonus(
    state: DistributionState,
    action: ContractInteraction<PartialFunctionInput<ToggleHardwareBonus>>
  ) {
    const { input: { enabled } } = action

    ContractAssert(typeof enabled === 'boolean', ENABLED_REQUIRED)

    state.bonuses.hardware.enabled = enabled

    return { state, result: true }
  }

  @OnlyOwner
  setPreviousDistributionTrackingLimit(
    state: DistributionState,
    action: ContractInteraction<
      PartialFunctionInput<SetPreviousDistributionTrackingLimit>
    >
  ) {
    const { limit } = action.input

    ContractAssert(typeof limit === 'number', INVALID_LIMIT)
    const limitBigNumber = BigNumber(limit)
    ContractAssert(limitBigNumber.gt(0), INVALID_LIMIT)
    ContractAssert(limitBigNumber.isInteger(), INVALID_LIMIT)

    state.previousDistributionsTrackingLimit = limit

    return { state, result: true }
  }

  @OnlyOwner
  addFingerprintsToBonus(
    state: DistributionState,
    action: ContractInteraction<PartialFunctionInput<AddFingerprintsToBonus>>
  ) {
    const { input: { bonusName, fingerprints } } = action

    ContractAssert(typeof bonusName === 'string', VALID_BONUS_NAME_REQUIRED)
    ContractAssert(
      Object.keys(state.bonuses).includes(bonusName),
      VALID_BONUS_NAME_REQUIRED
    )
    ContractAssert(Array.isArray(fingerprints), FINGERPRINTS_MUST_BE_ARRAY)
    for (const fingerprint of fingerprints) {
      assertValidFingerprint(fingerprint)
    }

    state.bonuses[
      bonusName as keyof DistributionState['bonuses']
    ].fingerprints.push(...fingerprints)

    return { state, result: true }
  }

  @OnlyOwner
  removeFingerprintsFromBonus(
    state: DistributionState,
    action: ContractInteraction<
      PartialFunctionInput<RemoveFingerprintsFromBonus>
    >
  ) {
    const { input: { bonusName, fingerprints } } = action

    ContractAssert(typeof bonusName === 'string', VALID_BONUS_NAME_REQUIRED)
    ContractAssert(
      Object.keys(state.bonuses).includes(bonusName),
      VALID_BONUS_NAME_REQUIRED
    )
    ContractAssert(Array.isArray(fingerprints), FINGERPRINTS_MUST_BE_ARRAY)
    for (const fingerprint of fingerprints) {
      assertValidFingerprint(fingerprint)
      const fingerprintBonusIndex = state
        .bonuses[bonusName as keyof DistributionState['bonuses']]
        .fingerprints
        .indexOf(fingerprint)
      ContractAssert(fingerprintBonusIndex > -1, FINGERPRINT_NOT_IN_BONUS)
      state
        .bonuses[bonusName as keyof DistributionState['bonuses']]
        .fingerprints
        .splice(fingerprintBonusIndex, 1)
    }

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
    case 'setHardwareBonusRate':
      return contract.setHardwareBonusRate(state, action)
    case 'setPreviousDistributionTrackingLimit':
      return contract.setPreviousDistributionTrackingLimit(state, action)
    case 'toggleHardwareBonus':
      return contract.toggleHardwareBonus(state, action)
    case 'addFingerprintsToBonus':
      return contract.addFingerprintsToBonus(state, action)
    case 'removeFingerprintsFromBonus':
      return contract.removeFingerprintsFromBonus(state, action)
    default:
      throw new ContractError(INVALID_INPUT)
  }
}
