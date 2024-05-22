import { readFileSync } from 'fs'

const resultsPath = `${__dirname}/../../test/e2e/data/results.csv`
const resultsCSVBuffer = readFileSync(resultsPath)
const resultsCSV = resultsCSVBuffer.toString()
const results = resultsCSV.split('\r\n')

const rewards = []
let baseNetworkScore = 0
let baseActualDistributedTokens = 0
let hwBonusNetworkScore = 0
let hwBonusActualDistributedTokens = 0
let totalNetworkScore = 0
let totalActualDistributedTokens = 0
for (let i = 1; i < results.length; i++) {
  const [
    r1,
    r2,
    address,
    baseScore,
    basePercentShare,
    baseReward,
    hwBonusScore,
    hwBonusPercentShare,
    hwBonusReward,
    totalReward
  ] = results[i].split(',')

  baseNetworkScore += Number.parseInt(baseScore)
  baseActualDistributedTokens += Number.parseInt(baseReward)
  hwBonusNetworkScore += Number.parseInt(hwBonusScore)
  hwBonusActualDistributedTokens += Number.parseInt(hwBonusReward)
  totalNetworkScore +=
    Number.parseInt(baseScore) + Number.parseInt(hwBonusScore)
  totalActualDistributedTokens += Number.parseInt(totalReward)

  rewards.push({
    address,
    baseScore,
    basePercentShare,
    baseReward,
    hwBonusScore,
    hwBonusPercentShare,
    hwBonusReward,
    totalReward
  })
}

const output = {
  baseNetworkScore: baseNetworkScore.toString(),
  baseActualDistributedTokens: baseActualDistributedTokens.toString(),
  hwBonusNetworkScore: hwBonusNetworkScore.toString(),
  hwBonusActualDistributedTokens: hwBonusActualDistributedTokens.toString(),
  totalNetworkScore: totalNetworkScore.toString(),
  totalActualDistributedTokens: totalActualDistributedTokens.toString(),
  rewards
}

console.log(JSON.stringify(output, undefined, 2))
