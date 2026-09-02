// D24 ACCEPTANCE — does a self-hosted bundle's DATA actually land on Arweave?
//
// This is the only question D24 turns on, and it has been answered wrongly three times, so the
// probe is built around the two things that made those answers wrong.
//
// 1. THE HEADER LANDING IS NOT THE DATA LANDING. The failure mode is that the node signs, prices
//    and successfully MINES the bundle transaction, and then every chunk POST is refused
//    `400 data_root_not_found` because the proofs' data_size disagrees with the header's. The
//    transaction is real, paid for, and indexed. Its data is not there.
//
//    So `/tx/<id>/status` and `/tx/<id>/offset` are USELESS here — both look perfectly healthy for
//    a bundle whose data never landed, because they only reflect the header being indexed. The one
//    probe validated against a known-good control is:
//
//        GET https://arweave.net/raw/<txid>   ->  200 and EXACTLY data_size bytes
//
//    A failed bundle 404s. A short body is also a failure, which is why the length is compared
//    rather than just the status.
//
// 2. A 200 IS NOT NECESSARILY AN ANSWER. Posting to `~bundler@1.0/tx` WITHOUT
//    `accept: application/json` returns the Hyperbuddy HTML UI with HTTP 200. That has fooled this
//    project twice. The header is sent, and the response is asserted to be JSON.
//
// CONTROL, measured on dev 2026-08-26 BEFORE the fix was deployed, which is what makes a later
// pass meaningful rather than merely green: of the ten transactions dev's node has ever signed,
// the two carrying data (2,000 B and 13,729 B) both return 404 from /raw — mined, paid for, data
// absent. The other eight are plain AR transfers with data.size 0, which correctly return 200 and
// an empty body. So this probe demonstrably distinguishes a landed bundle from a lost one on the
// exact node and wallet under test.
//
// HOW THE BUNDLE IS FOUND. The node does not tell the client which L1 transaction its item ended
// up in, and reading that from the node's logs needs cluster access. Instead the node's own
// Arweave address is watched over GraphQL: the newest transaction it owns is recorded BEFORE the
// item is posted, and the probe waits for a new one to appear. That makes the probe self-service
// and, more importantly, means the transaction it checks is one this run actually caused.
//
// TIMING. With `bundler-max-items` unset the defaults are large (1000 items / 100 MB) and a small
// batch only flushes on the idle timer, which is minutes. That is deliberate here: the point is to
// exercise the production path, not a special-cased one. Budget ~10 minutes and do not read a
// timeout as a failure — it is reported as INCONCLUSIVE, because "no bundle appeared" and "the
// bundle appeared and its data is missing" are completely different findings.
//
// Usage:
//   bun run scripts/probe/bundler-landing.ts dev
//   bun run scripts/probe/bundler-landing.ts --url https://hb-dev.anyone.tech --wait 900
//   CONTROL=<txid> bun run scripts/probe/bundler-landing.ts dev   # also re-verify the probe
//                                                                 # itself against a known-good tx
//
// Env: DEPLOYER_PRIVATE_KEY — must be on the target node's faff allow-list, or the POST 400s.
import { EthereumSigner, createData } from '@dha-team/arbundles'
import { Wallet } from 'ethers'
import { requireDeployerKey } from '../util/helpers'

const argv = process.argv.slice(2)
const opt = (n: string, d = '') => { const i = argv.indexOf(n); return i >= 0 ? (argv[i + 1] ?? d) : d }
const ENVS: Record<string, string> = {
  dev: 'https://hb-dev.anyone.tech',
  stage: 'https://hb-stage.anyone.tech',
  live: 'https://hb.anyone.tech',
}
const envArg = argv.find(a => !a.startsWith('--'))
const URL_BASE = opt('--url') || (envArg ? ENVS[envArg] : '')
const WAIT_S = Number(opt('--wait', '900'))
const GATEWAY = opt('--gateway', 'https://arweave.net')

if (!URL_BASE) {
  console.error('usage: bundler-landing.ts <dev|stage|live> | --url <base>  [--wait <seconds>]')
  process.exit(2)
}

// Resolved lazily: PASSIVE mode signs nothing, and a locked node is exactly where the deployer
// key is least likely to be to hand.
let _key: string | null = null
const key = () => (_key ??= requireDeployerKey())
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

