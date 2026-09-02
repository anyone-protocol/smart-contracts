/**
 * D22 - reconstruct a contract's state and history from Arweave alone.
 *
 * This is the half that makes publishing mean something. Given only a process id and a
 * gateway, it finds the newest anchored snapshot, verifies it, then walks the published
 * assignment chain forward from the snapshot's slot, fetching every message body. The
 * result is a recovery bundle: a verified state, plus every message needed to bring that
 * state to the head, in provable order.
 *
 * What it does NOT do, and why
 * ----------------------------
 * It does not hand a stock HyperBEAM node a process it can serve. Verified in the node
 * source at v0.9-FINAL (the tag our image is built from) and at current HEAD:
 *
 *   - `dev_scheduler_cache:read/3` resolves the path
 *     `~scheduler@1.0/assignments/<process-id>/<slot>` - a local SYMLINK - and returns
 *     `not_found` on a miss. There is no id-based or gateway fallback.
 *   - `hb_store_gateway` reads by TRANSACTION ID, and its `resolve/3` returns the key
 *     unchanged, so it cannot satisfy that path.
 *   - only three call sites create those symlinks: `dev_scheduler_server` (when that node
 *     IS the scheduler) and `dev_scheduler:cache_remote_schedule` (fed over HTTP from a
 *     remote scheduler).
 *   - `~copycat@1.0/graphql?tag=process&value=<pid>` is the near miss: it fetches and
 *     indexes exactly these transactions, but calls plain `hb_cache:write`, NOT
 *     `dev_scheduler_cache:write`, so the bytes land and the scheduler index never learns
 *     about them. It also does not exist at all in v0.9-FINAL.
 *
 * So a third party cannot cold-boot our process from Arweave on a stock node today, no
 * matter what we publish. That is a gap in the node, not in our data, and closing it is a
 * one-function upstream change. Until then this tool is the recovery path: it produces a
 * verified state and an ordered, gap-checked message history, which is what recovery
 * actually needs, and `--seed` emits a state file usable to respawn the contract.
 *
 * Usage:
 *   bun run scripts/recover-from-arweave.ts <process-id> [--out DIR] [--seed] [--max N]
 *   bun run scripts/recover-from-arweave.ts <process-id> --snapshot <dir>   # local snapshot
 */
import { createHash } from 'node:crypto'
import { gunzipSync } from 'node:zlib'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const GATEWAY = (process.env.ARWEAVE_GATEWAY || 'https://arweave.net').replace(/\/$/, '')
const argv = process.argv.slice(2)
const flag = (n: string) => { const i = argv.indexOf(n); return i >= 0 ? (argv[i + 1] ?? '') : undefined }
const VALUE_FLAGS = ['--out', '--max', '--snapshot']
const PID = argv.find((a, i) => !a.startsWith('--') && !VALUE_FLAGS.includes(argv[i - 1] ?? ''))
const OUT = flag('--out') || join('recovery', PID ?? 'unknown')
const SEED = argv.includes('--seed')
const MAX = Number(flag('--max') ?? 100_000)
const LOCAL_SNAPSHOT = flag('--snapshot')

if (!PID) {
  console.error('usage: bun run scripts/recover-from-arweave.ts <process-id> [--out DIR] [--seed] [--snapshot DIR]')
  process.exit(2)
}

async function gql (query: string): Promise<any> {
  const res = await fetch(`${GATEWAY}/graphql`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query }), signal: AbortSignal.timeout(60_000),
  })
  if (!res.ok) throw new Error(`gateway ${res.status}`)
  const j: any = await res.json()
  if (j.errors) throw new Error(JSON.stringify(j.errors).slice(0, 200))
  return j.data
}
const tagMap = (tags: any[]) => Object.fromEntries(tags.map((t: any) => [t.name, t.value])) as Record<string, string>

