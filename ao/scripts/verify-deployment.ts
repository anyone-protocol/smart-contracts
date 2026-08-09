// POST-DEPLOYMENT VERIFICATION — point it at a LIVE process id and get a report.
//
// The other harnesses answer "does this code work" against a process they spawn themselves.
// This one answers a different question: "is the thing we actually deployed healthy, faithful to
// what we migrated, and safe" — and writes it up for people who were not in the room.
//
// READ-ONLY against the deployed process. It never sends a message to it. Behavioral coverage
// (writes, ACL rejection, atomic revert) comes from --behavioral, which runs the existing Tier-3
// validator against a TWIN spawned from the same module id. Verifying a production contract by
// writing to it is not verification, it is a second deployment.
//
//   CONTRACT=staking-rewards PID=<pid> HB_URL=https://hb-dev.anyone.tech \
//     bun run scripts/verify-deployment.ts [--behavioral] [--report dist/report.md]
//
// Optional env:
//   EXPECTED_MODULE_ID  fail loudly if the process is running different code than we published
//   SEED_NET            live|stage — which dump the state is checked against (default live)
//
// Exit code is 0 only when nothing CRITICAL or HIGH is open, so it works as a deploy gate.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const AO = path.resolve(import.meta.dir, '..')
const HB = process.env.HB_URL
const PID = process.env.PID
const CONTRACT = process.env.CONTRACT as ContractName
const NET = process.env.SEED_NET || 'live'
const BEHAVIORAL = process.argv.includes('--behavioral')
const reportIdx = process.argv.indexOf('--report')
const REPORT = reportIdx >= 0 ? process.argv[reportIdx + 1] : path.join(AO, `dist/verify-${CONTRACT}-report.md`)

type ContractName = 'operator-registry' | 'relay-rewards' | 'staking-rewards'
const CONTRACTS: ContractName[] = ['operator-registry', 'relay-rewards', 'staking-rewards']
if (!HB || !PID || !CONTRACTS.includes(CONTRACT)) {
  console.error('usage: CONTRACT=<operator-registry|relay-rewards|staking-rewards> PID=<pid> HB_URL=<url> \\')
  console.error('         bun run scripts/verify-deployment.ts [--behavioral] [--report <path>]')
  process.exit(2)
}

// ---------------------------------------------------------------- findings

type Sev = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'INFO' | 'OK'
type Finding = { sev: Sev, area: string, what: string, detail?: string }
const findings: Finding[] = []
const add = (sev: Sev, area: string, what: string, detail?: string) => {
  findings.push({ sev, area, what, detail })
  const mark = sev === 'OK' ? '  ok  ' : ` ${sev.padEnd(5)}`
  console.log(`${mark} ${what}${detail ? `  — ${detail}` : ''}`)
}
/** ok() when the condition holds, the given severity when it does not. */
const expect = (cond: boolean, sev: Sev, area: string, what: string, detail?: string) =>
  add(cond ? 'OK' : sev, area, what, detail)

// ---------------------------------------------------------------- node access

const P = `${HB!.replace(/\/+$/, '')}/${PID}~process@1.0`
async function raw (p: string): Promise<{ status: number, body: string, ms: number }> {
  const t0 = performance.now()
  try {
    const r = await fetch(`${P}/${p}`, { headers: { accept: 'application/json' } })
    return { status: r.status, body: await r.text(), ms: performance.now() - t0 }
  } catch (e) {
    return { status: 0, body: String((e as Error)?.message ?? e), ms: performance.now() - t0 }
  }
}
async function view (name: string, qs = ''): Promise<{ ok: boolean, json: any, ms: number, status: number }> {
  const r = await raw(`as/${name}${qs}`)
  let json: any = null
  try { json = JSON.parse(r.body) } catch { /* not json */ }
  return { ok: r.status === 200 && json !== null, json, ms: r.ms, status: r.status }
}
const num = (v: unknown) => (typeof v === 'string' || typeof v === 'number') ? BigInt(String(v)) : 0n
const fmtMs = (ms: number) => `${ms.toFixed(0)}ms`

// ---------------------------------------------------------------- per-contract knowledge

