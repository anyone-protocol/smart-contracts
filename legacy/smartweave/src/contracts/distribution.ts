import { ContractError, ContractInteraction } from 'warp-contracts'

import BigNumber from 'bignumber.js'

import {
  ContractAssert,
  Evolvable,
  EvolvableState,
  INVALID_INPUT,
  OnlyOwner,
  OwnableState,
  PartialFunctionInput,
  SmartWeave,
  UPPER_HEX_CHARS,
  assertValidEvmAddress,
  assertValidFingerprint
} from '../util'
import { ContractFunctionInput, EvmAddress, Fingerprint } from '../common/types'
import {
  DUPLICATE_FINGERPRINT,
  ENABLED_REQUIRED,
  FAMILIES_REQUIRED,
  FINGERPRINTS_MUST_BE_ARRAY,
  INVALID_FAMILY
} from '../common/errors'

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
export const INVALID_FAMILY_MULTIPLIER_RATE = 'Invalid family multiplier rate'
export const INVALID_QUALITY_BONUS_SETTINGS = 'Invalid quality bonus settings'
export const INVALID_UPTIMES = 'Invalid uptimes'

export type Score = {
  score: string
  address: EvmAddress
  fingerprint: Fingerprint
}

export type DistributionResult = {
  timeElapsed: string
  tokensDistributedPerSecond: string
  baseNetworkScore: string
  baseDistributedTokens: string
  bonuses: {
    hardware: {
      enabled: boolean
      tokensDistributedPerSecond: string
      networkScore: string
      distributedTokens: string
    }
    quality: {
      enabled: boolean
      tokensDistributedPerSecond: string
      settings: {
        uptime: {
          [days: number]: number
        }
      }
      uptime: {
        [fingerprint: Fingerprint]: number
      }
      networkScore: string
      distributedTokens: string
    }
  }
  multipliers: {
    family: {
      enabled: boolean
      familyMultiplierRate: string
    }
  }
  families: { [fingerprint in Fingerprint as string]: Fingerprint[] }
  totalTokensDistributedPerSecond: string
  totalNetworkScore: string
  totalDistributedTokens: string
  details: {
    [fingerprint: Fingerprint]: {
      address: EvmAddress
      score: string
      distributedTokens: string
      bonuses: {
        hardware: string
        quality: string
      }
      multipliers: {
        family: string
        region: string
      }
    }
  }
}

