/**
 * D22 - publish state snapshots to Arweave through the node's own ~bundler@1.0.
 *
 * Why our own bundler and not direct L1
 * -------------------------------------
 * WS-6 exists to get our durability path off Forward Research infrastructure, and D24
 * closed that: all three nodes sign and pay for their own bundles. Every scheduled message
 * and assignment already reaches Arweave that way, so publishing snapshots through the same
 * path leaves ONE upload mechanism to operate, fund and monitor instead of two.
 *
 * The objection this had to clear is that recovery finds snapshots by GraphQL TAG QUERY
 * (recover-from-arweave.ts), and a bundled data item is indexed only if a gateway chooses to
 * unbundle it. Verified against live 2026-08-28: items inside our own node-signed bundles ARE
 * tag-discoverable on arweave.net, and `transaction(id:)` reports a block height for them,
 * which is what the settlement wait below depends on.
 *
 * Consequences of the handoff, all real:
 *   - the NODE pays, from its own wallet. This signer needs no AR at all.
 *   - acceptance is not settlement. The bundler batches on an idle flush, then mines, then the
 *     gateway indexes - minutes, not seconds. A run that ends PENDING is normal, not failure.
 *   - snapshot durability now shares a failure domain with the node's own upload queue. That is
 *     the trade taken for a single mechanism, and it is exactly why D25 must cover snapshots
 *     too, not only assignments.
 *
 * Idempotency
 * -----------
 * A snapshot's value is moving the ANCHOR forward. If a process has not advanced a slot since
 * its last published snapshot, a new one carries no new information, so this refuses to pay for
 * it. That is not an edge case: live operator-registry sits at slot 8 for long stretches, and a
 * daily cadence would otherwise post byte-identical state at the same slot every day. It also
 * makes the job safe to re-run mid-cycle - a re-run re-posts nothing already on chain.
 *
 * Dedupe is on (process, slot). If a published snapshot exists for that pair but its
 * `state-sha256` DIFFERS, that is not a duplicate - it means the same slot produced different
 * state, which is a real problem - so it is reported loudly and NOT silently skipped.
 *
 * Safety
 * ------
 * Dry-run is the DEFAULT. Posting requires --confirm and spends the NODE's AR. Publishing an
 * UNANCHORED snapshot is refused: a snapshot with no anchor assignment leaves the
 * published chain rootless, which is the exact defect D22 exists to close, so paying to
 * store one would buy a false sense of durability.
 *
 * ⚠️ Run this from the NOMAD JOB, not a workstation. The signer must be the account we
 * publish from, and its key belongs in Vault.
 *
 * Usage:
 *   bun run scripts/publish-snapshot.ts <snapshotDir>                    # dry run
 *   PUBLISH_JWK=<json> bun run scripts/publish-snapshot.ts <dir> --confirm
 *
 * Env:
 *   PUBLISH_JWK   Arweave JWK (JSON, or a path to one). SIGNS the data item and nothing else -
 *                 it does not pay, so it needs no balance. Required for --confirm.
 *   BUNDLER       base URL of the node whose ~bundler@1.0 takes the upload. Defaults to
 *                 http://$SNAPSHOT_HOST, which is what the periodic job resolves from Consul.
 *                 The route is p4-exempt and refused at the edge, so this must be an
 *                 in-cluster address, never the public host.
 *   GATEWAY       gateway for dedupe, size pricing and settlement checks.
 */
import Arweave from 'arweave'
import { createData, ArweaveSigner } from '@dha-team/arbundles'
import { readFileSync, readdirSync } from 'node:fs'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const argv = process.argv.slice(2)
const flag = (n: string) => { const i = argv.indexOf(n); return i >= 0 ? (argv[i + 1] ?? '') : undefined }
const has = (n: string) => argv.includes(n)
const DIR = argv.find(a => !a.startsWith('--') && a !== flag('--wait'))
const CONFIRM = has('--confirm')
const FORCE = has('--force')
const ALLOW_UNANCHORED = has('--allow-unanchored')
const WAIT_S = Number(flag('--wait') ?? 900)
const GATEWAY = (process.env.GATEWAY || 'https://arweave.net').replace(/\/$/, '')
const BUNDLER = (process.env.BUNDLER
  || (process.env.SNAPSHOT_HOST ? `http://${process.env.SNAPSHOT_HOST}` : '')).replace(/\/$/, '')

if (!DIR) {
  console.error('usage: bun run scripts/publish-snapshot.ts <snapshotDir> [--confirm] [--wait 900]')
  process.exit(2)
}

