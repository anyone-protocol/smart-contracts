// Publish a lua module to Arweave through a bundler, and PROVE it landed.
//
// Replaces the `bin/hb eval` + `hb_client:upload` flow in publish-native-module.ts, which
// cannot work for a self-hosted bundler: `bin/hb eval` starts a separate VM that never boots
// the hb application, so it loads NO config and always resolves `bundler-ans104` to the
// compiled-in default (https://up.arweave.net:443) no matter what the node's config.json says.
// Verified 2026-07-27: with config set to http://127.0.0.1:9999 an eval still printed
// `<<"https://up.arweave.net:443">>` and uploaded there.
//
// So publishing is done client-side over HTTP instead: sign the ans104 item here, POST it to
// whatever bundler we choose. That makes the bundler a URL, not a deployment assumption.
//
// ─── Why this script insists on verifying ────────────────────────────────────────────────────
// A bundler answers 200 with a signed receipt the moment it has QUEUED an item. That is not
// persistence. On 2026-07-27 a module accepted by up.arweave.net with a 200 receipt was still
// absent from Arweave 9 hours later: GraphQL `transaction(id:)` returned null. Worse, the
// gateway's DATA endpoint returned 200 for it — served from the bundler's optimistic cache — so
// `curl https://arweave.net/<id>` is an actively misleading check. Only the GraphQL index says
// whether a transaction settled.
//
// Three ids are in play and confusing them is the main way to get a false pass:
//   * item id      — the signed ans104 DataItem id. What the bundler receipts and what Arweave
//                    indexes. THIS is what a node must be given as `module`.
//   * hb_util:id/1 — the local-cache id from the old eval path. NOT what Arweave indexes.
//   * bundle tx id — the L1 transaction carrying the item. Settles; is not the module.
//
// Usage:
//   BUNDLER=http://bundler:8734 PUBLISH_KEY=<hex> bun run scripts/publish-module.ts <file> [...]
//   ... --verify-spawn http://fresh-node:8734   # also prove a node can SPAWN it (see below)
//   ... --wait 3600                             # seconds to wait for settlement (default 2400)
//   ... --check-only <id>                       # just re-check an id already published
//
// Env:
//   BUNDLER       bundler base url. REQUIRED, no default — pointing at up.arweave.net must be a
//                 deliberate act, not something that happens because a variable was unset.
//   PUBLISH_KEY   EVM key that signs. Must be on the bundler's faff-allow-list or it 400s
//                 ("Node will not service this request under any circumstances"). The address is
//                 printed before anything is sent.
//   GATEWAY       gateway for verification (default https://arweave.net).
import { createData, EthereumSigner } from '@dha-team/arbundles'
import { Wallet } from 'ethers'
import fs from 'node:fs'
import path from 'node:path'

const argv = process.argv.slice(2)
const flag = (name: string) => {
  const i = argv.indexOf(name)
  return i >= 0 ? (argv[i + 1] ?? '') : undefined
}
const VERIFY_SPAWN = flag('--verify-spawn')
const CHECK_ONLY = flag('--check-only')
const MANIFEST = flag('--manifest')
const RECHECK = flag('--recheck')
const WAIT_S = Number(flag('--wait') ?? 2400)
const GATEWAY = (process.env.GATEWAY || 'https://arweave.net').replace(/\/$/, '')
const VALUE_FLAGS = ['--verify-spawn', '--check-only', '--wait', '--manifest', '--recheck']
const files = argv.filter((a, i) => !a.startsWith('--') && !VALUE_FLAGS.includes(argv[i - 1] ?? ''))

// ── verification ────────────────────────────────────────────────────────────────────────────

/** The ONLY trustworthy settlement check. The data endpoint lies (optimistic cache). */
async function indexed (id: string): Promise<{ settled: boolean, bundledIn?: string }> {
  const res = await fetch(`${GATEWAY}/graphql`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: `{ transaction(id: "${id}") { id bundledIn { id } } }`,
    }),
    signal: AbortSignal.timeout(45_000),
  })
  if (!res.ok) return { settled: false }
  const j: any = await res.json().catch(() => null)
  const tx = j?.data?.transaction
  return { settled: !!tx, bundledIn: tx?.bundledIn?.id }
}

/** Reported alongside the real check purely to show the discrepancy when there is one. */
async function dataEndpoint (id: string): Promise<number> {
  try {
    const res = await fetch(`${GATEWAY}/${id}`, {
      method: 'HEAD', redirect: 'follow', signal: AbortSignal.timeout(30_000),
    })
    return res.status
  } catch { return 0 }
}