let pass = 0, fail = 0, inconclusive = 0
const ok = (what: string, cond: boolean, detail = '') => {
  console.log(`  ${cond ? 'PASS ' : 'FAIL '} ${what}${detail ? ' — ' + detail : ''}`)
  cond ? pass++ : fail++
}
const note = (what: string, detail = '') => {
  console.log(`  ????  ${what}${detail ? ' — ' + detail : ''}`)
  inconclusive++
}

/** Newest L1 transactions owned by an address, newest first. */
async function txsOwnedBy (owner: string, first = 5): Promise<Array<{ id: string, size: number, ts: number }>> {
  const query = {
    query: `{ transactions(owners: ["${owner}"], first: ${first}, sort: HEIGHT_DESC) {
      edges { node { id data { size } block { timestamp } } } } }`,
  }
  const res = await fetch(`${GATEWAY}/graphql`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(query),
    signal: AbortSignal.timeout(60_000),
  })
  if (!res.ok) throw new Error(`graphql ${res.status}`)
  const body = await res.json() as any
  return (body?.data?.transactions?.edges ?? []).map((e: any) => ({
    id: e.node.id,
    size: Number(e.node.data?.size ?? 0),
    ts: Number(e.node.block?.timestamp ?? 0),
  }))
}

/**
 * THE probe. Returns the byte length actually served, or null on a non-200.
 * Deliberately reads the whole body: the failure being tested for is a SHORT or absent body, and
 * a HEAD request or a status check cannot see it.
 */
async function rawBytes (txid: string): Promise<number | null> {
  const res = await fetch(`${GATEWAY}/raw/${txid}`, { signal: AbortSignal.timeout(120_000) })
  if (!res.ok) return null
  return (await res.arrayBuffer()).byteLength
}

/** Forward Research's uploader — what `bundler-ans104` defaults to. Not us. */
const FR_UPLOADER = 'FPjbN_btYKzcf8QASjs30v5C0FPv7XpwKXENBW8dqVw'

/** The node's configured `bundler-ans104`, read once at startup. */
let UPLOADER: string | undefined

async function graphql (query: string): Promise<any> {
  const res = await fetch(`${GATEWAY}/graphql`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query }),
    signal: AbortSignal.timeout(60_000),
  })
  if (!res.ok) throw new Error(`graphql ${res.status}`)
  return (await res.json() as any)?.data
}

/** The node's own newest ANS-104 assignment data items, newest first. */
async function newestAssignments (owner: string, first = 5) {
  const d = await graphql(`{ transactions(
      owners: ["${owner}"],
      tags: [{ name: "type", values: ["Assignment"] }],
      first: ${first}, sort: HEIGHT_DESC
    ) { edges { node { id bundledIn { id } tags { name value } } } } }`)
  return (d?.transactions?.edges ?? []).map((e: any) => ({
    id: e.node.id,
    bundledIn: e.node.bundledIn?.id as string | undefined,
    tags: Object.fromEntries((e.node.tags ?? []).map((t: any) => [t.name, t.value])) as Record<string, string>,
  }))
}

/** Walk `bundledIn` to the L1 root and report who signed it. Bundles can nest. */
async function bundleRoot (id: string): Promise<{ root: string, owner: string, size: number, depth: number } | null> {
  let cur = id
  for (let depth = 0; depth < 8; depth++) {
    const d = await graphql(`{ transaction(id: "${cur}") { id owner { address } data { size } bundledIn { id } } }`)
    const tx = d?.transaction
    if (!tx) return null
    if (!tx.bundledIn?.id) {
      return { root: tx.id, owner: tx.owner?.address ?? '', size: Number(tx.data?.size ?? 0), depth }
    }
    cur = tx.bundledIn.id
  }
  return null
}