/** Exactly the views our consumers call. If one of these is wrong, something user-facing is
 *  down — this is the blast radius, not a guess at what might matter. Grepped from the sources.
 *
 *  ⚠️ NOT just the four controllers. `api-service` carries its OWN reader
 *  (`src/util/ao-read.ts`, deliberately no ao-client dependency), so a read-path change has to
 *  be made there separately — it does not arrive with an ao-client bump. The dashboard reads
 *  relay-rewards through a different mechanism again (see DASHBOARD_NOTE). */
const CONSUMERS: Record<ContractName, { view: string, qs?: (s: any) => string, by: string }[]> = {
  'operator-registry': [
    { view: 'dump', by: 'operator-registry-controller (whole registry)' },
    { view: 'scoring', by: 'relay-rewards-controller + staking-rewards-controller (round input)' },
    { view: 'operators', by: 'api-service (public /operators endpoint)' },
  ],
  'relay-rewards': [
    { view: 'rewards', by: 'facilitator-controller (payout lookup) + dashboard (per-address rewards)',
      qs: (s) => { const a = Object.keys(s?.TotalAddressReward ?? {})[0]; return a ? `?address=${a}` : '' } },
    { view: 'claimed', by: 'dashboard (claimed to date)',
      qs: (s) => { const a = Object.keys(s?.Claimed ?? {})[0]; return a ? `?address=${a}` : '' } },
  ],
  'staking-rewards': [
    { view: 'last_snapshot', by: 'staking-rewards-controller (round snapshot)' },
  ],
}

/** The dashboard does NOT read like the services do. It builds
 *  `now/~lua@5.3a&module=<relayDynamicViews>/get_rewards?address=0x<ALLCAPS>` — a separate
 *  "dynamic views" module injected per request, legacynet ALLCAPS address casing, and view names
 *  (`get_rewards`/`get_claimed`) that the native contract does not define. All three are
 *  incompatible with the native deployment, and the `now/~lua@5.3a` part specifically returns
 *  200-with-empty-state under globals rather than an error. Called out in every report until it
 *  is resolved — it is a product decision, not something to quietly rewrite here. */
const DASHBOARD_NOTE =
  'ator-relay-dashboard reads relay-rewards via `now/~lua@5.3a&module=<relayDynamicViews>/get_rewards` '
  + 'with ALLCAPS addresses. That path re-initialises a fresh VM (empty state under D32 globals), '
  + 'the view names do not exist on the native contract, and the address casing is legacynet. '
  + 'It needs its own decision before go-live.'

/** Deviations from legacynet that are DELIBERATE. Surfaced so the team reads them here rather
 *  than discovering them in production. Every one is decided and recorded in the contract header. */
const DEVIATIONS: Record<ContractName, string[]> = {
  'operator-registry': [
    'Addresses are stored EIP-55 checksummed; legacynet stored `0x` + ALLCAPS.',
  ],
  'relay-rewards': [
    'Addresses are stored EIP-55 checksummed; legacynet stored `0x` + ALLCAPS.',
    '`PreviousRound.Details` is NOT persisted (3.6 MB of a 4 MB state). Details ride the Complete-Round output and are read from the settle slot.',
  ],
  'staking-rewards': [
    'Addresses are stored EIP-55 checksummed; legacynet stored `0x` + ALLCAPS.',
    'SHARE-DELAY UNIT FIX: legacynet compared a SECONDS delay against MILLISECOND timestamps, so a 7-day delay elapsed in ~10 minutes. Fixed. Dormant today (`SetSharesEnabled=false`).',
    'D32 storage is pair-keyed (`hodler/operator`) and `PreviousRound.Details` is parallel typed maps. Views reassemble the legacy nested shape, so consumers see no change.',
    '2 empty hodler rows from legacynet are NOT migrated (they held nothing): `status.counts.rewardedHodlers` reads 2 lower, and `Claim-Rewards` on those addresses errors instead of returning `{}`.',
  ],
}