/** Newest anchored snapshot published for this process. */
async function findSnapshot () {
  const d = await gql(`{ transactions(
    tags:[{name:"process",values:["${PID}"]},{name:"type",values:["state-snapshot"]}],
    first:20, sort:HEIGHT_DESC
  ) { edges { node { id block{height} tags{name value} } } } }`)
  const edges = d?.transactions?.edges ?? []
  const anchored = edges
    .map((e: any) => ({ id: e.node.id, height: e.node.block?.height, tags: tagMap(e.node.tags) }))
    .filter((s: any) => s.tags['anchor-assignment'])
    .sort((a: any, b: any) => parseInt(b.tags.slot, 10) - parseInt(a.tags.slot, 10))
  return anchored[0]
}

function loadLocalSnapshot (dir: string) {
  const meta = readdirSync(dir).filter(f => f.endsWith('.meta.json'))
    .map(f => JSON.parse(readFileSync(join(dir, f), 'utf8')))
    .filter((m: any) => m.tags.process === PID)
    .sort((a: any, b: any) => parseInt(b.tags.slot, 10) - parseInt(a.tags.slot, 10))[0]
  if (!meta) throw new Error(`no snapshot for ${PID} in ${dir}`)
  return { id: `local:${meta.data}`, height: null, tags: meta.tags, gz: readFileSync(join(dir, meta.data)) as Buffer }
}

async function allAssignments (pid: string) {
  const out = new Map<number, { id: string, base: string, body: string }>()
  let after = ''
  for (let page = 0; page < 500; page++) {
    const d = await gql(`{ transactions(
      tags:[{name:"process",values:["${pid}"]},{name:"type",values:["Assignment"]}],
      first:100, sort:HEIGHT_ASC ${after ? `, after:"${after}"` : ''}
    ) { pageInfo{hasNextPage} edges { cursor node { id tags{name value} } } } }`)
    const edges = d?.transactions?.edges ?? []
    for (const e of edges) {
      const t = tagMap(e.node.tags)
      const slot = parseInt(t['slot'], 10)
      if (Number.isFinite(slot)) out.set(slot, { id: e.node.id, base: t['base-hashpath'] ?? '', body: t['body link'] ?? '' })
    }
    if (!d?.transactions?.pageInfo?.hasNextPage || !edges.length) break
    after = edges[edges.length - 1].cursor
  }
  return out
}