/**
 * PASSIVE mode — for a node whose bundler route is not publicly reachable (stage, live).
 *
 * Writes nothing and posts nothing. It reads what the node has ALREADY published and answers the
 * two questions that matter, in order:
 *
 *   1. WHO bundled it. Every assignment is an ANS-104 data item signed by the node; the L1
 *      transaction it ends up inside is signed by whoever ran the bundler. Walking `bundledIn` to
 *      the root and reading that root's owner distinguishes self-hosted bundling from
 *      `up.arweave.net` with no ambiguity — and it is the only check that does. A node can be
 *      publishing perfectly while Forward Research does all the bundling.
 *   2. Whether the DATA landed, by the same `/raw/<txid>` probe the active path uses.
 *
 * ⚠️ It judges what the node published RECENTLY, which is a weaker claim than the active path's
 * "this run caused this transaction". After changing a node's bundler config, wait for fresh
 * assignments before reading anything into the answer.
 */
async function passive (nodeAddr: string, uploader: string | undefined): Promise<never> {
  console.log(`\n[P1] the node's newest assignment data items`)
  const items = await newestAssignments(nodeAddr, 5).catch(e => { console.error(String(e)); return [] as any[] })
  if (items.length === 0) {
    note('the node has published no assignments',
      'nothing to judge — either publishing is broken or the gateway has not indexed anything yet')
    console.log(`\n${pass} passed, ${fail} failed, ${inconclusive} inconclusive`)
    process.exit(2)
  }
  for (const it of items.slice(0, 3)) {
    console.log(`  ${it.id}  process ${(it.tags.process ?? '?').slice(0, 12)}…  slot ${it.tags.slot ?? '?'}`)
  }

  const newest = items[0]
  ok('the newest assignment is bundled', !!newest.bundledIn,
    newest.bundledIn ? `bundledIn ${newest.bundledIn}` : 'no bundledIn — it is not inside any bundle')
  if (!newest.bundledIn) {
    console.log(`\n${pass} passed, ${fail} failed`)
    process.exit(1)
  }

  console.log(`\n[P2] who signed the L1 bundle it ended up in?`)
  const root = await bundleRoot(newest.bundledIn)
  if (!root) {
    note('could not walk bundledIn to an L1 root', 'gateway did not resolve the chain')
    console.log(`\n${pass} passed, ${fail} failed, ${inconclusive} inconclusive`)
    process.exit(2)
  }
  const who = root.owner === nodeAddr ? 'THIS NODE'
    : root.owner === FR_UPLOADER ? 'Forward Research (up.arweave.net)'
    : root.owner
  console.log(`  root ${root.root} (depth ${root.depth}, data.size ${root.size}) signed by ${who}`)

  // Judged against the CONFIGURATION, not against a fixed goal. A node pointed at up.arweave.net
  // and bundled by Forward Research is behaving correctly; calling that a failure would make the
  // probe red on every node that has not been switched over yet, and a check that is expected to
  // be red is a check nobody reads.
  const selfHosted = typeof uploader === 'string' && /127\.0\.0\.1|localhost/.test(uploader)
  if (selfHosted) {
    ok('self-bundling is CONFIGURED and IN EFFECT — this node signed the bundle', root.owner === nodeAddr,
      root.owner === nodeAddr ? nodeAddr : `configured for loopback but ${who} signed it`)
  } else {
    console.log(`  ---- self-bundling is OFF by configuration (uploader ${uploader ?? 'unset'}),`)
    console.log(`       so a third-party bundler here is expected, not a defect.`)
  }

  console.log(`\n[P3] did the data land?`)
  const bytes = await rawBytes(root.root).catch(() => null)
  ok('GET /raw/<txid> returns a body', bytes !== null && bytes > 0,
    bytes === null ? '404 — mined, but the DATA never landed' : `${bytes} B`)
  if (bytes !== null && root.size > 0) {
    ok('body length equals the transaction\'s data.size', bytes === root.size,
      `served ${bytes} B, header declares ${root.size} B`)
  }

  console.log(`\n${pass} passed, ${fail} failed${inconclusive ? `, ${inconclusive} inconclusive` : ''}`)
  if (fail === 0 && inconclusive === 0) {
    console.log(selfHosted
      ? '\nSELF-HOSTED BUNDLING IS IN EFFECT — this node signed the bundle and its data is served.'
      : '\nPUBLISHING IS HEALTHY — assignments are bundled and their data is served. Self-bundling is OFF.')
  }
  process.exit(fail === 0 && inconclusive === 0 ? 0 : 1)
}

