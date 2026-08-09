// Build the Tier-3 parity ORACLE for staking-rewards: run the shared round (util/staking-round.ts)
// against the FULL 402KB seed bundle in luerl, and record every result the node will be checked on.
//
// Unlike relay — whose 800KB bundle times out in luerl, forcing a minimal config-only oracle — the
// staking seed parses in ~2s, so the oracle runs the SAME bundle, with the SAME 562-hodler
// Rewarded / 400-hodler Claimed priors, that the node spawns from. The comparison is therefore
// whole-state, not just "fresh addresses accrue the same".
//
// Emits dist/staking-oracle-probe.json { Period, Summary, Details, Rewarded }.
// Run: bun run scripts/build-staking-oracle.ts     (needs dist/staking-rewards-seed.lua)
// Env: CONTAINER_ENGINE (podman|docker, default podman), LUERL_IMAGE
import fs from 'fs'
import path from 'path'
import { buildRound } from './util/staking-round'
import { luerl } from './util/luerl'

const AO = path.resolve(import.meta.dir, '..')
const seedPath = path.join(AO, 'dist/staking-rewards-seed.lua')
const expectedPath = path.join(AO, 'dist/staking-rewards-seed.expected.json')
for (const p of [seedPath, expectedPath]) {
  if (!fs.existsSync(p)) { console.error(`missing ${p} — run scripts/build-staking-seed.ts first`); process.exit(2) }
}
const expected = JSON.parse(fs.readFileSync(expectedPath, 'utf8'))
const round = buildRound(expected.state, Number(process.env.N || 250))

const scoresJson = JSON.stringify({ Scores: round.scores })
if (scoresJson.includes(']==]')) throw new Error('round payload contains ]==] — long-bracket delimiter unsafe')

// The seed bundle already registered the contract; `compute` drives it. Owner is set on first
// compute from the process commitments, and the owner role satisfies Add-Scores/Complete-Round.
const scenario = `
local json = require('json')
local OWNER = '0x' .. string.rep('1', 40)
local function commit(c) return { c1 = { ['commitment-device'] = 'ans104@1.0', committer = c } } end
local function assign(a, d, ts)
  local tags = { { name = 'Action', value = a } }
  if ts then tags[#tags + 1] = { name = 'Round-Timestamp', value = tostring(ts) } end
  return { body = { action = a, commitments = commit(OWNER), tags = tags, data = d } }
end
local base = { process = { id = 'PID', commitments = commit(OWNER) } }
compute(base, assign('Add-Scores', [==[${scoresJson}]==], ${round.timestamp}))
compute(base, assign('Complete-Round', nil, ${round.timestamp}))
print('ORACLE_PERIOD=' .. json.encode(native.stateRoot().PreviousRound.Period))
print('ORACLE_SUMMARY=' .. json.encode(native.stateRoot().PreviousRound.Summary))
-- Through the views: state is D32-flat, and the on-node side compares the NESTED shape a
-- consumer sees. last_snapshot reassembles Details; Rewarded is un-flattened here.
print('ORACLE_DETAILS=' .. json.encode(native.view(base, 'last_snapshot').Details))
print('ORACLE_REWARDED=' .. json.encode((function()
  local out = {}
  for k, v in pairs(native.stateRoot().Rewarded) do
    local i = string.find(k, '/', 1, true)
    local h, o = string.sub(k, 1, i - 1), string.sub(k, i + 1)
    if out[h] == nil then out[h] = {} end
    out[h][o] = v
  end
  return out
end)()))
return { pass = 1, fail = 0, failures = {} }
`
const scenPath = path.join(AO, 'dist/staking-oracle-scen.lua')
fs.writeFileSync(scenPath, scenario)

console.log(`oracle round: ${round.realPairs} real + ${round.freshPairs} fresh pairs across ${round.hodlers} hodlers`)
console.log(`  prev=${round.prev}  t=${round.timestamp}  (13-digit ms — exercises A17 keying)`)
console.log(`  ${round.withClaimedPrior} pairs with a Claimed prior, ${round.selfPairs} self-pairs, ${round.belowGate} below the Running gate, ${round.atGate} at it`)

const t0 = performance.now()
const raw = luerl(
  ['bundle', '/work/dist/staking-rewards-seed.lua', '/work/dist/staking-oracle-scen.lua'],
  { timeoutMs: 900_000 })
const ms = Math.round(performance.now() - t0)

const grep = (tag: string) => {
  const line = raw.split('\n').find(l => l.startsWith(tag + '='))
  if (!line) { console.error(`no ${tag}= in output:\n` + raw.slice(0, 2000)); process.exit(2) }
  return JSON.parse(line.slice(tag.length + 1))
}
const probe = {
  prev: round.prev,
  timestamp: round.timestamp,
  Period: grep('ORACLE_PERIOD'),
  Summary: grep('ORACLE_SUMMARY'),
  Details: grep('ORACLE_DETAILS'),
  Rewarded: grep('ORACLE_REWARDED'),
}

// A round that computed nothing would "match" a node that also did nothing.
const detailPairs = Object.values(probe.Details as Record<string, any>).reduce((n, o) => n + Object.keys(o).length, 0)
if (detailPairs !== round.realPairs + round.freshPairs) {
  console.error(`FAIL: oracle produced ${detailPairs} Details pairs, round has ${round.realPairs + round.freshPairs}`)
  process.exit(1)
}
if (probe.Summary.Rewards === '0' || probe.Period !== 3600) {
  console.error(`FAIL: oracle round is degenerate — Period=${probe.Period} Rewards=${probe.Summary.Rewards}`)
  process.exit(1)
}

const out = path.join(AO, 'dist/staking-oracle-probe.json')
fs.writeFileSync(out, JSON.stringify(probe))
console.log(`\nwrote ${out} (${(fs.statSync(out).size / 1024).toFixed(1)}KB) in ${ms}ms`)
console.log(`  Period=${probe.Period}  Summary.Rewards=${probe.Summary.Rewards}`)
console.log(`  Summary.Ratings=${probe.Summary.Ratings}`)
console.log(`  Details: ${Object.keys(probe.Details).length} hodlers / ${detailPairs} pairs; Rewarded: ${Object.keys(probe.Rewarded).length} hodlers`)