const url = new URL(GATEWAY)
const arweave = Arweave.init({
  host: url.hostname,
  port: url.port || (url.protocol === 'https:' ? 443 : 80),
  protocol: url.protocol.replace(':', ''),
  timeout: 120_000,
})

const ar = (winston: string) => (Number(winston) / 1e12).toFixed(8)

function loadJwk (): any {
  const raw = process.env.PUBLISH_JWK
  if (!raw) throw new Error('PUBLISH_JWK is not set - required to sign the data item')
  const text = existsSync(raw) ? readFileSync(raw, 'utf8') : raw
  const jwk = JSON.parse(text)
  if (!jwk.n || !jwk.d) throw new Error('PUBLISH_JWK does not look like an Arweave JWK')
  return jwk
}

/**
 * Is there already a published snapshot for this exact (process, slot)?
 * Returns the id when it is a true duplicate, 'conflict' when one exists with a different
 * state digest, or null when there is nothing published for that slot.
 */
async function alreadyPublished (pid: string, slot: string, sha: string): Promise<{ id: string, conflict: boolean } | null> {
  const res = await fetch(`${GATEWAY}/graphql`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query: `{ transactions(tags:[
      {name:"process",values:["${pid}"]},
      {name:"type",values:["state-snapshot"]},
      {name:"slot",values:["${slot}"]}
    ], first:5) { edges { node { id tags{name value} } } } }` }),
    signal: AbortSignal.timeout(45_000),
  })
  if (!res.ok) return null
  const j: any = await res.json()
  const edge = j?.data?.transactions?.edges?.[0]
  if (!edge) return null
  const tags: Record<string, string> = Object.fromEntries(edge.node.tags.map((t: any) => [t.name, t.value]))
  return { id: edge.node.id, conflict: tags['state-sha256'] !== sha }
}

/** Only the GraphQL index says a transaction settled. The data endpoint does not. */
async function settled (id: string): Promise<boolean> {
  const res = await fetch(`${GATEWAY}/graphql`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query: `{ transaction(id:"${id}") { id block { height } } }` }),
    signal: AbortSignal.timeout(45_000),
  })
  if (!res.ok) return false
  const j: any = await res.json()
  return !!j?.data?.transaction?.block?.height
}