export type DistributionState = OwnableState & EvolvableState & {
  tokensDistributedPerSecond: string
  bonuses: {
    hardware: {
      enabled: boolean
      tokensDistributedPerSecond: string
      fingerprints: Fingerprint[]
    },
    quality: {
      enabled: boolean
      tokensDistributedPerSecond: string
      settings: {
        uptime: {
          [days: number]: number
        }
      }
      uptime: {
        [fingerprint: Fingerprint]: number
      }
    }
  }
  pendingDistributions: {
    [timestamp: string]: { scores: Score[] }
  }
  claimable: {
    [address: EvmAddress]: string
  }
  previousDistributions: {
    [timestamp: string]: DistributionResult
  }
  previousDistributionsTrackingLimit: number
  families: { [fingerprint in Fingerprint as string]: Fingerprint[] }
  multipliers: {
    family: {
      enabled: boolean
      familyMultiplierRate: string
    }
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

export interface SetHardwareBonusRate extends ContractFunctionInput {
  function: 'setHardwareBonusRate'
  tokensDistributedPerSecond: string
}

export interface SetQualityTierBonusRate extends ContractFunctionInput {
  function: 'setQualityTierBonusRate'
  tokensDistributedPerSecond: string
}

export interface ToggleHardwareBonus extends ContractFunctionInput {
  function: 'toggleHardwareBonus'
  enabled: boolean
}

export interface ToggleQualityTierBonus extends ContractFunctionInput {
  function: 'toggleQualityTierBonus'
  enabled: boolean
}

export interface SetQualityTierBonusSettings extends ContractFunctionInput {
  function: 'setQualityTierBonusSettings'
  settings: {
    uptime: {
      [days: number]: number
    }
  }
}

export interface SetQualityTierUptimes extends ContractFunctionInput {
  function: 'setQualityTierUptimes',
  uptimes: { [fingerprint: Fingerprint]: number }
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

export interface SetFamilyMultiplierRate extends ContractFunctionInput {
  function: 'setFamilyMultiplierRate'
  familyMultiplierRate: string
}

export interface SetFamilies extends ContractFunctionInput {
  function: 'setFamilies'
  families: {
    fingerprint: Fingerprint
    add?: Fingerprint[],
    remove?: Fingerprint[]
  }[]
}

export interface ToggleFamilyMultipliers extends ContractFunctionInput {
  function: 'toggleFamilyMultipliers'
  enabled: boolean
}

export interface SetPreviousDistributionTrackingLimit
  extends ContractFunctionInput
{
  function: 'setPreviousDistributionTrackingLimit'
  limit: number
}

export interface Claimable extends ContractFunctionInput {
  function: 'claimable'
  address?: EvmAddress
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
      state.multipliers = {
        family: {
          enabled: false,
          familyMultiplierRate: '0'
        }
      }
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
        },
        quality: {
          enabled: false,
          tokensDistributedPerSecond: '0',
          settings: {
            uptime: {}
          },
          uptime: {}
        }
      }
    }

    if (!state.families) {
      state.families = {}
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
    timeElapsed: string,
    baseNetworkScore: BigNumber,
    baseDistributedTokens: BigNumber,
    hwBonusNetworkScore: BigNumber,
    hwBonusDistributedTokens: BigNumber,
    qualityBonusNetworkScore: BigNumber,
    qualityBonusDistributedTokens: BigNumber,
    details: DistributionResult['details']
  ) {
    const totalTokensDistributedPerSecond =
      BigNumber(state.tokensDistributedPerSecond)
        .plus(BigNumber(state.bonuses.hardware.tokensDistributedPerSecond))
        .plus(BigNumber(state.bonuses.quality.tokensDistributedPerSecond))
        .toString()
    
    const totalNetworkScore = baseNetworkScore
      .plus(hwBonusNetworkScore)
      .toString()

    const totalDistributedTokens = baseDistributedTokens
      .plus(hwBonusDistributedTokens)
      .toString()

    state.previousDistributions[timestamp] = {
      timeElapsed,
      tokensDistributedPerSecond: state.tokensDistributedPerSecond,
      baseNetworkScore: baseNetworkScore.toString(),
      baseDistributedTokens: baseDistributedTokens.toString(),
      bonuses: {
        hardware: {
          enabled: state.bonuses.hardware.enabled,
          tokensDistributedPerSecond:
            state.bonuses.hardware.tokensDistributedPerSecond,
          networkScore: hwBonusNetworkScore.toString(),
          distributedTokens: hwBonusDistributedTokens.toString()
        },
        quality: {
          ...state.bonuses.quality,
          networkScore: qualityBonusNetworkScore.toString(),
          distributedTokens: qualityBonusDistributedTokens.toString()
        }
      },
      totalTokensDistributedPerSecond,
      totalNetworkScore,
      totalDistributedTokens,
      details,
      families: state.families,
      multipliers: {
        family: state.multipliers.family,

      }
    }

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
    const {
      baseNetworkScore,
      hwBonusNetworkScore,
      qualityBonusNetworkScore,
      qualityScores
    } = scores.reduce(
      (totals, { fingerprint, score, address }) => {
        let scoreWithMultipliers = BigNumber(score)
        if (
          state.multipliers.family.enabled
          && state.families[fingerprint]
          && state.families[fingerprint].length > 0
        ) {
          const familySize = state
            .families[fingerprint]
            .filter(f => f !== fingerprint)
            .length
          const multiplier = BigNumber(
              state.multipliers.family.familyMultiplierRate
            )
            .times(familySize)
            .plus(1)
          scoreWithMultipliers = BigNumber(score).times(multiplier)
        }

        let hwScoreWithMultipliers = BigNumber(0)
        if (
          state.bonuses.hardware.enabled
          && state.bonuses.hardware.fingerprints.includes(fingerprint)
        ) {
          hwScoreWithMultipliers = scoreWithMultipliers
        }

        let qualityScore = BigNumber(0)
        if (state.bonuses.quality.enabled) {
          const uptime = state.bonuses.quality.uptime[fingerprint] || 0
          const uptimeTierDayThresholds = Object
            .keys(state.bonuses.quality.settings.uptime)
            .map(d => Number.parseInt(d))
          for (const uptimeTierDayThreshold of uptimeTierDayThresholds) {
            if (uptime >= uptimeTierDayThreshold) {
              qualityScore = BigNumber(
                state.bonuses.quality.settings.uptime[uptimeTierDayThreshold]
              )
            } else {
              break
            }
          }

          totals.qualityScores[fingerprint] = qualityScore
        }

        return {
          ...totals,
          baseNetworkScore: totals
            .baseNetworkScore
            .plus(scoreWithMultipliers),
          hwBonusNetworkScore: totals
            .hwBonusNetworkScore
            .plus(hwScoreWithMultipliers),
          qualityBonusNetworkScore: totals
            .qualityBonusNetworkScore
            .plus(qualityScore)
        }
      },
      {
        baseNetworkScore: BigNumber(0),
        hwBonusNetworkScore: BigNumber(0),
        qualityBonusNetworkScore: BigNumber(0),
        qualityScores: {} as { [fingerprint: Fingerprint]: BigNumber }
      }
    )

    return {
      scores,
      qualityScores,

      baseNetworkScore,
      hwBonusNetworkScore,
      qualityBonusNetworkScore
    }
  }

  private calculateEpochTokens(
    state: DistributionState,
    epochLengthInMs: number,
    scores: Score[],
    baseNetworkScore: BigNumber,
    hwBonusNetworkScore: BigNumber,
    qualityScores: { [fingerprint: string]: BigNumber },
    qualityBonusNetworkScore: BigNumber
  ) {
    const baseTokensToDistribute = BigNumber(state.tokensDistributedPerSecond)
      .times(BigNumber(epochLengthInMs))
      .dividedBy(1000)

    const hwBonusTokensToDistribute =
      BigNumber(state.bonuses.hardware.tokensDistributedPerSecond)
        .times(BigNumber(epochLengthInMs))
        .dividedBy(1000)

    const qualityBonusTokensToDistribute =
      BigNumber(state.bonuses.quality.tokensDistributedPerSecond)
        .times(BigNumber(epochLengthInMs))
        .dividedBy(1000)

    let baseActualDistributedTokens = BigNumber(0)
    let hwBonusActualDistributedTokens = BigNumber(0)
    let qualityBonusActualDistributedTokens = BigNumber(0)
    const details: DistributionResult['details'] = {}
    for (let i = 0; i < scores.length; i++) {
      const { score, address, fingerprint } = scores[i]

      let familyMultiplier = BigNumber('1')
      if (
        state.multipliers.family.enabled
        && state.families[fingerprint]
        && state.families[fingerprint].length > 0
      ) {
        const familySize = state
          .families[fingerprint]
          .filter(f => f !== fingerprint)
          .length
        familyMultiplier = BigNumber(
          state.multipliers.family.familyMultiplierRate
        )
          .times(familySize)
          .plus(1)
      }

      const baseRedeemableTokens = baseNetworkScore.gt(0)
        ? BigNumber(score)
            .times(familyMultiplier)
            .dividedBy(baseNetworkScore)
            .times(baseTokensToDistribute)
            .integerValue(BigNumber.ROUND_FLOOR)
        : BigNumber(0)

      baseActualDistributedTokens = baseActualDistributedTokens
        .plus(baseRedeemableTokens)

      let hwBonusRedeemableTokens = BigNumber(0)
      if (
        state.bonuses.hardware.enabled
        && state.bonuses.hardware.fingerprints.includes(fingerprint)
        && hwBonusNetworkScore.gt(0)
      ) {
        hwBonusRedeemableTokens = BigNumber(score)
          .times(familyMultiplier)
          .dividedBy(hwBonusNetworkScore)
          .times(hwBonusTokensToDistribute)
          .integerValue(BigNumber.ROUND_FLOOR)
      }
      hwBonusActualDistributedTokens = hwBonusActualDistributedTokens
        .plus(hwBonusRedeemableTokens)

      let qualityBonusRedeemableTokens = BigNumber(0)
      if (state.bonuses.quality.enabled && qualityBonusNetworkScore.gt(0)) {
        qualityBonusRedeemableTokens = qualityScores[fingerprint]
          .dividedBy(qualityBonusNetworkScore)
          .times(qualityBonusTokensToDistribute)
          .integerValue(BigNumber.ROUND_FLOOR)
      }
      qualityBonusActualDistributedTokens = qualityBonusActualDistributedTokens
        .plus(qualityBonusRedeemableTokens)
      
      const redeemableTokens = baseRedeemableTokens
        .plus(hwBonusRedeemableTokens)
        .plus(qualityBonusRedeemableTokens)
      const previouslyRedeemableTokens = state.claimable[address] || '0'

      state.claimable[address] = BigNumber(previouslyRedeemableTokens)
        .plus(redeemableTokens)
        .toString()

      details[fingerprint] = {
        address,
        score,
        distributedTokens: redeemableTokens.toString(),
        bonuses: {
          hardware: hwBonusRedeemableTokens.toString(),
          quality: qualityBonusRedeemableTokens.toString()
        },
        multipliers: {
          family: familyMultiplier.toString(),
          region: '1'
        }
      }
    }

    return {
      baseActualDistributedTokens,
      hwBonusActualDistributedTokens,
      qualityBonusActualDistributedTokens,
      details
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
      qualityScores,
      baseNetworkScore,
      hwBonusNetworkScore,
      qualityBonusNetworkScore
    } = this.calculateEpochScores(state, timestamp)
    const epochLengthInMs = lastDistribution
      ? Number.parseInt(timestamp) - lastDistribution
      : 0

    ContractAssert(epochLengthInMs > 0, 'EPOCH LENGTH SHOULD NOT BE NEGATIVE')

    let distributionResult = {
      baseActualDistributedTokens: BigNumber(0),
      hwBonusActualDistributedTokens: BigNumber(0),
      qualityBonusActualDistributedTokens: BigNumber(0),
      details: {} as DistributionResult['details']
    }
    if (lastDistribution) {
      distributionResult = this.calculateEpochTokens(
        state,
        epochLengthInMs,
        scores,
        baseNetworkScore,
        hwBonusNetworkScore,
        qualityScores,
        qualityBonusNetworkScore
      )
    }

    this.finalizeDistribution(
      state,
      timestamp,
      epochLengthInMs.toString(),
      baseNetworkScore,
      distributionResult.baseActualDistributedTokens,
      hwBonusNetworkScore,
      distributionResult.hwBonusActualDistributedTokens,
      qualityBonusNetworkScore,
      distributionResult.qualityBonusActualDistributedTokens,
      distributionResult.details
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
  setHardwareBonusRate(
    state: DistributionState,
    action: ContractInteraction<PartialFunctionInput<SetHardwareBonusRate>>
  ) {
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
  setQualityTierBonusRate(
    state: DistributionState,
    action: ContractInteraction<PartialFunctionInput<SetQualityTierBonusRate>>
  ) {
    const { input: { tokensDistributedPerSecond } } = action

    ContractAssert(
      typeof tokensDistributedPerSecond === 'string'
        && BigNumber(tokensDistributedPerSecond).gte(0),
      INVALID_DISTRIBUTION_AMOUNT
    )

    state.bonuses.quality.tokensDistributedPerSecond =
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
  toggleQualityTierBonus(
    state: DistributionState,
    action: ContractInteraction<PartialFunctionInput<ToggleQualityTierBonus>>
  ) {
    const { input: { enabled } } = action

    ContractAssert(typeof enabled === 'boolean', ENABLED_REQUIRED)

    state.bonuses.quality.enabled = enabled

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

    if (bonusName === 'hardware') {
      state.bonuses.hardware.fingerprints.push(...fingerprints)
    }

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

    if (bonusName === 'hardware') {
      for (const fingerprint of fingerprints) {
        assertValidFingerprint(fingerprint)
        const fingerprintBonusIndex = state
          .bonuses.hardware
          .fingerprints
          .indexOf(fingerprint)
        ContractAssert(fingerprintBonusIndex > -1, FINGERPRINT_NOT_IN_BONUS)
        state
          .bonuses.hardware
          .fingerprints
          .splice(fingerprintBonusIndex, 1)
      }
    }

    return { state, result: true }
  }

  @OnlyOwner
  setFamilyMultiplierRate(
    state: DistributionState,
    action: ContractInteraction<PartialFunctionInput<SetFamilyMultiplierRate>>
  ) {
    const { input: { familyMultiplierRate } } = action

    ContractAssert(
      typeof familyMultiplierRate === 'string',
      INVALID_FAMILY_MULTIPLIER_RATE
    )
    const parsedFamilyMultiplierRate = Number.parseFloat(familyMultiplierRate)
    ContractAssert(
      parsedFamilyMultiplierRate >= 0,
      INVALID_FAMILY_MULTIPLIER_RATE
    )
    ContractAssert(
      Number.isFinite(parsedFamilyMultiplierRate),
      INVALID_FAMILY_MULTIPLIER_RATE
    )

    state.multipliers.family.familyMultiplierRate = familyMultiplierRate

    return { state, result: true }
  }

  @OnlyOwner
  toggleFamilyMultipliers(
    state: DistributionState,
    action: ContractInteraction<PartialFunctionInput<ToggleFamilyMultipliers>>
  ) {
    const { input: { enabled } } = action

    ContractAssert(typeof enabled === 'boolean', ENABLED_REQUIRED)

    state.multipliers.family.enabled = enabled

    return { state, result: true }
  }

  @OnlyOwner
  setFamilies(
    state: DistributionState,
    action: ContractInteraction<PartialFunctionInput<SetFamilies>>
  ) {
    const { input: { families } } = action

    ContractAssert(Array.isArray(families), FAMILIES_REQUIRED)
    ContractAssert(families.length > 0, FAMILIES_REQUIRED)
    
    for (const { fingerprint, add, remove } of families) {
      assertValidFingerprint(fingerprint)
      ContractAssert(!!add || !!remove, INVALID_FAMILY)

      if (!state.families[fingerprint]) {
        state.families[fingerprint] = []
      }

      if (add) {
        ContractAssert(Array.isArray(add), INVALID_FAMILY)
        for (const addFingerprint of add) {
          assertValidFingerprint(addFingerprint)
          ContractAssert(
            !state.families[fingerprint].includes(addFingerprint),
            DUPLICATE_FINGERPRINT
          )
          state.families[fingerprint].push(addFingerprint)
        }
      }

      if (remove) {
        ContractAssert(Array.isArray(remove), INVALID_FAMILY)
        for (const removeFingerprint of remove) {
          assertValidFingerprint(removeFingerprint)
          const indexToRemove = state
            .families[fingerprint]
            .indexOf(removeFingerprint)
          state.families[fingerprint].splice(indexToRemove, 1)
        }
      }
    }

    return { state, result: true }
  }

  @OnlyOwner
  setQualityTierBonusSettings(
    state: DistributionState,
    action: ContractInteraction<
      PartialFunctionInput<SetQualityTierBonusSettings>
    >
  ) {
    const { input: { settings } } = action

    ContractAssert(!!settings, INVALID_QUALITY_BONUS_SETTINGS)
    ContractAssert(
      typeof settings.uptime === 'object',
      INVALID_QUALITY_BONUS_SETTINGS
    )
    ContractAssert(
      Object
        .keys(settings.uptime)
        .every(k => !Number.isNaN(Number.parseInt(k))),
      INVALID_QUALITY_BONUS_SETTINGS
    )
    ContractAssert(
      Object
        .values(settings.uptime)
        .every((v: any) => !Number.isNaN(Number.parseInt(v)) && v > -1),
      INVALID_QUALITY_BONUS_SETTINGS
    )

    state.bonuses.quality.settings = settings

    return { state, result: true }
  }

  @OnlyOwner
  setQualityTierUptimes(
    state: DistributionState,
    action: ContractInteraction<PartialFunctionInput<SetQualityTierUptimes>>
  ) {
    const { input: { uptimes } } = action

    ContractAssert(!!uptimes, INVALID_UPTIMES)
    ContractAssert(typeof uptimes === 'object', INVALID_UPTIMES)
    const fingerprints = Object.keys(uptimes)
    for (const fingerprint of fingerprints) {
      assertValidFingerprint(fingerprint)
      const uptime = uptimes[fingerprint]
      ContractAssert(typeof uptime === 'number', INVALID_UPTIMES)
      ContractAssert(Number.isInteger(uptime), INVALID_UPTIMES)
      ContractAssert(uptime > -1, INVALID_UPTIMES)
    }

    state.bonuses.quality.uptime = uptimes

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
    case 'setFamilyMultiplierRate':
      return contract.setFamilyMultiplierRate(state, action)
    case 'toggleFamilyMultipliers':
      return contract.toggleFamilyMultipliers(state, action)
    case 'setFamilies':
      return contract.setFamilies(state, action)
    case 'setQualityTierBonusRate':
      return contract.setQualityTierBonusRate(state, action)
    case 'toggleQualityTierBonus':
      return contract.toggleQualityTierBonus(state, action)
    case 'setQualityTierBonusSettings':
      return contract.setQualityTierBonusSettings(state, action)
    case 'setQualityTierUptimes':
      return contract.setQualityTierUptimes(state, action)
    default:
      throw new ContractError(INVALID_INPUT)
  }
}