async function main () {
  console.log(`process ${PID}\ngateway ${GATEWAY}\n`)

  const snap = LOCAL_SNAPSHOT ? loadLocalSnapshot(LOCAL_SNAPSHOT) : await findSnapshot()
  if (!snap) {
    console.error('NO ANCHORED SNAPSHOT PUBLISHED for this process.')
    console.error('Without one there is no on-chain root for the assignment chain, so state')
    console.error('cannot be recovered from Arweave. Publish one: operations/ao/publish-snapshot-<env>.hcl')
    process.exit(1)
  }
  const t = snap.tags
  const fromSlot = parseInt(t.slot, 10)
  console.log(`snapshot  ${snap.id}`)
  console.log(`  contract ${t.contract}  env ${t.env}  slot ${fromSlot}  captured ${t['captured-at']}`)
  console.log(`  anchor   ${t['anchor-assignment']}`)

  // Verify the state before trusting a byte of it.
  const gz: Buffer = (snap as any).gz ?? Buffer.from(await (await fetch(`${GATEWAY}/raw/${snap.id}`, { signal: AbortSignal.timeout(300_000) })).arrayBuffer())
  const raw = gunzipSync(gz)
  const sha = createHash('sha256').update(raw).digest('hex')
  if (sha !== t['state-sha256']) throw new Error(`state digest MISMATCH: ${sha} != ${t['state-sha256']}`)
  console.log(`  state    ${(raw.length / 1048576).toFixed(2)} MiB, sha256 verified`)

  // The anchor must be the node's own attestation for exactly this slot.
  const ad = await gql(`{ transactions(ids:["${t['anchor-assignment']}"]) { edges { node { owner{address} tags{name value} } } } }`)
  const anode = ad?.transactions?.edges?.[0]?.node
  if (!anode) throw new Error('anchor assignment not retrievable - the snapshot is rootless')
  const at = tagMap(anode.tags)
  if (at.process !== PID || parseInt(at.slot, 10) !== fromSlot) {
    throw new Error(`anchor mismatch: names process ${at.process} slot ${at.slot}`)
  }
  console.log(`  anchor   verified (signed by ${anode.owner.address})`)

  // Walk forward. A gap or a broken link means the history is NOT provably whole, and we
  // say so rather than emitting a bundle that looks complete.
  const asn = await allAssignments(PID!)
  const slots = [...asn.keys()].filter(s => s >= fromSlot).sort((a, b) => a - b).slice(0, MAX)
  let gapAfter = -1, brokeAt = -1
  for (let i = 1; i < slots.length; i++) {
    if (slots[i] !== slots[i - 1] + 1) { gapAfter = slots[i - 1]; break }
    if (!asn.get(slots[i])!.base.endsWith(`/${asn.get(slots[i - 1])!.id}`)) { brokeAt = slots[i]; break }
  }
  console.log(`\nchain     slots ${slots[0]}..${slots[slots.length - 1]} (${slots.length})`)
  if (gapAfter >= 0) console.log(`  GAP after slot ${gapAfter} - history is NOT provably complete`)
  else if (brokeAt >= 0) console.log(`  BROKEN LINK at slot ${brokeAt} - history is NOT provably complete`)
  else console.log(`  contiguous and hash-linked (${Math.max(0, slots.length - 1)} links)`)

  // Fetch the message bodies the assignments point at.
  mkdirSync(join(OUT, 'messages'), { recursive: true })
  let fetched = 0, missing: number[] = []
  for (const s of slots) {
    const body = asn.get(s)!.body
    if (!body) { missing.push(s); continue }
    const r = await fetch(`${GATEWAY}/raw/${body}`, { signal: AbortSignal.timeout(60_000) })
    if (!r.ok) { missing.push(s); continue }
    writeFileSync(join(OUT, 'messages', `${String(s).padStart(10, '0')}-${body}.bin`), Buffer.from(await r.arrayBuffer()))
    fetched++
    if (fetched % 25 === 0) process.stdout.write(`\r  messages ${fetched}/${slots.length}   `)
  }
  console.log(`\r  messages ${fetched}/${slots.length} fetched${missing.length ? `, ${missing.length} MISSING (slots ${missing.slice(0, 5).join(',')}${missing.length > 5 ? '…' : ''})` : ''}`)

  writeFileSync(join(OUT, 'state.json'), raw)
  if (SEED) writeFileSync(join(OUT, 'seed.json'), raw)
  const complete = gapAfter < 0 && brokeAt < 0 && missing.length === 0
  writeFileSync(join(OUT, 'recovery.json'), JSON.stringify({
    process: PID, contract: t.contract, env: t.env, gateway: GATEWAY,
    snapshot: { id: snap.id, slot: fromSlot, sha256: t['state-sha256'], anchor: t['anchor-assignment'] },
    chain: { from: slots[0], to: slots[slots.length - 1], count: slots.length, gapAfter, brokeAt, missingBodies: missing },
    provablyComplete: complete,
    recoveredAt: new Date().toISOString(),
  }, null, 2) + '\n')

  console.log(`\nwrote ${OUT}/`)
  console.log(`  state.json      verified state at slot ${fromSlot}`)
  console.log(`  messages/       ${fetched} message bodies, slot-ordered`)
  console.log(`  recovery.json   provenance and completeness report`)
  console.log(`\nhistory from slot ${fromSlot} is ${complete ? 'PROVABLY COMPLETE' : 'NOT provably complete - see recovery.json'}`)
  if (!complete) process.exit(1)
}

main().catch(e => { console.error(`\nFAILED: ${e?.message ?? e}`); process.exit(1) })