/** The headline number the protocol team actually cares about, per contract. */
async function moneyLine (dump: any): Promise<string[]> {
  const out: string[] = []
  if (CONTRACT === 'operator-registry') {
    const c = (m: any) => Object.keys(m ?? {}).length
    out.push(`verified fingerprints: **${c(dump.verified)}**`)
    out.push(`claimable fingerprints: **${c(dump.claimable)}**`)
    out.push(`blocked addresses: **${c(dump.blocked)}**`)
    out.push(`hardware-verified: **${c(dump.verifiedHardware)}**`)
  } else if (CONTRACT === 'relay-rewards') {
    const tar = Object.values(dump.TotalAddressReward ?? {}).reduce((a: bigint, v) => a + num(v), 0n)
    const tfr = Object.values(dump.TotalFingerprintReward ?? {}).reduce((a: bigint, v) => a + num(v), 0n)
    const claimed = Object.values(dump.Claimed ?? {}).reduce((a: bigint, v) => a + num(v), 0n)
    out.push(`cumulative rewards by address: **${tar}**`)
    out.push(`cumulative rewards by fingerprint: **${tfr}**`)
    out.push(`claimed to date: **${claimed}**`)
    out.push(`**outstanding (address rewards - claimed): ${tar - claimed}**`)
  } else {
    // D32: pair-keyed, so these are flat sums over `hodler/operator` keys.
    const rewarded = Object.values(dump.Rewarded ?? {}).reduce((a: bigint, v) => a + num(v), 0n)
    const claimed = Object.values(dump.Claimed ?? {}).reduce((a: bigint, v) => a + num(v), 0n)
    out.push(`cumulative staking rewards: **${rewarded}**`)
    out.push(`claimed to date: **${claimed}**`)
    out.push(`**outstanding (rewarded - claimed): ${rewarded - claimed}**`)
    out.push(`reward pairs tracked: **${Object.keys(dump.Rewarded ?? {}).length}**`)
  }
  return out
}

// ---------------------------------------------------------------- checks

const started = new Date().toISOString()
const timings: { label: string, ms: number }[] = []

