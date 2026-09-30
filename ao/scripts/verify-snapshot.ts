/**
 * D22 - prove a state snapshot actually delivers the recovery property.
 *
 * Publishing bytes is not the deliverable. The deliverable is that someone holding
 * only a process id can, from Arweave alone, obtain a state they can verify and a
 * message history they can prove is complete from that state forward. This checks
 * exactly that, and refuses to report success on any step it could not perform.
 *
 * The chain walk (check 7) is the load-bearing one. Each assignment carries
 * `base-hashpath = <accumulated hashpath>/<id of the previous slot's assignment>`, so
 * a dropped message does not merely leave a hole in the slot integers - it breaks the
 * linkage, and cannot be hidden. Walking that from the snapshot's anchor to the head
 * is what turns "we published some assignments" into "this history is provably whole".
 *
 * A snapshot taken at the head slot has nothing after it, so the linkage assertion is
 * VACUOUS at capture time and is reported as `warn`, never as a pass. It gains force as
 * slots accumulate. PERTURB=1 corrupts the expectations (never the chain) and asserts the
 * checks actually fire, so a check that has quietly gone vacuous cannot masquerade as one
 * that is holding.
 *
 * Usage:
 *   bun run scripts/verify-snapshot.ts <snapshotDir>            # local artifacts
 *   bun run scripts/verify-snapshot.ts --published <tx-id>      # a published snapshot
 *   bun run scripts/verify-snapshot.ts --chain <process-id> [fromSlot]
 *   PERTURB=1 bun run scripts/verify-snapshot.ts <snapshotDir>  # self-test
 */
import { createHash } from 'node:crypto'
import { gunzipSync } from 'node:zlib'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const GATEWAY = process.env.ARWEAVE_GATEWAY || 'https://arweave.net'

const PERTURB = process.env.PERTURB === '1'
let pass = 0, fail = 0, warn = 0
const check = (ok: boolean, label: string, detail = '') => {
  if (ok) { pass++; console.log(`  ok   ${label}${detail ? `  - ${detail}` : ''}`) }
  else { fail++; console.log(`  FAIL ${label}${detail ? `  - ${detail}` : ''}`) }
  return ok
}
/** An assertion with nothing to assert over. Never counted as a pass. */
const vacuous = (label: string, detail = '') => {
  warn++; console.log(`  warn ${label}  - VACUOUS: ${detail}`)
}

/** Walk a published assignment chain and report whether it is whole. */
function walkChain (asn: Map<number, { id: string, base: string }>, from: number) {
  const slots = [...asn.keys()].filter(s => s >= from).sort((a, b) => a - b)
  let gapAfter = -1, brokeAt = -1, links = 0
  for (let i = 1; i < slots.length; i++) {
    if (slots[i] !== slots[i - 1] + 1) { gapAfter = slots[i - 1]; break }
    const prevId = asn.get(slots[i - 1])!.id
    if (!asn.get(slots[i])!.base.endsWith(`/${prevId}`)) { brokeAt = slots[i]; break }
    links++
  }
  return { slots, gapAfter, brokeAt, links }
}

async function gql (query: string): Promise<any> {
  const res = await fetch(`${GATEWAY}/graphql`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query }),
    signal: AbortSignal.timeout(60_000),
  })
  if (!res.ok) throw new Error(`gateway ${res.status}`)
  const j: any = await res.json()
  if (j.errors) throw new Error(JSON.stringify(j.errors).slice(0, 200))
  return j.data
}

const tagMap = (tags: any[]): Record<string, string> => {
  const m: Record<string, string> = {}
  for (const t of tags) m[t.name] = t.value
  return m
}

function classify (dump: any): string | undefined {
  if (dump == null || typeof dump !== 'object') return undefined
  if ('verifiedHardware' in dump || 'registrationCredits' in dump) return 'operator-registry'
  if ('Shares' in dump && 'Rewarded' in dump) return 'staking-rewards'
  if ('TotalFingerprintReward' in dump) return 'relay-rewards'
  return undefined
}