async function waitForSettlement (id: string, label: string): Promise<boolean> {
  const deadline = Date.now() + WAIT_S * 1000
  let n = 0
  process.stdout.write(`  waiting for ${label} to settle (up to ${Math.round(WAIT_S / 60)}m)`)
  while (Date.now() < deadline) {
    const { settled, bundledIn } = await indexed(id)
    if (settled) {
      console.log(`\n  SETTLED  ${id}${bundledIn ? `  (bundled in ${bundledIn})` : ''}`)
      return true
    }
    n++
    if (n % 4 === 0) process.stdout.write('.')
    await new Promise(r => setTimeout(r, 15_000))
  }
  const data = await dataEndpoint(id)
  console.log(`\n  NOT SETTLED after ${Math.round(WAIT_S / 60)}m — GraphQL still has no record.`)
  if (data === 200) {
    console.log(`  NOTE: ${GATEWAY}/${id} returns 200 anyway. That is the bundler's optimistic`)
    console.log(`  cache, NOT persistence. Do not treat it as success.`)
  }
  return false
}

/**
 * The acceptance test that actually matters: can a node that has never seen this module SPAWN
 * from it? Settlement alone does not prove that — the node resolves `module` through
 * hb_store_gateway -> hb_gateway_client:read/2, which needs the tx INDEXED, and it must be given
 * the ans104 item id specifically. Point this at a node with a cold cache.
 */
async function verifySpawnable (node: string, id: string): Promise<boolean> {
  try {
    const res = await fetch(`${node}/${id}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(120_000),
    })
    const ok = res.ok
    console.log(`  fresh node resolve: HTTP ${res.status} ${ok ? '(module is reachable by id)' : ''}`)
    return ok
  } catch (e: any) {
    console.log(`  fresh node resolve: ERROR ${e.message.slice(0, 120)}`)
    return false
  }
}

// ── check-only mode ─────────────────────────────────────────────────────────────────────────

// ── recheck mode ────────────────────────────────────────────────────────────────────────────
//
// Settlement takes hours, sometimes longer, so the useful workflow is publish-now / check-later
// rather than blocking. A manifest makes that a single command days afterwards, and records the
// SIZE against each id — which is what turns a batch into a free-tier measurement.

interface ManifestEntry { file: string, id: string, bytes: number, publishedAt: string }

if (RECHECK) {
  const entries: ManifestEntry[] = JSON.parse(fs.readFileSync(RECHECK, 'utf8'))
  console.log(`rechecking ${entries.length} item(s) from ${RECHECK}\n`)
  let settledN = 0
  const rows: Array<{ e: ManifestEntry, settled: boolean, data: number }> = []
  for (const e of entries) {
    const { settled, bundledIn } = await indexed(e.id)
    const data = await dataEndpoint(e.id)
    if (settled) settledN++
    rows.push({ e, settled, data })
    const age = ((Date.now() - Date.parse(e.publishedAt)) / 3600_000).toFixed(1)
    console.log(
      `  ${(settled ? 'SETTLED' : 'pending').padEnd(8)} ${String(Math.round(e.bytes / 1024)).padStart(6)}KB` +
      `  age ${age.padStart(6)}h  ${e.file.padEnd(22)} ${e.id}` +
      `${settled && bundledIn ? `  in ${bundledIn.slice(0, 12)}…` : ''}` +
      `${!settled && data === 200 ? '   [data 200 = optimistic cache only]' : ''}`
    )
  }
  // The free-tier boundary, if there is one, shows up as a size at which settlement stops.
  const ok = rows.filter(r => r.settled).map(r => r.e.bytes)
  const no = rows.filter(r => !r.settled).map(r => r.e.bytes)
  console.log(`\n${settledN}/${entries.length} settled`)
  if (ok.length) console.log(`  largest SETTLED : ${Math.round(Math.max(...ok) / 1024)}KB`)
  if (no.length) console.log(`  smallest pending: ${Math.round(Math.min(...no) / 1024)}KB`)
  if (ok.length && no.length && Math.max(...ok) < Math.min(...no)) {
    console.log(`  => boundary is between ${Math.round(Math.max(...ok) / 1024)}KB and ${Math.round(Math.min(...no) / 1024)}KB`)
  } else if (no.length) {
    console.log(`  => no clean size boundary yet; pending items may simply not have settled (recheck later)`)
  }
  process.exit(settledN === entries.length ? 0 : 1)
}

if (CHECK_ONLY) {
  const { settled, bundledIn } = await indexed(CHECK_ONLY)
  const data = await dataEndpoint(CHECK_ONLY)
  console.log(`id       : ${CHECK_ONLY}`)
  console.log(`graphql  : ${settled ? `SETTLED${bundledIn ? ` (bundled in ${bundledIn})` : ''}` : 'NOT INDEXED'}`)
  console.log(`data url : HTTP ${data}${data === 200 && !settled ? '  <-- optimistic cache only, NOT persistence' : ''}`)
  if (VERIFY_SPAWN) await verifySpawnable(VERIFY_SPAWN, CHECK_ONLY)
  process.exit(settled ? 0 : 1)
}

// ── publish ─────────────────────────────────────────────────────────────────────────────────

const BUNDLER = process.env.BUNDLER
if (!BUNDLER || files.length === 0) {
  console.error('usage: BUNDLER=<url> PUBLISH_KEY=<hex> bun run scripts/publish-module.ts <file.lua> [...]')
  console.error('       [--verify-spawn <node-url>] [--wait <seconds>] [--check-only <id>]')
  console.error('')
  console.error('BUNDLER has no default on purpose: publishing to up.arweave.net should be a')
  console.error('deliberate choice, not the consequence of an unset variable.')
  process.exit(2)
}
const KEY = (process.env.PUBLISH_KEY || '').replace(/^0x/, '')
if (!KEY) { console.error('PUBLISH_KEY required (must be on the bundler faff-allow-list)'); process.exit(2) }

const signer = new EthereumSigner(KEY)
console.log(`bundler : ${BUNDLER}`)
console.log(`signer  : ${new Wallet(KEY).address}`)
console.log(`gateway : ${GATEWAY}`)
console.log()

interface Published { file: string, id: string, bytes: number, publishedAt: string }
const published: Published[] = []
let failed = 0

for (const file of files) {
  const abs = path.resolve(file)
  if (!fs.existsSync(abs)) { console.log(`SKIP ${file} — not found`); failed++; continue }
  const src = fs.readFileSync(abs)
  const name = path.basename(abs, '.lua')

  // Same tag set the eval path committed. Lowercase and unique: dev_codec_ans104 skips its
  // original-tags preservation for "normal" tags, which is what lets the stored item re-encode
  // bit-exact for signature verification on later reads.
  const item = createData(src, signer, {
    tags: [
      { name: 'data-protocol', value: 'ao' },
      { name: 'variant', value: 'ao.N.1' },
      { name: 'type', value: 'module' },
      { name: 'content-type', value: 'application/lua' },
      { name: 'name', value: name },
    ],
  })
  await item.sign(signer)

  console.log(`${name}  (${(src.length / 1024).toFixed(1)}KB)`)
  console.log(`  item id: ${item.id}`)

  try {
    const res = await fetch(`${BUNDLER}/~bundler@1.0/tx`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/ans104',
        'codec-device': 'ans104@1.0',
        // Required. Without it the node returns the Hyperbuddy HTML UI with HTTP 200, which
        // reads as success and is not.
        'Accept': 'application/json',
      },
      body: item.getRaw(),
      signal: AbortSignal.timeout(300_000),
    })
    const body = (await res.text()).replace(/\s+/g, ' ')
    if (!res.ok || !body.includes('"id"')) {
      console.log(`  REFUSED HTTP ${res.status}: ${body.slice(0, 200)}`)
      if (res.status === 400) {
        console.log(`  A 400 here usually means this signer is not on the bundler's faff-allow-list.`)
      }
      failed++
      continue
    }
    console.log(`  accepted by bundler (queued — NOT yet persisted)`)
    published.push({
      file: name, id: item.id, bytes: src.length,
      publishedAt: new Date().toISOString(),
    })
  } catch (e: any) {
    console.log(`  ERROR ${e.message.slice(0, 200)}`)
    failed++
  }
}

