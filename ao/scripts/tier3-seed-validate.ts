// Tier-3 real-seed migrate-on-spawn validation. Spawns the published SEED module (real
// legacynet state, ~1MB) by-id and proves it materializes correctly on a live node:
//   1. counts match the dump                  (status view)
//   2. FULL seed-diff: every map key/value    (dump view vs dist/...expected.json)
//   3. roles seeded into acl.roles            (roles view; the migrate-on-spawn acl fix)
//   4. EIP-55 lookup: canonical AND lowercase query resolve the same operator (on-chain eip55)
//   5. post-seed WRITE at ~1MB: a new cert persists + counts increment  (A16 fix at real scale)
//   6. read/write timings at scale
// Run: HB_URL=http://localhost:8734 MODULE_ID=<seed id> bun run scripts/tier3-seed-validate.ts
import { EthereumSigner } from '@dha-team/arbundles'
import { Wallet, getAddress } from 'ethers'
import { fetchNodeAddress, spawnLuaProcess, sendMessage } from './util/hb-client'
import { seedEnvelopeFor } from './util/native-bundle'
import fs from 'fs'
import path from 'path'

const HB = process.env.HB_URL || 'http://localhost:8734'
const MODULE_ID = process.env.MODULE_ID
if (!MODULE_ID) { console.error('MODULE_ID env required'); process.exit(2) }
const KEY = (process.env.DEPLOYER_PRIVATE_KEY || '80611882d38e5502d93305c88b64da234fea23037334ecb9a647249076c5fa37').replace(/^0x/, '')
const signer = new EthereumSigner(KEY)
const DEV = new Wallet('0x' + KEY).address   // already EIP-55

const AO = path.resolve(import.meta.dir, '..')
const expected = JSON.parse(fs.readFileSync(path.join(AO, 'dist/operator-registry-seed.expected.json'), 'utf8'))

