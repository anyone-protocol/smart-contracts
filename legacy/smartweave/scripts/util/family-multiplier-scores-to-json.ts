import { readFileSync } from 'fs'

const scoresPath =
  `${__dirname}/../../test/e2e/data/scores_family_multipliers.csv`
const scoresCSVBuffer = readFileSync(scoresPath)
const scoresCSV = scoresCSVBuffer.toString()
const scores = scoresCSV.split('\r\n')

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
  family?: string[]
}

const output: ScoresJsonOutput[] = []

for (let i = 1; i < scores.length; i++) {
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
    scoreWithFamilyMultiplier,
    hwScoreWithFamilyMultiplier,
    family
  ] = scores[i].split(',')

  const parsedFamily = family.length > 0 ? family.split(' | ') : []

  const anOutput: ScoresJsonOutput = {
    address,
    fingerprint,
    score,
    hardware: isHardware === 'Y',
    hwScore,
    familyMultiplier,
    familySize,
    scoreWithFamilyMultiplier,
    hwScoreWithFamilyMultiplier
  }

  if (parsedFamily.length > 0) {
    anOutput.family = parsedFamily
  }

  output.push(anOutput)
}

console.log(JSON.stringify(output, undefined, 2))
