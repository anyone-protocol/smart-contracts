/**
 * D22 - capture a durable, ANCHORED state snapshot of each native contract.
 *
 * Why this exists
 * ---------------
 * The node snapshots its own processes, but only to the local cache:
 * `hb_store_arweave:write` is an explicit `{error, not_found}` and nothing in the
 * snapshot path calls an upload. So a node that loses its volume recovers nothing.
 *
 * D21 fixed the other half - assignments now reach Arweave, hash-chained through
 * `base-hashpath`, so published history is ordered, attributable and tamper-evident.
 * But every slot written BEFORE that fix has no assignment on chain, so the chain we
 * do publish dangles from a predecessor that does not exist. Verified 2026-08-25:
 * stage relay's earliest published assignment (slot 2387) names a base-hashpath
 * predecessor that is absent from Arweave.
 *
 * A snapshot closes that. It carries the state AND the slot AND the id of the
 * assignment at that slot, so the published chain gets an on-chain root: a verifier
 * fetches the named assignment, checks its `process` and `slot`, and then follows
 * `base-hashpath` forward from there. State alone would not do this.
 *
 * Consistency
 * -----------
 * There is NO way to pin a view read to a slot, and both plausible spellings fail
 * SILENTLY rather than erroring (measured on stage 2026-08-25):
 *   - `compute&slot=N/as/dump` returns 891 B of EMPTY state - it evaluates the view
 *     against that slot's result message, not the accumulated state.
 *   - `as/dump?slot=N` and `as/dump&slot=N` ignore the parameter and return latest.
 * So consistency comes from bracketing instead: read slot/current, dump, read
 * slot/current again, and require they match. Rounds are hourly on live and a dump
 * takes 1.6-3.4 s, so this converges immediately in practice.
 *
 * Output shape
 * ------------
 * Two files per contract, matching how it gets published: the gzipped dump is the
 * ANS-104 item DATA, and the metadata becomes its TAGS. Tagging (rather than
 * embedding JSON) is what makes snapshots discoverable later -
 * `tag process=<pid>, type=state-snapshot` is exactly the query recovery needs.
 *
 * Usage:
 *   bun run scripts/snapshot-state.ts <dev|stage|live> [--out DIR] [--contract NAME]
 */