/** Every published assignment for a process, paginated, keyed by slot. */
async function allAssignments (pid: string) {
  const out = new Map<number, { id: string, base: string }>()
  let after = ''
  for (let page = 0; page < 200; page++) {
    const d = await gql(`{ transactions(
      tags:[{name:"process",values:["${pid}"]},{name:"type",values:["Assignment"]}],
      first:100, sort:HEIGHT_ASC ${after ? `, after:"${after}"` : ''}
    ) { pageInfo{hasNextPage} edges { cursor node { id tags{name value} } } } }`)
    const edges = d?.transactions?.edges ?? []
    for (const e of edges) {
      const t = tagMap(e.node.tags)
      const slot = parseInt(t['slot'], 10)
      if (Number.isFinite(slot)) out.set(slot, { id: e.node.id, base: t['base-hashpath'] ?? '' })
    }
    if (!d?.transactions?.pageInfo?.hasNextPage || !edges.length) break
    after = edges[edges.length - 1].cursor
  }
  return out
}

async function verify (tagsIn: Record<string, string>, gz: Buffer, source: string) {
  let tags = tagsIn
  console.log(`\n=== ${tags['contract'] ?? '?'} (${tags['env'] ?? '?'}) slot ${tags['slot'] ?? '?'} - ${source} ===`)

  // 1-4: the payload is intact and is what it claims to be.
  let raw: Buffer | null = null
  try { raw = gunzipSync(gz) } catch (e: any) { /* reported below */ }
  if (!check(!!raw, 'gzip payload decompresses')) return
  if (PERTURB) tags = { ...tags, 'state-sha256': 'deadbeef'.repeat(8) }
  const sha = createHash('sha256').update(raw!).digest('hex')
  check(sha === tags['state-sha256'], 'sha256 of decompressed state matches the recorded digest', sha)
  check(String(raw!.length) === tags['state-bytes'],
    'decompressed byte length matches the recorded length', `${raw!.length} vs ${tags['state-bytes']}`)
  let dump: any = null
  try { dump = JSON.parse(raw!.toString('utf8')) } catch {}
  check(!!dump, 'state parses as JSON')
  check(!!dump && classify(dump) === tags['contract'],
    'state shape matches the declared contract', `${classify(dump)} vs ${tags['contract']}`)

  const pid = tags['process']
  const slot = parseInt(tags['slot'], 10)

  // 5-6: the anchor is real, and it is OUR node's attestation for exactly this slot.
  const anchorId = tags['anchor-assignment']
  if (!check(!!anchorId, 'snapshot names an anchor assignment')) {
    console.log('       (unanchored: the published chain has no on-chain root - see D21)')
    return
  }
  const ad = await gql(`{ transactions(ids:["${anchorId}"]) { edges { node { id owner{address} block{height} tags{name value} } } } }`)
  const anode = ad?.transactions?.edges?.[0]?.node
  if (!check(!!anode, 'anchor assignment is retrievable from Arweave', anchorId)) return
  const at = tagMap(anode.tags)
  check(at['process'] === pid, 'anchor names this process', at['process'])
  check(parseInt(at['slot'], 10) === slot, 'anchor names this slot', at['slot'])
  check(at['type'] === 'Assignment', 'anchor is an Assignment', at['type'])
  check(anode.owner.address === tags['node'],
    'anchor was signed by the node that took the snapshot', anode.owner.address)
  check(anode.block?.height != null, 'anchor is mined (not pending)', String(anode.block?.height))

  // 7: the chain from the anchor to the head is unbroken. This is the property.
  const asn = await allAssignments(pid)
  if (PERTURB) {
    // Corrupt a link so the walk MUST report a break. If it still says "whole", the
    // assertion is not doing anything and this run is meaningless.
    const target = [...asn.keys()].sort((a, b) => a - b)[1]
    if (target !== undefined) asn.set(target, { ...asn.get(target)!, base: 'perturbed/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' })
  }
  const w = walkChain(asn, slot)
  check(w.slots.length > 0 && w.slots[0] === slot, 'the anchor slot is present in the published chain',
    `head=${w.slots[w.slots.length - 1] ?? 'none'}`)
  check(w.gapAfter === -1, 'slot sequence from the anchor to the head has no gaps',
    w.gapAfter === -1 ? `${w.slots[0]}..${w.slots[w.slots.length - 1]} (${w.slots.length})` : `first gap after slot ${w.gapAfter}`)
  if (w.slots.length < 2) {
    vacuous('every assignment hash-links to its predecessor (history is tamper-evident)',
      `only slot ${slot} is published at or after the anchor, so there is no link to check yet`)
  } else {
    check(w.brokeAt === -1, 'every assignment hash-links to its predecessor (history is tamper-evident)',
      w.brokeAt === -1 ? `${w.links} links verified` : `broken at slot ${w.brokeAt}`)
  }

  // The messages themselves must be fetchable, or the history is a set of claims
  // about payloads nobody can read.
  const sample = w.slots.slice(0, 3)
  const bodies = await Promise.all(sample.map(async s => {
    const d = await gql(`{ transactions(ids:["${asn.get(s)!.id}"]) { edges { node { tags{name value} } } } }`)
    const t = tagMap(d?.transactions?.edges?.[0]?.node?.tags ?? [])
    const body = t['body link']
    if (!body) return false
    const r = await fetch(`${GATEWAY}/raw/${body}`, { signal: AbortSignal.timeout(60_000) })
    return r.ok
  }))
  check(bodies.length > 0 && bodies.every(Boolean),
    'the messages the assignments point at are retrievable from Arweave',
    `${bodies.filter(Boolean).length}/${bodies.length} sampled`)
}