async function main () {
  const metas = readdirSync(DIR!).filter(f => f.endsWith('.meta.json')).sort()
  if (!metas.length) throw new Error(`no .meta.json files in ${DIR}`)

  const items = metas.map(m => {
    const meta = JSON.parse(readFileSync(join(DIR!, m), 'utf8'))
    return { meta, data: readFileSync(join(DIR!, meta.data)) as Buffer, file: m }
  })

  const unanchored = items.filter(i => !i.meta.anchored)
  if (unanchored.length && !ALLOW_UNANCHORED) {
    console.error(`REFUSING to publish ${unanchored.length} UNANCHORED snapshot(s):`)
    for (const u of unanchored) console.error(`  ${u.file} - ${u.meta.anchorReason}`)
    console.error('\nAn unanchored snapshot leaves the published chain rootless, which is the defect')
    console.error('D22 closes. Wait for the slot\'s assignment to be indexed, or pass --allow-unanchored')
    console.error('if you deliberately want an unanchored archival copy.')
    process.exit(1)
  }

  console.log(`gateway=${GATEWAY}  snapshots=${items.length}  mode=${CONFIRM ? 'PUBLISH' : 'DRY RUN'}\n`)

  let totalWinston = 0n
  let conflicts = 0
  const priced: { item: typeof items[0], price: string }[] = []
  for (const item of items) {
    const t = item.meta.tags
    const dup = FORCE ? null : await alreadyPublished(t.process, t.slot, t['state-sha256'])
    if (dup && !dup.conflict) {
      console.log(`  ${String(t.contract).padEnd(18)} slot=${String(t.slot).padEnd(6)} SKIP - already published as ${dup.id}`)
      continue
    }
    if (dup && dup.conflict) {
      conflicts++
      console.log(`  ${String(t.contract).padEnd(18)} slot=${String(t.slot).padEnd(6)} CONFLICT - ${dup.id} has the same slot but a DIFFERENT state digest`)
      continue
    }
    const price = await arweave.transactions.getPrice(item.data.length)
    totalWinston += BigInt(price)
    priced.push({ item, price })
    console.log(`  ${String(t.contract).padEnd(18)} slot=${String(t.slot).padEnd(6)} ${(item.data.length / 1048576).toFixed(3)} MiB  ${ar(price)} AR`)
    console.log(`    anchor ${t['anchor-assignment'] ?? 'NONE'}`)
  }
  if (conflicts) {
    console.error(`\n${conflicts} CONFLICT(S): a published snapshot names the same (process, slot) with a different`)
    console.error('state digest. That means one slot produced two different states, which is a correctness')
    console.error('problem, not a duplicate. Investigate before publishing; --force overrides.')
    process.exit(1)
  }
  if (!priced.length) {
    console.log('\nnothing to publish - every snapshot is already on chain at its slot')
    return
  }
  console.log(`\n  TOTAL ${ar(totalWinston.toString())} AR for ${priced.length} item(s) - ESTIMATE of what the NODE pays`)

  if (!CONFIRM) {
    console.log('\nDRY RUN - nothing posted. Re-run with --confirm (and PUBLISH_JWK set) to publish.')
    return
  }

  if (!BUNDLER) {
    throw new Error('BUNDLER (or SNAPSHOT_HOST) is not set - required to know where to upload')
  }
  const jwk = loadJwk()
  const signer = new ArweaveSigner(jwk)
  const addr = await arweave.wallets.jwkToAddress(jwk)
  console.log(`\n  signer  ${addr} (signs the item; the node pays for the bundle)`)
  console.log(`  bundler ${BUNDLER}`)

  const published: { contract: string, slot: string, id: string }[] = []
  for (const { item } of priced) {
    // The snapshot's tags are already lowercase and unique, which is what lets dev_codec_ans104
    // re-encode the stored item bit-exact for signature verification on later reads.
    const di = createData(item.data, signer, {
      tags: Object.entries(item.meta.tags).map(([name, value]) => ({ name, value: String(value) })),
    })
    await di.sign(signer)

    // `Accept: application/json` is REQUIRED. Without it the node answers the POST with the
    // Hyperbuddy HTML UI and HTTP 200, which reads as success and is not.
    const res = await fetch(`${BUNDLER}/~bundler@1.0/tx`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/ans104',
        'codec-device': 'ans104@1.0',
        'Accept': 'application/json',
      },
      body: di.getRaw(),
      signal: AbortSignal.timeout(300_000),
    })
    const body = (await res.text()).replace(/\s+/g, ' ')
    if (!res.ok || !body.includes('"id"')) {
      throw new Error(`bundler REFUSED ${item.meta.tags.contract} - HTTP ${res.status}: ${body.slice(0, 200)}`)
    }
    console.log(`  ${item.meta.tags.contract} accepted ${di.id} (queued - NOT yet on chain)`)
    published.push({ contract: item.meta.tags.contract, slot: item.meta.tags.slot, id: di.id })
  }

  console.log(`\nwaiting up to ${WAIT_S}s for GraphQL settlement (a 200 from the data endpoint is NOT settlement)`)
  console.log('the bundler batches on an idle flush, then mines, then the gateway indexes - minutes')
  const deadline = Date.now() + WAIT_S * 1000
  const pending = new Set(published.map(p => p.id))
  while (pending.size && Date.now() < deadline) {
    for (const id of [...pending]) if (await settled(id)) { pending.delete(id); console.log(`  settled ${id}`) }
    if (pending.size) await new Promise(r => setTimeout(r, 15_000))
  }

  console.log('')
  for (const p of published) {
    console.log(`  ${p.contract.padEnd(18)} slot=${String(p.slot).padEnd(6)} ${p.id}  ${pending.has(p.id) ? 'PENDING' : 'settled'}`)
  }
  if (pending.size) {
    // Every item here was ACCEPTED by the bundler; the node owns landing it from this point.
    // Exiting non-zero would mark a routine slow flush as a failed job and train the operator
    // to ignore it. Settlement is D25's job, not this one's - it has to watch for the case
    // where an accepted item never lands, which is the 2026-08-27 failure class.
    console.log(`\n${pending.size} item(s) accepted but not yet indexed - NORMAL for a bundled upload.`)
    console.log('Confirm later with:')
    for (const id of pending) console.log(`  bun run scripts/verify-snapshot.ts --published ${id}`)
    return
  }
  console.log('\nVerify each with:  bun run scripts/verify-snapshot.ts --published <id>')
}

main().catch(e => { console.error(`\nFAILED: ${e?.message ?? e}`); process.exit(1) })
