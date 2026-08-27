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

const KEY = requireDeployerKey()
const SIGNER_ADDR = new Wallet(KEY).address
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

;(async () => {
  console.log(`\n=== D24: does a self-hosted bundle's DATA land? ===`)
  console.log(`node    : ${URL_BASE}`)
  console.log(`signer  : ${SIGNER_ADDR}`)
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
  const signer = new EthereumSigner(KEY)
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
  ok('bundler accepted the item', res.status >= 200 && res.status < 300, `HTTP ${res.status}`)
  ok('response is JSON, not the Hyperbuddy HTML page', isJson,
    isJson ? `${bodyText.length} B` : `got ${JSON.stringify(bodyText.slice(0, 80))}`)
  if (res.status === 400) {
    console.error(`\nA 400 here usually means ${SIGNER_ADDR} is not on this node's faff allow-list.`)
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
    // `data.size > 0` matters: the node's address also signs plain AR TRANSFERS, which carry no
    // data and return 200 with an empty body from /raw. Treating one as our bundle would report
    // a landing that never happened. Verified against dev's history, where every transfer shows
    // data.size 0 and the two real bundles show 2,000 and 13,729.
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
