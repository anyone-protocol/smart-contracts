import { readFileSync } from 'fs'

const resultsPath =
  `${__dirname}/../../test/e2e/data/results_quality_bonuses.csv`
const resultsCSVBuffer = readFileSync(resultsPath)
const resultsCSV = resultsCSVBuffer.toString()
const results = resultsCSV.split('\r\n')
results.shift() // NB: get rid of header in csv
const rewards = []

let baseNetworkScore = 0
let baseActualDistributedTokens = 0

let familyMultiplierNetworkScore = 0
let familyMultiplierActualDistributedTokens = 0

let qualityBonusNetworkScore = 0
let qualityBonusActualDistributedTokens = 0

let hwBonusNetworkScore = 0
let hwBonusActualDistributedTokens = 0

let hwBonusNetworkScoreWithFamilyMultiplier = 0
let hwBonusActualDistributedTokensWithFamilyMultiplier = 0

let totalNetworkScore = 0
let totalActualDistributedTokens = 0

for (const result of results) {
  const [
    r1,
    r2,
    address,

    baseScore,
    basePercentShare,
    baseReward,

    familyMultiplierScore,
    familyMultiplierPercentShare,
    familyMultiplierReward,

    qualityBonusScore,
    qualityBonusPercentShare,
    qualityBonusReward,

    qualityBonusScoreWithFamilyMultiplier,
    qualityBonusPercentShareWithFamilyMultiplier,
    qualityBonusRewardWithFamilyMultiplier,

    hwBonusScore,
    hwBonusPercentShare,
    hwBonusReward,

    hwBonusScoreWithFamilyMultiplier,
    hwBonusPercentShareWithFamilyMultiplier,
    hwBonusRewardWithFamilyMultiplier,

    totalReward,
    totalRewardWithFamilyMultiplier
  ] = result.split(',')

  baseNetworkScore += Number.parseInt(baseScore)
  baseActualDistributedTokens += Number.parseInt(baseReward)

  familyMultiplierNetworkScore += Number.parseInt(familyMultiplierScore)
  familyMultiplierActualDistributedTokens += Number.parseInt(familyMultiplierReward)

  qualityBonusNetworkScore += Number.parseInt(qualityBonusScore)
  qualityBonusActualDistributedTokens += Number.parseInt(qualityBonusReward)

  hwBonusNetworkScore += Number.parseInt(hwBonusScore)
  hwBonusActualDistributedTokens += Number.parseInt(hwBonusReward)

  hwBonusNetworkScoreWithFamilyMultiplier += Number.parseInt(hwBonusScoreWithFamilyMultiplier)
  hwBonusActualDistributedTokensWithFamilyMultiplier += Number.parseInt(hwBonusRewardWithFamilyMultiplier)

  totalNetworkScore +=
    Number.parseInt(baseScore)
    + Number.parseInt(hwBonusScoreWithFamilyMultiplier)
    + Number.parseInt(qualityBonusScore)
  totalActualDistributedTokens += Number.parseInt(totalReward)

  rewards.push({
    address,

    baseScore,
    basePercentShare,
    baseReward,

    familyMultiplierScore,
    familyMultiplierPercentShare,
    familyMultiplierReward,

    qualityBonusScore,
    qualityBonusPercentShare,
    qualityBonusReward,

    hwBonusScore,
    hwBonusPercentShare,
    hwBonusReward,

    hwBonusScoreWithFamilyMultiplier,
    hwBonusPercentShareWithFamilyMultiplier,
    hwBonusRewardWithFamilyMultiplier,

    totalReward
  })
}

const output = {
  baseNetworkScore: baseNetworkScore.toString(),
  baseActualDistributedTokens: baseActualDistributedTokens.toString(),

  familyMultiplierNetworkScore: familyMultiplierNetworkScore.toString(),
  familyMultiplierActualDistributedTokens:
    familyMultiplierActualDistributedTokens.toString(),

  qualityBonusNetworkScore: qualityBonusNetworkScore.toString(),
  qualityBonusActualDistributedTokens:
    qualityBonusActualDistributedTokens.toString(),

  hwBonusNetworkScore: hwBonusNetworkScore.toString(),
  hwBonusActualDistributedTokens: hwBonusActualDistributedTokens.toString(),

  hwBonusNetworkScoreWithFamilyMultiplier:
    hwBonusNetworkScoreWithFamilyMultiplier.toString(),
  hwBonusActualDistributedTokensWithFamilyMultiplier:
    hwBonusActualDistributedTokensWithFamilyMultiplier.toString(),

  totalNetworkScore: totalNetworkScore.toString(),
  totalActualDistributedTokens: totalActualDistributedTokens.toString(),

  rewards
}

console.log(JSON.stringify(output, undefined, 2))