import { createHash } from 'node:crypto'
import { gzipSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ENVS: Record<string, { host: string }> = {
  dev:   { host: 'hb-dev.anyone.tech' },
  stage: { host: 'hb-stage.anyone.tech' },
  live:  { host: 'hb.anyone.tech' },
  local: { host: process.env.LOCAL_HOST || 'localhost:8734' },
}

/**
 * SNAPSHOT_HOST overrides where we read WITHOUT changing the env label the snapshot is
 * tagged with. That is what lets the periodic snapshot job resolve the node from Consul
 * (`hyperbeam-<env>-node`) and read it directly while still tagging the artifact `env=live`.
 * Reading that address skips nginx, the edge and Traefik entirely; p4 still applies, but
 * `slot/current` and `as/dump` are both on the non-chargable routes.
 */
const HOST_OVERRIDE = process.env.SNAPSHOT_HOST

const GATEWAY = process.env.ARWEAVE_GATEWAY || 'https://arweave.net'
const SCHEMA = 'state-snapshot@1'

const env = (process.argv[2] || '').toLowerCase()
if (!ENVS[env]) {
  console.error('usage: bun run scripts/snapshot-state.ts <dev|stage|live|local> [--out DIR] [--contract NAME]')
  process.exit(2)
}
const argOf = (flag: string) => {
  const i = process.argv.indexOf(flag)
  return i > -1 ? process.argv[i + 1] : undefined
}
const OUT = argOf('--out') || join('snapshots', env)
const ONLY = argOf('--contract')
const HOST = HOST_OVERRIDE || ENVS[env].host
// An IP literal is always in-cluster and always plain HTTP; only a DNS name reaches the TLS edge.
// Matching on `127.` alone sent `https://` at the Consul-resolved node address and failed the
// handshake - `publish-snapshot.ts` gets this right by hardcoding `http://$SNAPSHOT_HOST`.
const scheme = (h: string) => {
  const host = h.split(':')[0]
  return host === 'localhost' || /^\d{1,3}(\.\d{1,3}){3}$/.test(host) ? 'http' : 'https'
}
const BASE = `${scheme(HOST)}://${HOST}`

/**
 * `json: true` asks for the structured body. Do NOT use it for scalars: with an
 * `accept: application/json` header the node wraps a scalar in a full commitment
 * envelope ({ao-result, body, commitments, ...}) instead of returning the value, so
 * `slot/current` comes back as several KB of signature rather than an integer.
 */
const text = async (path: string, opts: { ms?: number, json?: boolean } = {}) => {
  const res = await fetch(`${BASE}${path}`, {
    headers: opts.json ? { accept: 'application/json' } : {},
    signal: AbortSignal.timeout(opts.ms ?? 300_000),
  })
  return { status: res.status, body: await res.text() }
}

/** Read a numbered opt container off ~meta@1.0/info, following `+link` entries. */
async function listOf (key: string): Promise<any[]> {
  const r = await text(`/~meta@1.0/info/${key}?accept=application/json&accept-bundle`, { json: true })
  if (r.status !== 200) return []
  let container: any
  try { container = JSON.parse(r.body) } catch { return [] }
  if (!container || typeof container !== 'object') return []
  const nums = Object.keys(container)
    .filter(k => /^\d+(\+link)?$/.test(k))
    .sort((a, b) => parseInt(a, 10) - parseInt(b, 10))
  return Promise.all(nums.map(async k => {
    if (!k.endsWith('+link')) return container[k]
    const sub = await text(`/~meta@1.0/info/${key}/${parseInt(k, 10)}?accept=application/json&accept-bundle`, { json: true })
    try { return JSON.parse(sub.body) } catch { return undefined }
  }))
}

/**
 * Discover the contract ids from the node itself rather than hard-coding them, so
 * this tracks respawns the same way the jobspec's Consul templating does.
 */
async function discoverProcesses (): Promise<string[]> {
  const routes = (await listOf('p4-non-chargable-routes')).map((r: any) => r?.template)
  const ids = routes
    .filter((t: any) => typeof t === 'string')
    .map((t: string) => t.replace(/^\^\//, '').replace(/~process@1\.0\/\((?:[a-z|]+)\)$/, ''))
    .filter((t: string) => /^[A-Za-z0-9_-]{43}$/.test(t))
  return [...new Set(ids)]
}

/** Identify a contract from the shape of its own state, not from route order. */
function classify (dump: any): string | undefined {
  if (dump == null || typeof dump !== 'object') return undefined
  if ('verifiedHardware' in dump || 'registrationCredits' in dump) return 'operator-registry'
  if ('Shares' in dump && 'Rewarded' in dump) return 'staking-rewards'
  if ('TotalFingerprintReward' in dump) return 'relay-rewards'
  return undefined
}

const slotOf = async (pid: string): Promise<number> => {
  const r = await text(`/${pid}~process@1.0/slot/current`, { ms: 60_000 })
  const n = parseInt(r.body.trim(), 10)
  if (!Number.isFinite(n)) throw new Error(`slot/current unreadable for ${pid}: ${r.status} ${r.body.slice(0, 80)}`)
  return n
}

/**
 * Bracketed capture. See the Consistency note above - a pinned-slot read is not an
 * option, so we prove the slot did not move across the dump instead.
 */
async function captureConsistent (pid: string, attempts = 4) {
  let last = ''
  for (let i = 1; i <= attempts; i++) {
    const before = await slotOf(pid)
    const t0 = Date.now()
    const r = await text(`/${pid}~process@1.0/as/dump`, { json: true })
    const ms = Date.now() - t0
    if (r.status !== 200) { last = `HTTP ${r.status}`; continue }
    const after = await slotOf(pid)
    if (before === after) return { slot: before, body: r.body, ms }
    last = `slot moved ${before} -> ${after}`
    console.log(`    attempt ${i}: ${last}, retrying`)
  }
  throw new Error(`could not capture a consistent dump after ${attempts} attempts (${last})`)
}

/**
 * The anchor. Find the assignment this node published for exactly this slot.
 *
 * Absent is a legitimate answer, not an error: every slot written before the D21 fix
 * has no assignment on chain. We record that explicitly rather than pretending the
 * snapshot is anchored when it is not.
 */
async function findAnchor (pid: string, slot: number) {
  const query = {
    query: `{ transactions(tags:[
      {name:"process",values:["${pid}"]},
      {name:"type",values:["Assignment"]},
      {name:"slot",values:["${slot}"]}
    ], first:5) { edges { node { id tags{name value} } } } }`,
  }
  try {
    const res = await fetch(`${GATEWAY}/graphql`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(query),
      signal: AbortSignal.timeout(60_000),
    })
    const j: any = await res.json()
    const edge = j?.data?.transactions?.edges?.[0]
    if (!edge) return { assignment: null, baseHashpath: null, reason: 'no assignment on Arweave for this slot (pre-D21 slot, or not yet indexed)' }
    const tags: Record<string, string> = {}
    for (const t of edge.node.tags) tags[t.name] = t.value
    return { assignment: edge.node.id, baseHashpath: tags['base-hashpath'] ?? null, reason: null }
  } catch (e: any) {
    return { assignment: null, baseHashpath: null, reason: `gateway query failed: ${e?.message ?? e}` }
  }
}

async function moduleOf (pid: string): Promise<string | null> {
  const r = await text(`/${pid}~process@1.0/module`, { ms: 60_000 })
  const v = r.body.trim()
  return r.status === 200 && /^[A-Za-z0-9_-]{43}$/.test(v) ? v : null
}

async function main () {
  const nodeAddr = (await text('/~meta@1.0/info/address', { ms: 30_000 })).body.trim()
  console.log(`env=${env} host=${HOST} node=${nodeAddr}`)

  const pids = await discoverProcesses()
  if (!pids.length) throw new Error('discovered no process ids from p4-non-chargable-routes')
  console.log(`discovered ${pids.length} process id(s)\n`)

  mkdirSync(OUT, { recursive: true })
  const manifest: any[] = []

  for (const pid of pids) {
    const cap = await captureConsistent(pid)
    const contract = classify(JSON.parse(cap.body))
    if (!contract) { console.log(`  ${pid}  UNRECOGNISED state shape, skipped`); continue }
    if (ONLY && contract !== ONLY) continue

    const raw = Buffer.from(cap.body, 'utf8')
    const gz = gzipSync(raw, { level: 9 })
    const sha = createHash('sha256').update(raw).digest('hex')
    const [mod, anchor] = await Promise.all([moduleOf(pid), findAnchor(pid, cap.slot)])

    const stem = `${env}-${contract}-slot${cap.slot}`
    writeFileSync(join(OUT, `${stem}.json.gz`), gz)

    // These become the ANS-104 tags verbatim. Lowercase, matching native convention.
    const tags: Record<string, string> = {
      'data-protocol': 'anyone-protocol',
      'type': 'state-snapshot',
      'schema': SCHEMA,
      'env': env,
      'contract': contract,
      'process': pid,
      'slot': String(cap.slot),
      'state-sha256': sha,
      'state-bytes': String(raw.length),
      'content-type': 'application/json',
      'content-encoding': 'gzip',
      'captured-at': new Date().toISOString(),
      'node': nodeAddr,
    }
    if (mod) tags['module'] = mod
    if (anchor.assignment) {
      tags['anchor-assignment'] = anchor.assignment
      if (anchor.baseHashpath) tags['anchor-base-hashpath'] = anchor.baseHashpath
    }

    const meta = { schema: SCHEMA, tags, data: `${stem}.json.gz`, dataBytes: gz.length, anchored: !!anchor.assignment, anchorReason: anchor.reason }
    writeFileSync(join(OUT, `${stem}.meta.json`), JSON.stringify(meta, null, 2) + '\n')
    manifest.push(meta)

    const pct = ((gz.length / raw.length) * 100).toFixed(1)
    console.log(`  ${contract.padEnd(18)} slot=${String(cap.slot).padEnd(6)} ${(raw.length / 1048576).toFixed(2)} MiB -> ${(gz.length / 1048576).toFixed(2)} MiB gz (${pct}%)  ${cap.ms} ms`)
    console.log(`    sha256 ${sha}`)
    console.log(`    anchor ${anchor.assignment ?? `NONE - ${anchor.reason}`}`)
  }

  writeFileSync(join(OUT, 'manifest.json'), JSON.stringify({ env, host: HOST, node: nodeAddr, capturedAt: new Date().toISOString(), snapshots: manifest }, null, 2) + '\n')
  const unanchored = manifest.filter(m => !m.anchored).length
  console.log(`\nwrote ${manifest.length} snapshot(s) to ${OUT}/`)
  if (unanchored) console.log(`WARNING: ${unanchored} snapshot(s) are UNANCHORED - publishing them still leaves the chain rootless`)
}

main().catch(e => { console.error(`\nFAILED: ${e?.message ?? e}`); process.exit(1) })