let fails = 0
const check = (ok: boolean, label: string, detail = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`)
  if (!ok) fails++
}
const view = async (v: string) => {
  const t0 = performance.now()
  const r = await fetch(`${HB}/${p}~process@1.0/as/${v}`)
  const body = await r.text()
  const ms = Math.round(performance.now() - t0)
  if (!r.ok) throw new Error(`view ${v} -> ${r.status}: ${body.slice(0, 200)}`)
  return { data: JSON.parse(body), ms }
}
// Compare two {key:val} maps; return a short mismatch summary ('' = identical).
const diffMap = (got: Record<string, unknown>, want: Record<string, unknown>) => {
  got = got || {}; want = want || {}
  const gk = Object.keys(got), wk = Object.keys(want)
  if (gk.length !== wk.length) return `size ${gk.length} != ${wk.length}`
  let valMismatch = 0, missing = 0, sample = ''
  for (const k of wk) {
    if (!(k in got)) { missing++; if (!sample) sample = `missing ${k}` }
    else if (got[k] !== want[k]) { valMismatch++; if (!sample) sample = `${k}: ${got[k]} != ${want[k]}` }
  }
  return missing || valMismatch ? `${missing} missing, ${valMismatch} valDiff (${sample})` : ''
}

let p: string

;(async () => {
  console.log(`node ${await fetchNodeAddress(HB)}  moduleId=${MODULE_ID}\n  owner(dev)=${DEV}`)
  const r = await spawnLuaProcess({ url: HB, signer },
    { moduleId: MODULE_ID, spawnData: seedEnvelopeFor('operator-registry'), tags: [{ name: 'name', value: `seed-${Date.now()}` }] })
  p = r.pid
  console.log(`spawned pid=${p}\n`)

  // 1) counts (also the first compute -> materialization). Retry until it answers.
  // spawnLuaProcess already forced the lazy first compute, so this is the SEED-LANDED check:
  // `status.initialized` says whether a slot really ran, which the counts cannot — a
  // never-computed process and a correctly seeded empty one both answer zero.
  console.log('1) materialization + counts (status view):')
  let status: any, statusMs = 0
  for (let i = 0; i < 30; i++) {
    try {
      const s = await view('status')
      if (s.data?.initialized !== false) { status = s.data; statusMs = s.ms; break }
    } catch { /* not up yet */ }
    await new Promise(r => setTimeout(r, 1000))
  }
  if (!status) { console.log('  FAIL  status never answered (no materialization)'); process.exit(1) }
  const ec = {
    claimable: Object.keys(expected.state.claimable).length,
    verified: Object.keys(expected.state.verified).length,
    blocked: Object.keys(expected.state.blocked).length,
    hardware: Object.keys(expected.state.verifiedHardware).length,
    credits: Object.keys(expected.state.registrationCredits).length,
  }
  // field-wise (HB serializes the map with keys sorted, so don't compare stringified order)
  const countsOk = (Object.keys(ec) as (keyof typeof ec)[]).every(k => status.counts[k] === ec[k])
  check(countsOk, 'counts == dump',
    `${JSON.stringify(status.counts)} (first read ${statusMs}ms)`)
  check(status.registrationCreditsRequired === expected.state.registrationCreditsRequired,
    'registrationCreditsRequired', String(status.registrationCreditsRequired))

  // 2) full seed-diff (dump view — every key/value of every map)
  console.log('\n2) full seed-diff (dump view vs expected):')
  const { data: dump, ms: dumpMs } = await view('dump')
  for (const m of ['verified', 'claimable', 'verifiedHardware', 'registrationCredits', 'blocked'] as const) {
    const d = diffMap(dump[m], expected.state[m])
    check(d === '', `dump.${m} (${Object.keys(expected.state[m]).length} entries)`, d || 'identical')
  }
  console.log(`  (dump read ${dumpMs}ms, ${(JSON.stringify(dump).length / 1024).toFixed(0)}KB)`)

  // 3) roles seeded (migrate-on-spawn acl fix)
  console.log('\n3) roles seeded (roles view — the acl migrate-on-spawn fix):')
  const { data: roles } = await view('roles')
  for (const role of Object.keys(expected.roles)) {
    check(diffMap(roles[role], expected.roles[role]) === '', `role ${role}`,
      Object.keys(expected.roles[role] || {}).join(','))
  }

  // 4) EIP-55 lookup — pick a real verified operator; canonical + lowercase must resolve same
  console.log('\n4) EIP-55 lookup (on-chain eip55 canonicalizes the query):')
  const someFp = Object.keys(expected.state.verified)[0]
  const someAddr = expected.state.verified[someFp]   // canonical EIP-55
  const opC = (await view(`operator?address=${someAddr}`)).data
  const opL = (await view(`operator?address=${someAddr.toLowerCase()}`)).data
  check(opC.verified && opC.verified[someFp] === true, 'canonical query resolves operator', `${someAddr} -> fp ${someFp}`)
  check(JSON.stringify(opC) === JSON.stringify(opL), 'lowercase query == canonical query', 'on-chain eip55 canonicalized the tag')

  // 5) post-seed WRITE at ~1MB — A16 fix at real scale: a NEW cert must persist + count++
  console.log('\n5) post-seed write at ~1MB (A16 regression at real scale):')
  const NEWFP = 'F'.repeat(40)
  const isNew = !(NEWFP in expected.state.verified) && !(NEWFP in expected.state.claimable)
  const t0 = performance.now()
  await sendMessage({ url: HB, signer }, {
    pid: p, tags: [{ name: 'action', value: 'Admin-Submit-Operator-Certificates' }],
    data: JSON.stringify([{ f: NEWFP, a: DEV }]),
  })
  const writeMs = Math.round(performance.now() - t0)
  const after = await view('status')
  const opNew = (await view(`operator?address=${DEV}`)).data
  check(isNew, 'new FP not already in seed', NEWFP.slice(0, 8) + '…')
  check(after.data.counts.claimable === ec.claimable + 1, 'claimable count incremented', `${ec.claimable} -> ${after.data.counts.claimable}`)
  check(opNew.claimable && opNew.claimable[NEWFP] === true, 'new cert persisted + readable', `write ${writeMs}ms`)

  console.log(`\n${fails === 0 ? 'ALL PASS' : fails + ' FAILURE(S)'}  —  pid=${p}`)
  process.exit(fails ? 1 : 0)
})().catch(e => { console.error('FATAL', String(e?.stack || e).slice(0, 500)); process.exit(2) })
