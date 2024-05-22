import TestScores from '../../test/e2e/data/scores.json'

console.log('fingerprint,address,score')
for (let i = 0; i < TestScores.length; i++) {
  const { fingerprint, address, score } = TestScores[i]
  console.log(`${fingerprint},${address},${score}`)
}
