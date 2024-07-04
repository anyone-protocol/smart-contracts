import HWTestScores from '../../test/e2e/data/scores_hw_bonuses.json'

console.log('fingerprint,address,score')
for (let i = 0; i < HWTestScores.length; i++) {
  const { fingerprint, address, score } = HWTestScores[i]
  console.log(`${fingerprint},${address},${score}`)
}