;(async () => {
  console.log(`\n=== post-deployment verification: ${CONTRACT} ===`)
  console.log(`node ${HB}\npid  ${PID}\n`)

  // ---- A. identity + liveness ------------------------------------------------
  console.log('A) identity and liveness')
  const slot = await raw('now/at-slot')
  expect(slot.status === 200, 'CRITICAL', 'liveness', 'process resolves and computes',
    slot.status === 200 ? `at-slot ${slot.body.replace(/\D+/g, '') || '?'}, ${fmtMs(slot.ms)}` : `HTTP ${slot.status}`)
  if (slot.status !== 200) { await emit(); return }

  const ver = await view('version')
  expect(ver.ok && ver.json?.contract === CONTRACT, 'CRITICAL', 'identity',
    'runtime reports the expected contract', `${ver.json?.contract ?? '?'} / runtime ${ver.json?.runtime ?? '?'} / root ${ver.json?.root ?? '?'}`)

  const status = await view('status')
  expect(status.ok, 'CRITICAL', 'liveness', 'status view answers', `${fmtMs(status.ms)}`)
  expect(status.json?.initialized !== false, 'CRITICAL', 'liveness',
    'process has computed (seed materialized)', `initialized=${status.json?.initialized}`)

  const mod = await raw('now/module')
  // The node answers with the message envelope (`{"ao-result":"body","body":"<id>",…}`), not a
  // bare id — pull `body` out rather than string-slicing the JSON.
  let modId: string | null = null
  if (mod.status === 200) {
    try { modId = JSON.parse(mod.body)?.body ?? null } catch { modId = mod.body.trim() || null }
    if (typeof modId !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(modId)) modId = null
  }
  if (process.env.EXPECTED_MODULE_ID) {
    expect(modId === process.env.EXPECTED_MODULE_ID, 'CRITICAL', 'identity',
      'running the module we published', `${modId ?? '?'} vs expected ${process.env.EXPECTED_MODULE_ID}`)
  } else {
    add('INFO', 'identity', 'module id (set EXPECTED_MODULE_ID to pin it)', modId ?? 'unreadable')
  }
  add('INFO', 'identity', 'process owner', status.json?.owner ?? 'unreported')

  // ---- B. state fidelity vs the migration dump --------------------------------
  console.log('\nB) migrated state fidelity (deployed state vs the legacynet dump transform)')
  const expectedPath = path.join(AO, 'dist', `${CONTRACT}-seed.expected.json`)
  const dumpRes = await view('dump')
  expect(dumpRes.ok, 'CRITICAL', 'state', 'dump view answers', `${fmtMs(dumpRes.ms)}`)
  timings.push({ label: 'dump', ms: dumpRes.ms })
  const live = dumpRes.json ?? {}

  if (!fs.existsSync(expectedPath)) {
    add('MEDIUM', 'state', 'no local seed oracle to compare against',
      `run scripts/build-${CONTRACT === 'operator-registry' ? '' : CONTRACT.split('-')[0] + '-'}seed.ts ${NET} first`)
  } else {
    const expectedState = JSON.parse(fs.readFileSync(expectedPath, 'utf8')).state
    let mismatched = 0, missing = 0, checked = 0
    for (const key of Object.keys(expectedState)) {
      const want = expectedState[key], got = live[key]
      if (got === undefined) { missing++; add('CRITICAL', 'state', `\`${key}\` is MISSING from the deployed state`); continue }
      const d = firstDiff(got, want, key)
      checked++
      if (d) { mismatched++; add('CRITICAL', 'state', `\`${key}\` does not match the migrated dump`, d) }
    }
    if (!mismatched && !missing) {
      add('OK', 'state', `all ${checked} top-level state keys match the ${NET} dump transform`,
        'entry by entry')
    }
    const extra = Object.keys(live).filter(k => !(k in expectedState))
    expect(extra.length === 0, 'MEDIUM', 'state', 'no unexpected top-level state keys',
      extra.length ? extra.join(', ') : 'none')
  }

  // ---- C. consumer read surface ----------------------------------------------
  console.log('\nC) consumer read surface (the views our services actually call)')
  for (const c of CONSUMERS[CONTRACT]) {
    const qs = c.qs ? c.qs(live) : ''
    const r = await view(c.view, qs)
    timings.push({ label: `as/${c.view}`, ms: r.ms })
    const empty = r.ok && (r.json === null || (typeof r.json === 'object' && Object.keys(r.json).length === 0))
    if (!r.ok) add('CRITICAL', 'reads', `\`as/${c.view}\` FAILED — ${c.by} is broken`, `HTTP ${r.status}`)
    else if (empty) add('HIGH', 'reads', `\`as/${c.view}\` answered EMPTY — ${c.by}`, fmtMs(r.ms))
    else add('OK', 'reads', `\`as/${c.view}\` — ${c.by}`, fmtMs(r.ms))
    if (r.ok && r.ms > 2000) add('MEDIUM', 'reads', `\`as/${c.view}\` is slow`, `${fmtMs(r.ms)} — over the 2s consumer budget`)
  }

  // ---- D. access control ------------------------------------------------------
  console.log('\nD) access control and the write gate')
  const roles = await view('roles')
  expect(roles.ok, 'HIGH', 'acl', 'roles view answers')
  const holders = new Set<string>()
  for (const [role, addrs] of Object.entries(roles.json ?? {})) {
    const list = Object.keys(addrs as any)
    list.forEach(a => holders.add(a))
    add('INFO', 'acl', `role \`${role}\``, list.join(', ') || '(nobody)')
  }
  expect(holders.size > 0, 'CRITICAL', 'acl', 'at least one role holder exists',
    `${holders.size} distinct address(es)`)

  // The p4 write gate reads the contract's allowlist trie directly, WITHOUT executing contract
  // code. Same read the node makes when deciding whether to schedule a message, so this is the
  // real answer to "who can write here", not an approximation.
  const allowed = async (addr: string) => {
    const r = await raw(`compute/allowlistId/~trie@1.0/${addr}`)
    return r.status === 200 && !/not_found/i.test(r.body)
  }
  const gateOn = (await raw('compute/allowlistId')).status === 200
  if (!gateOn) {
    add('HIGH', 'acl', 'no allowlist trie on this process — the write gate has nothing to read',
      'third-party writes would not be gated here')
  } else {
    let lockedOut = 0
    for (const h of holders) if (!(await allowed(h))) { lockedOut++; add('HIGH', 'acl', `role holder \`${h}\` is NOT on the write allowlist`, 'they would be rejected at the gate') }
    if (!lockedOut) add('OK', 'acl', `all ${holders.size} role holder(s) are on the write allowlist`)
    // Negative control: an address nobody has ever seen must not be admitted.
    const stranger = '0x' + 'ab'.repeat(20)
    expect(!(await allowed(stranger)), 'CRITICAL', 'acl',
      'an unknown address is NOT on the write allowlist', stranger)
  }

  // ---- E. deviations ----------------------------------------------------------
  console.log('\nE) known deviations from legacynet (deliberate)')
  for (const d of DEVIATIONS[CONTRACT]) add('INFO', 'deviation', d)
  if (CONTRACT === 'relay-rewards') add('HIGH', 'reads', 'dashboard read path is incompatible', DASHBOARD_NOTE)

  // ---- F. behavioral twin ------------------------------------------------------
  let behavioral: { ran: boolean, ok: boolean, tail: string } = { ran: false, ok: false, tail: '' }
  if (BEHAVIORAL) {
    console.log('\nF) behavioral probe on a TWIN (writes/ACL/revert — never touches the deployed process)')
    const script = CONTRACT === 'operator-registry' ? 'scripts/tier3-seed-validate.ts'
      : CONTRACT === 'relay-rewards' ? 'scripts/tier3-relay-validate.ts'
        : 'scripts/tier3-staking-validate.ts'
    if (!modId) add('MEDIUM', 'behavior', 'cannot run the twin probe — module id unreadable')
    else {
      try {
        const out = execFileSync('bun', ['run', script], {
          cwd: AO, encoding: 'utf8', timeout: 1800_000, maxBuffer: 256 * 1024 * 1024,
          env: { ...process.env, MODULE_ID: modId, HB_URL: HB! },
        })
        behavioral = { ran: true, ok: /ALL PASS/.test(out), tail: out.trim().split('\n').slice(-3).join('\n') }
        expect(behavioral.ok, 'HIGH', 'behavior', `twin probe (${script})`, behavioral.tail.split('\n').pop())
      } catch (e: any) {
        behavioral = { ran: true, ok: false, tail: String(e?.stdout ?? e?.message).trim().split('\n').slice(-3).join('\n') }
        add('HIGH', 'behavior', `twin probe FAILED (${script})`, behavioral.tail.split('\n').pop())
      }
    }
  } else {
    add('INFO', 'behavior', 'behavioral probe not run', 'pass --behavioral to exercise writes/ACL/revert on a twin')
  }

  await emit()

  // ---------------------------------------------------------------- report
  async function emit () {
    const bySev = (s: Sev) => findings.filter(f => f.sev === s)
    const crit = bySev('CRITICAL'), high = bySev('HIGH'), med = bySev('MEDIUM')
    const verdict = crit.length ? 'DO NOT USE — critical findings open'
      : high.length ? 'HOLD — high findings open'
        : med.length ? 'USABLE, with caveats' : 'HEALTHY'

    const money = dumpRes?.ok ? await moneyLine(live) : ['(state unreadable)']
    const lines: string[] = []
    lines.push(`# Deployment verification — ${CONTRACT}`)
    lines.push('')
    lines.push(`**Verdict: ${verdict}**`)
    lines.push('')
    lines.push(`| | |`)
    lines.push(`|---|---|`)
    lines.push(`| process | \`${PID}\` |`)
    lines.push(`| node | ${HB} |`)
    lines.push(`| module | \`${modId ?? 'unreadable'}\` |`)
    lines.push(`| checked | ${started} |`)
    lines.push(`| compared against | the ${NET} legacynet dump (2026-07-09) |`)
    lines.push('')
    lines.push(`Critical **${crit.length}** · High **${high.length}** · Medium **${med.length}** · `
      + `Passed **${bySev('OK').length}**`)
    lines.push('')

    lines.push('## What this process holds')
    lines.push('')
    money.forEach(m => lines.push(`- ${m}`))
    lines.push('')

    if (crit.length || high.length || med.length) {
      lines.push('## Findings, most severe first')
      lines.push('')
      lines.push('| severity | area | finding |')
      lines.push('|---|---|---|')
      for (const f of [...crit, ...high, ...med]) {
        lines.push(`| **${f.sev}** | ${f.area} | ${f.what}${f.detail ? ` — ${f.detail}` : ''} |`)
      }
      lines.push('')
    } else {
      lines.push('## Findings')
      lines.push('')
      lines.push('None. Every check passed.')
      lines.push('')
    }

    lines.push('## Read latency, as our services see it')
    lines.push('')
    lines.push('| view | time | called by |')
    lines.push('|---|---:|---|')
    for (const t of timings) {
      const c = CONSUMERS[CONTRACT].find(x => `as/${x.view}` === t.label)
      lines.push(`| \`${t.label}\` | ${fmtMs(t.ms)} | ${c?.by ?? 'verification only'} |`)
    }
    lines.push('')

    lines.push('## Deliberate deviations from legacynet')
    lines.push('')
    lines.push('These are decided and documented, not defects. Listed so they are read here rather')
    lines.push('than discovered later.')
    lines.push('')
    DEVIATIONS[CONTRACT].forEach(d => lines.push(`- ${d}`))
    lines.push('')

    lines.push('## What this did and did not check')
    lines.push('')
    lines.push('Checked, read-only against the deployed process:')
    lines.push('')
    lines.push('- it computes, reports the expected contract, and its seed materialized')
    lines.push('- every top-level state key matches the legacynet dump transform, entry by entry')
    lines.push('- every view our services call answers, is non-empty, and how long it takes')
    lines.push('- who holds each role, that they can all write, and that a stranger cannot')
    lines.push('')
    lines.push(behavioral.ran
      ? `Behavioral coverage ran on a TWIN spawned from the same module — ${behavioral.ok ? 'passed' : '**failed**'}. The deployed process was never written to.`
      : 'NOT checked: writes, ACL rejection paths and atomic revert. Re-run with `--behavioral` to exercise those on a twin spawned from the same module. This script never writes to the deployed process.')
    lines.push('')
    lines.push('Durability across a node restart is a node-level property (WS-6 D21/D22) and is out')
    lines.push('of scope here.')
    lines.push('')

    fs.mkdirSync(path.dirname(REPORT), { recursive: true })
    fs.writeFileSync(REPORT, lines.join('\n'))
    console.log(`\n${'='.repeat(64)}`)
    console.log(`VERDICT: ${verdict}`)
    console.log(`  critical ${crit.length} · high ${high.length} · medium ${med.length} · passed ${bySev('OK').length}`)
    console.log(`report: ${REPORT}`)
    process.exit(crit.length || high.length ? 1 : 0)
  }
})().catch(e => { console.error('FATAL', String(e?.stack ?? e).slice(0, 800)); process.exit(2) })

/** First structural difference, as a path + values. Order-insensitive: the node re-encodes from
 *  Lua tables and `pairs()` order is not stable, so a string compare would fail for no reason. */
function firstDiff (a: any, b: any, p = ''): string | null {
  if (a === b) return null
  if (typeof a !== typeof b) return `${p}: type ${typeof a} vs ${typeof b}`
  if (typeof a !== 'object' || a === null || b === null) {
    return `${p}: ${JSON.stringify(a)?.slice(0, 60)} vs ${JSON.stringify(b)?.slice(0, 60)}`
  }
  const ka = Object.keys(a), kb = Object.keys(b)
  if (ka.length !== kb.length) {
    const only = ka.filter(k => !(k in b)).concat(kb.filter(k => !(k in a))).slice(0, 3)
    return `${p}: ${ka.length} entries vs ${kb.length} (e.g. ${only.join(', ')})`
  }
  for (const k of kb) { const d = firstDiff(a[k], b[k], p ? `${p}.${k}` : k); if (d) return d }
  return null
}
