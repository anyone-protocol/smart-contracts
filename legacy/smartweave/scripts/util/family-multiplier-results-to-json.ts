import { readFileSync } from 'fs'

const resultsPath =
  `${__dirname}/../../test/e2e/data/results_family_multipliers.csv`
const resultsCSVBuffer = readFileSync(resultsPath)
const resultsCSV = resultsCSVBuffer.toString()
const results = resultsCSV.split('\r\n')

const rewards = []

let baseNetworkScore = 0
let baseActualDistributedTokens = 0

let networkScoreWithFamilyMultiplier = 0
let actualDistributedTokensWithFamilyMultiplier = 0

let hwBonusNetworkScore = 0
let hwBonusActualDistributedTokens = 0

let hwBonusNetworkScoreWithFamilyMultiplier = 0
let hwBonusActualDistributedTokensWithFamilyMultiplier = 0

let totalNetworkScore = 0
let totalActualDistributedTokens = 0
let totalActualDistributedTokensWithFamilyMultiplier = 0

for (let i = 1; i < results.length; i++) {
  const [
    r1,
    r2,
    address,
    baseScore,
    basePercentShare,
    baseReward,
    scoreWithFamilyMultiplier,
    percentShareWithFamilyMultiplier,
    baseRewardWithFamilyMultiplier,
    hwBonusScore,
    hwBonusPercentShare,
    hwBonusReward,
    hwBonusScoreWithFamilyMultiplier,
    hwBonusPercentShareWithFamilyMultiplier,
    hwBonusRewardWithFamilyMultiplier,
    totalReward,
    totalRewardWithFamilyMultiplier
  ] = results[i].split(',')

  baseNetworkScore += Number.parseInt(baseScore)
  networkScoreWithFamilyMultiplier += Number.parseInt(scoreWithFamilyMultiplier)
  baseActualDistributedTokens += Number.parseInt(baseReward)
  actualDistributedTokensWithFamilyMultiplier
    += Number.parseInt(baseRewardWithFamilyMultiplier)
  hwBonusNetworkScore += Number.parseInt(hwBonusScore)
  hwBonusNetworkScoreWithFamilyMultiplier
    += Number.parseInt(hwBonusScoreWithFamilyMultiplier)
  hwBonusActualDistributedTokensWithFamilyMultiplier
    += Number.parseInt(hwBonusRewardWithFamilyMultiplier)
  hwBonusActualDistributedTokens += Number.parseInt(hwBonusReward)
  
  totalNetworkScore +=
    Number.parseInt(baseScore) + Number.parseInt(hwBonusScore)
  totalActualDistributedTokens += Number.parseInt(totalReward)
  totalActualDistributedTokensWithFamilyMultiplier
    += Number.parseInt(totalRewardWithFamilyMultiplier)

  rewards.push({
    address,

    baseScore,
    basePercentShare,
    baseReward,
    scoreWithFamilyMultiplier,
    percentShareWithFamilyMultiplier,
    baseRewardWithFamilyMultiplier,

    hwBonusScore,
    hwBonusPercentShare,
    hwBonusReward,
    hwBonusScoreWithFamilyMultiplier,
    hwBonusPercentShareWithFamilyMultiplier,
    hwBonusRewardWithFamilyMultiplier,

    totalReward,
    totalRewardWithFamilyMultiplier
  })
}

const output = {
  baseNetworkScore: baseNetworkScore.toString(),
  networkScoreWithFamilyMultiplier: networkScoreWithFamilyMultiplier.toString(),
  baseActualDistributedTokens: baseActualDistributedTokens.toString(),
  actualDistributedTokensWithFamilyMultiplier:
    actualDistributedTokensWithFamilyMultiplier.toString(),
  hwBonusNetworkScore: hwBonusNetworkScore.toString(),
  hwBonusNetworkScoreWithFamilyMultiplier:
    hwBonusNetworkScoreWithFamilyMultiplier.toString(),
  hwBonusActualDistributedTokensWithFamilyMultiplier:
    hwBonusActualDistributedTokensWithFamilyMultiplier.toString(),
  hwBonusActualDistributedTokens: hwBonusActualDistributedTokens.toString(),
  totalNetworkScore: totalNetworkScore.toString(),
  totalActualDistributedTokens: totalActualDistributedTokens.toString(),
  totalActualDistributedTokensWithFamilyMultiplier:
    totalActualDistributedTokensWithFamilyMultiplier.toString(),
  rewards
}

console.log(JSON.stringify(output, undefined, 2))