// Write the manifest BEFORE waiting. If the wait is interrupted — or skipped entirely with
// --wait 0 — the ids must still be recoverable, or the upload is unverifiable and effectively
// lost. This is the file `--recheck` reads days later.
if (MANIFEST && published.length) {
  fs.mkdirSync(path.dirname(path.resolve(MANIFEST)), { recursive: true })
  fs.writeFileSync(MANIFEST, JSON.stringify(published, null, 2))
  console.log(`\nmanifest -> ${MANIFEST}  (recheck later: --recheck ${MANIFEST})`)
}

if (published.length === 0) {
  console.log('\nnothing was accepted; not waiting on settlement.')
  process.exit(1)
}

if (WAIT_S === 0) {
  console.log('\n--wait 0: not waiting. Nothing here is verified yet — recheck later.')
  process.exit(0)
}

console.log(`\n=== settlement ===`)
const settled: Published[] = []
for (const p of published) {
  if (await waitForSettlement(p.id, p.file)) settled.push(p)
  else failed++
}

if (VERIFY_SPAWN && settled.length) {
  console.log(`\n=== spawnability against ${VERIFY_SPAWN} ===`)
  for (const p of settled) {
    console.log(`${p.file}:`)
    if (!await verifySpawnable(VERIFY_SPAWN, p.id)) failed++
  }
}

console.log(`\n=== result ===`)
for (const p of published) {
  const ok = settled.find(s => s.id === p.id)
  console.log(`  ${ok ? 'SETTLED ' : 'PENDING '} ${p.file.padEnd(28)} ${p.id}`)
}
if (settled.length) {
  console.log(`\nMODULE_IDs for spawning (the ans104 item id, NOT hb_util:id):`)
  for (const s of settled) console.log(`  ${s.file.padEnd(28)} ${s.id}`)
}
console.log(`\n${settled.length}/${published.length} settled, ${failed} failure(s)`)
process.exit(failed ? 1 : 0)
