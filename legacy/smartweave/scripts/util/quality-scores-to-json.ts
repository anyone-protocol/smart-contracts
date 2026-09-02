import { readFileSync } from 'fs'

const scoresPath =
  `${__dirname}/../../test/e2e/data/scores_quality_bonuses.csv`
const scoresCSVBuffer = readFileSync(scoresPath)
const scoresCSV = scoresCSVBuffer.toString()
const scores = scoresCSV.split('\r\n')
scores.shift() // NB: get rid of header in csv

type ScoresJsonOutput = {
  address: string
  score: string
  fingerprint: string
  hardware: boolean
  hwScore: string
  familyMultiplier: string,
  familySize: string,
  scoreWithFamilyMultiplier: string,
  hwScoreWithFamilyMultiplier: string,
  family?: string[],
  uptime: string,
  uptimeScore: string,
  uptimeScoreWithFamilyMultiplier: string
}

const output: ScoresJsonOutput[] = []

for (const scoreData of scores) {
  const [
    r1,
    r2,
    fingerprint,
    address,
    score,
    isHardware,
    hwScore,
    familyMultiplier,
    familySize,
    uptime,
    uptimeScore,
    uptimeScoreWithFamilyMultiplier,
    scoreWithFamilyMultiplier,
    hwScoreWithFamilyMultiplier,
    family
  ] = scoreData.split(',')

  const parsedFamily = family.length > 0 ? family.split((' | ')) : []

  const anOutput: ScoresJsonOutput = {
    address,
    fingerprint,
    score,
    hardware: isHardware === 'Y',
    hwScore,
    familyMultiplier,
    familySize,
    scoreWithFamilyMultiplier,
    hwScoreWithFamilyMultiplier,
    uptime,
    uptimeScore,
    uptimeScoreWithFamilyMultiplier
  }

  if (parsedFamily.length > 0) {
    anOutput.family = parsedFamily
  }

  output.push(anOutput)
}

console.log(JSON.stringify(output, undefined, 2))