;(async () => {
  console.log(`\n=== D24: does a self-hosted bundle's DATA land? ===`)
  console.log(`node    : ${URL_BASE}`)
    console.log(`gateway : ${GATEWAY}`)

  // The node pays with its own wallet, so that is the address whose transactions we watch.
  const nodeAddr = (await (await fetch(`${URL_BASE}/~meta@1.0/info/address`,
    { signal: AbortSignal.timeout(30_000) })).text()).trim()
  if (!/^[A-Za-z0-9_-]{43}$/.test(nodeAddr)) {
    console.error(`could not read the node's address: ${JSON.stringify(nodeAddr.slice(0, 120))}`)
    process.exit(2)
  }
  console.log(`node id : ${nodeAddr}`)

  const balW = await (await fetch(`${GATEWAY}/wallet/${nodeAddr}/balance`, { signal: AbortSignal.timeout(30_000) })).text()
  const balAR = Number(balW) / 1e12
  console.log(`balance : ${balAR.toFixed(6)} AR`)

  // Which uploader this node is configured to use. On a locked node this is the difference between
  // "self-bundling is on and working" and "self-bundling is off and Forward Research is doing it",
  // and no amount of checking published assignments can tell them apart without it.
  try {
    const cfg = await (await fetch(`${URL_BASE}/~meta@1.0/info/serialize~json@1.0`,
      { signal: AbortSignal.timeout(30_000) })).json() as any
    UPLOADER = cfg?.['bundler-ans104']
    console.log(`uploader: ${UPLOADER ?? '(unset -> up.arweave.net default)'}`)
  } catch { console.log(`uploader: (could not read ~meta@1.0/info)`) }
  if (!(balAR > 0)) {
    console.error('\nthe node wallet is EMPTY — every chunk POST will fail for insufficient funds,')
    console.error('which is not the defect under test. Fund it before reading anything into a failure.')
    process.exit(2)
  }

  // A known-good control makes the probe falsifiable: if the control does not come back 200 with
  // its full body, the gateway or this code is broken and a 404 on our own bundle proves nothing.
  if (process.env.CONTROL) {
    console.log(`\n[0] control transaction (proves the probe can detect success at all)`)
    const [ctl] = await txsOwnedBy('', 1).catch(() => [] as any[])
    void ctl
    const n = await rawBytes(process.env.CONTROL)
    ok('control /raw returns a body', n !== null && n > 0, n === null ? '404' : `${n} B`)
  }

  console.log(`\n[1] baseline: newest transactions the node already owns`)
  const before = await txsOwnedBy(nodeAddr, 5)
  const seen = new Set(before.map(t => t.id))
  console.log(`  ${before.length} known; newest ${before[0]?.id ?? '(none)'}`)

  console.log(`\n[2] post one signed item to the node's own bundler`)
  const signer = new EthereumSigner(key())
  const payload = Buffer.from(`d24-bundler-landing ${new Date().toISOString()} ${'x'.repeat(2048)}`)
  const item = createData(payload, signer, {
    tags: [
      { name: 'Content-Type', value: 'text/plain' },
      { name: 'App-Name', value: 'anyone-d24-probe' },
    ],
  })
  await item.sign(signer)

  // accept: application/json is NOT optional — without it this returns the Hyperbuddy HTML UI
  // with HTTP 200, which reads as success.
  const res = await fetch(`${URL_BASE}/~bundler@1.0/tx`, {
    method: 'POST',
    headers: {
      'content-type': 'application/ans104',
      'codec-device': 'ans104@1.0',
      accept: 'application/json',
    },
    body: item.getRaw(),
    signal: AbortSignal.timeout(120_000),
  })
  const bodyText = await res.text()
  const isJson = (() => { try { JSON.parse(bodyText); return true } catch { return false } })()

  // A LOCKED EDGE answers 403 here and that is CORRECT: stage and live have no nginx location for
  // `~bundler@1.0`, so it falls through to `location / { return 403; }` and the request never
  // reaches the node. The active probe simply cannot run there, and pretending otherwise is how
  // this probe reported 4/4 green on a node whose self-bundling was broken. Switch to observing
  // what the node bundles ON ITS OWN instead — see passive() below.
  if (res.status === 403) {
    console.log(`  HTTP 403 from the edge — ~bundler@1.0 is not publicly routed on this node.`)
    console.log(`  Falling back to PASSIVE mode: judging the node's own assignment uploads.`)
    return passive(nodeAddr, UPLOADER)
  }

  ok('bundler accepted the item', res.status >= 200 && res.status < 300, `HTTP ${res.status}`)
  ok('response is JSON, not the Hyperbuddy HTML page', isJson,
    isJson ? `${bodyText.length} B` : `got ${JSON.stringify(bodyText.slice(0, 80))}`)
  if (res.status === 400) {
    console.error(`\nA 400 here usually means ${new Wallet(key()).address} is not on this node's allow-list.`)
    process.exit(1)
  }
  if (fail) { console.log(`\n${pass} passed, ${fail} failed`); process.exit(1) }
  console.log(`  item ${item.id}  (${payload.length} B payload)`)

  console.log(`\n[3] wait for the node to dispatch a bundle (idle flush; up to ${WAIT_S}s)`)
  const t0 = Date.now()
  let bundle: { id: string, size: number } | null = null
  while ((Date.now() - t0) / 1000 < WAIT_S) {
    await sleep(15_000)
    const now = await txsOwnedBy(nodeAddr, 5).catch(() => [] as any[])
    // `data.size > 0` matters, but NOT for the reason an earlier version of this comment gave.
    // The zero-size transactions this filter skips are not "plain AR transfers" — they are the
    // node's own ANS-104 ASSIGNMENT DATA ITEMS (`type=Assignment`, fee 0, `data.size` 0), which
    // GraphQL returns under the same owner as the L1 bundles. The filter is still right: only the
    // L1 bundle carries bytes, so only it can be checked with /raw. Verified against dev's
    // history, where the items show data.size 0 and the two real bundles show 2,000 and 13,729.
    const fresh = now.find(t => !seen.has(t.id) && t.size > 0)
    const secs = Math.round((Date.now() - t0) / 1000)
    if (fresh) { bundle = fresh; console.log(`  new transaction after ${secs}s: ${fresh.id} (data.size ${fresh.size})`); break }
    process.stdout.write(`\r  waiting… ${secs}s`)
  }
  console.log()

  if (!bundle) {
    // NOT a failure of the fix. Distinguishing this from "the data is missing" is the whole point.
    note('no new bundle transaction appeared',
      `nothing new from ${nodeAddr} in ${WAIT_S}s — the item may still be queued (default idle flush is minutes), ` +
      `or dispatch failed before signing. Check the node's logs for dispatching_bundle / task_failed_retrying.`)
    console.log(`\n${pass} passed, ${fail} failed, ${inconclusive} inconclusive`)
    console.log('INCONCLUSIVE — no bundle to judge. This says nothing about whether chunks land.')
    process.exit(2)
  }

  console.log(`\n[4] THE question: did the data land?`)
  // Retry: the header is indexed before the chunks are fully seeded, so an early 404 is expected
  // rather than conclusive. Only a persistent one is a finding.
  let bytes: number | null = null
  const deadline = Date.now() + Math.max(300, WAIT_S / 2) * 1000
  while (Date.now() < deadline) {
    bytes = await rawBytes(bundle.id).catch(() => null)
    if (bytes !== null && bytes > 0) break
    process.stdout.write(`\r  /raw/${bundle.id.slice(0, 12)}… 404, retrying`)
    await sleep(20_000)
  }
  console.log()

  ok('GET /raw/<txid> returns a body', bytes !== null && bytes > 0,
    bytes === null ? '404 — the transaction is mined but its DATA never landed' : `${bytes} B`)
  if (bytes !== null && bundle.size > 0) {
    ok('body length equals the transaction\'s data.size', bytes === bundle.size,
      `served ${bytes} B, header declares ${bundle.size} B`)
  }

  console.log(`\n${pass} passed, ${fail} failed${inconclusive ? `, ${inconclusive} inconclusive` : ''}`)
  console.log(`bundle ${bundle.id}`)
  if (fail === 0 && inconclusive === 0) {
    console.log('\nD24 SELF-HOSTED BUNDLING WORKS — chunks land and the gateway serves the full bundle.')
  } else if (fail) {
    console.log('\nD24 STILL BROKEN — the transaction exists but its data is absent or short.')
  }
  process.exit(fail === 0 && inconclusive === 0 ? 0 : 1)
})()