async function main () {
  if (process.argv[2] === '--chain') {
    const pid = process.argv[3]
    if (!pid) { console.error('usage: --chain <process-id> [fromSlot]'); process.exit(2) }
    const from = process.argv[4] ? parseInt(process.argv[4], 10) : 0
    console.log(`=== assignment chain for ${pid} (from slot ${from}) ===`)
    const asn = await allAssignments(pid)
    if (PERTURB) {
      const target = [...asn.keys()].sort((a, b) => a - b)[1]
      if (target !== undefined) asn.set(target, { ...asn.get(target)!, base: 'perturbed/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' })
    }
    const w = walkChain(asn, from)
    check(w.slots.length > 0, 'assignments are published for this process', `${asn.size} total`)
    check(w.gapAfter === -1, 'slot sequence has no gaps',
      w.gapAfter === -1 ? `${w.slots[0]}..${w.slots[w.slots.length - 1]} (${w.slots.length})` : `first gap after slot ${w.gapAfter}`)
    if (w.slots.length < 2) vacuous('hash-linkage', 'fewer than two assignments to link')
    else check(w.brokeAt === -1, 'every assignment hash-links to its predecessor',
      w.brokeAt === -1 ? `${w.links} links verified` : `broken at slot ${w.brokeAt}`)
    console.log(`\n${fail === 0 ? 'ALL PASS' : 'FAILURES'} - ${pass} passed, ${fail} failed, ${warn} vacuous`)
    process.exit(PERTURB ? (fail > 0 ? 0 : 1) : (fail === 0 ? 0 : 1))
  }
  if (process.argv[2] === '--published') {
    const id = process.argv[3]
    if (!id) { console.error('usage: --published <tx-id>'); process.exit(2) }
    const d = await gql(`{ transactions(ids:["${id}"]) { edges { node { tags{name value} } } } }`)
    const node = d?.transactions?.edges?.[0]?.node
    if (!node) { console.error(`snapshot ${id} not found on ${GATEWAY}`); process.exit(1) }
    const res = await fetch(`${GATEWAY}/raw/${id}`, { signal: AbortSignal.timeout(300_000) })
    if (!res.ok) { console.error(`could not fetch snapshot bytes: HTTP ${res.status}`); process.exit(1) }
    await verify(tagMap(node.tags), Buffer.from(await res.arrayBuffer()), `published ${id}`)
  } else {
    const dir = process.argv[2]
    if (!dir) { console.error('usage: bun run scripts/verify-snapshot.ts <snapshotDir> | --published <tx-id>'); process.exit(2) }
    const metas = readdirSync(dir).filter(f => f.endsWith('.meta.json')).sort()
    if (!metas.length) { console.error(`no .meta.json files in ${dir}`); process.exit(1) }
    for (const m of metas) {
      const meta = JSON.parse(readFileSync(join(dir, m), 'utf8'))
      await verify(meta.tags, readFileSync(join(dir, meta.data)), `local ${m}`)
    }
  }
  console.log(`\n${fail === 0 ? 'ALL PASS' : 'FAILURES'} - ${pass} passed, ${fail} failed, ${warn} vacuous`)
  if (PERTURB) {
    console.log(fail > 0
      ? 'PERTURB: corruption WAS detected - the assertions are live'
      : 'PERTURB: corruption was NOT detected - the assertions are vacuous')
    process.exit(fail > 0 ? 0 : 1)
  }
  process.exit(fail === 0 ? 0 : 1)
}

main().catch(e => { console.error(`\nFAILED: ${e?.message ?? e}`); process.exit(1) })
