// W-C — data-driven WASM parity (staging-tests.spec.ts + test1.spec.ts) at Tier-2 (luerl, no node).
//
// The three data-driven harness cases feed large CAPTURED score datasets at REAL token scale
// ('28935184200000000' / '40509259200000000') through Add-Scores + Complete-Round and assert only
// that the pipeline processes to OK (no reward totals). Real token scale overflows 64-bit, so these
// can't run in the Tier-1 busted spec — they recreate here under luerl (arbitrary-precision ints,
// the device's semantics). Each dataset runs through the NATIVE contract exactly as the WASM test
// sequenced it, and we assert every Complete-Round returns a valid snapshot (Details present) = OK.
//
// Run: bun run scripts/tier2-relay-datasets.ts
import { config as staging1Config } from '../test/spec/contracts/relay-rewards/staging1-config.js'
import { scores as staging1Scores } from '../test/spec/contracts/relay-rewards/staging1-scores.js'
import { scores as staging2Scores } from '../test/spec/contracts/relay-rewards/staging2-scores.js'
import { test1Config } from '../test/spec/contracts/relay-rewards/test1-config.js'
import { test1Scores } from '../test/spec/contracts/relay-rewards/test1-scores.js'
import { execFileSync } from 'node:child_process'
import fs from 'fs'
import path from 'path'

const AO = path.resolve(import.meta.dir, '..')

type Step = { kind: 'config'; data: any } | { kind: 'round'; ts: string; scores: any }
type Dataset = { name: string; steps: Step[] }

// Faithful to the WASM sequences (staging-tests.spec.ts / test1.spec.ts):
const DATASETS: Dataset[] = [
  { name: 'staging1', steps: [
    { kind: 'round', ts: '100', scores: staging1Scores },              // default config
    { kind: 'config', data: staging1Config },
    { kind: 'round', ts: '123456789000', scores: staging1Scores },
  ] },
  { name: 'staging2', steps: [
    { kind: 'round', ts: '1739283636342', scores: staging2Scores },    // default config
  ] },
  { name: 'test1', steps: [
    { kind: 'round', ts: '1741829169954', scores: test1Scores },       // default config
    { kind: 'config', data: test1Config },
    { kind: 'round', ts: '1741829269954', scores: test1Scores },
  ] },
]

const scenarioHead = `
local json = require('json')
local OWNER = '0x' .. string.rep('1', 40)
local function commit(c) return { c1 = { ['commitment-device'] = 'ans104@1.0', committer = c } } end
local function assign(a, d, ts)
  local tags = { { name = 'Action', value = a } }
  if ts then tags[#tags + 1] = { name = 'Round-Timestamp', value = ts } end
  return { body = { action = a, commitments = commit(OWNER), tags = tags, data = d } }
end
local base = { process = { id = 'PID', commitments = commit(OWNER) } }
local ok, err, details = true, nil, 0
local function step_config(cfg)
  if not ok then return end
  compute(base, assign('Update-Configuration', cfg, nil))
  local o = base.results.output.data
  if o ~= 'OK' then ok = false; err = 'config: ' .. tostring(o):sub(1, 160) end
end
local function step_round(sc, ts)
  if not ok then return end
  compute(base, assign('Add-Scores', sc, ts))
  local o = base.results.output.data
  if o ~= 'OK' then ok = false; err = 'add ' .. ts .. ': ' .. tostring(o):sub(1, 160); return end
  compute(base, assign('Complete-Round', nil, ts))
  local out = base.results.output.data
  local okDec, dec = pcall(json.decode, out)
  if not okDec or type(dec) ~= 'table' or dec.Details == nil then
    ok = false; err = 'complete ' .. ts .. ': ' .. tostring(out):sub(1, 160); return
  end
  local n = 0; for _ in pairs(dec.Details) do n = n + 1 end; details = n
end
`
const scenarioTail = `
if ok then print('DATASET_OK details=' .. tostring(details))
else print('DATASET_FAIL ' .. tostring(err)) end
return { pass = ok and 1 or 0, fail = ok and 0 or 1, failures = {} }
`

// NB: luerl's parser rejects 4-equals long brackets ([====[), so use 2-equals ([==[). The datasets
// contain no `]==]` sequence (no arrays in the score maps; config uses only `[]`), so this is safe.
function stepsToLua(steps: Step[]): string {
  return steps.map(s => {
    const j = JSON.stringify(s.kind === 'config' ? s.data : s.scores)
    if (j.includes(']==]')) throw new Error('dataset contains ]==] — long-bracket delimiter unsafe')
    if (s.kind === 'config') return `step_config([==[${j}]==])`
    return `step_round([==[${j}]==], '${s.ts}')`
  }).join('\n')
}

let fails = 0
for (const ds of DATASETS) {
  const nFps = Object.keys((ds.steps.find(s => s.kind === 'round') as any).scores.Scores).length
  const scen = scenarioHead + stepsToLua(ds.steps) + scenarioTail
  const scenPath = path.join(AO, `dist/relay-dataset-${ds.name}-scen.lua`)
  fs.writeFileSync(scenPath, scen)
  process.stdout.write(`${ds.name}: ${nFps} fingerprints, ${ds.steps.filter(s => s.kind === 'round').length} round(s) … `)
  let raw = ''
  try {
    raw = execFileSync('podman', ['run', '--rm', '-v', `${AO}:/work:Z`, '-w', '/work', 'anyone-luerl:1.3.0',
      'native', '/work', 'src/contracts/native/relay-rewards.lua', `/work/dist/relay-dataset-${ds.name}-scen.lua`],
      { encoding: 'utf8', timeout: 300000, maxBuffer: 256 * 1024 * 1024 })
  } catch (e: any) {
    raw = String(e?.stdout || '') + String(e?.stderr || '')
  }
  const line = raw.split('\n').find(l => l.startsWith('DATASET_OK') || l.startsWith('DATASET_FAIL'))
  if (line && line.startsWith('DATASET_OK')) {
    console.log(`OK (${line.replace('DATASET_OK ', '')})`)
  } else {
    fails++
    console.log(`FAIL — ${line || raw.trim().split('\n').slice(-3).join(' | ').slice(0, 300)}`)
  }
}

console.log(`\n${fails === 0 ? 'ALL PASS' : fails + ' failed'} — ${DATASETS.length} data-driven datasets through the native contract (luerl).`)
process.exit(fails === 0 ? 0 : 1)
