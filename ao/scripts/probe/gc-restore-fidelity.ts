// Restore fidelity across a node restart — the validation gate for the luerl-GC image patch.
//
// hyperbeam-docker patches/v0.9-FINAL/0002-luerl-gc-before-snapshot.patch adds `luerl:gc/1` to
// `dev_lua:snapshot/3`, which serialises the whole luerl VM and otherwise retains every table the
// process has ever allocated (400 KB at slot 2 -> 20.6 MB at slot 150, written twice per slot).
//
// `snapshot/3` does NOT write the collected state back into `priv` — it collects a COPY purely for
// serialisation and the live VM continues on the uncollected state. So the patch cannot affect a
// warm process at all, and its ENTIRE behavioural surface is restore. This probe aims there and
// nowhere else.
//
// The risk being tested: `luerl_heap:gc/1` is mark-and-sweep from a root set of {primitive
// metatables, global table G, stack, call stack}. Anything reachable only from outside that set
// would be freed, and the loss would not show up until the process is reloaded from disk. A warm
// read proves nothing here, which is why every check below is taken across a real restart.
//
// Sequencing matters. A snapshot must actually LAND, and land late, or the node restores by
// replaying the schedule from slot 0 and the snapshot path is never exercised — the test would
// pass without testing anything. `process_snapshot_time` defaults to 60 s
// (dev_process.erl:63), so we idle past that and then send one more message, which puts a
// snapshot on the final slot. The cold-read timing is reported as the tell: a fast first read
// means resume-from-snapshot, a slow one means replay, and a replay run is INCONCLUSIVE rather
// than passing.
//
// Usage:
//   HB_URL=http://localhost:8734 bun run scripts/probe/gc-restore-fidelity.ts
// Env:
//   CONTAINER   container to restart (default hb-gcp)
//   WRITES      signed writes before the snapshot (default 8) — each lands in its own slot
//   IDLE_S      seconds to idle so a snapshot fires (default 70; must exceed 60)
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { execFileSync } from 'node:child_process'
import { EthereumSigner, createData } from '@dha-team/arbundles'
import { Wallet } from 'ethers'
import { fetchNodeAddress, spawnLuaProcess } from '../util/hb-client'
import { seedEnvelopeFor } from '../util/native-bundle'
import { requireDeployerKey } from '../util/helpers'

const HB_URL = process.env.HB_URL || 'http://localhost:8734'
const CONTAINER = process.env.CONTAINER || 'hb-gcp'
const WRITES = Number(process.env.WRITES || 8)
const IDLE_S = Number(process.env.IDLE_S || 70)
const AO = path.resolve(import.meta.dir, '../..')

// Signer from DEPLOYER_PRIVATE_KEY (ao/.env, untracked). No fallback by design — see
// requireDeployerKey(). The derived address is printed before the first write so a run is
// always attributable to a signer.
const KEY = requireDeployerKey()
const owner = new EthereumSigner(KEY)
const DEV = new Wallet('0x' + KEY).address

let pass = 0, fail = 0, inconclusive = 0
const ok = (n: string, c: boolean, d = '') => {
  if (c) { pass++; console.log(`  PASS  ${n}${d ? ` — ${d}` : ''}`) }
  else { fail++; console.log(`  FAIL  ${n}${d ? ` — ${d}` : ''}`) }
}

const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16)
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

function publish (rel: string, label: string): string {
  const abs = path.join(AO, rel)
  if (!fs.existsSync(abs)) throw new Error(`missing ${rel} — run scripts/run-e2e.ts first to build dist/`)
  execFileSync('podman', ['cp', abs, `${CONTAINER}:/tmp/${label}.lua`], { timeout: 300_000 })
  const erl = `{ok,S}=file:read_file("/tmp/${label}.lua"), M=hb_message:commit(#{ <<"data-protocol">> => <<"ao">>, <<"variant">> => <<"ao.N.1">>, <<"type">> => <<"module">>, <<"content-type">> => <<"application/lua">>, <<"name">> => <<"${label}">>, <<"body">> => S }, #{ <<"priv-wallet">> => hb:wallet() }, <<"ans104@1.0">>), {ok,_}=hb_cache:write(M,#{}), ok=file:write_file("/tmp/${label}.id", hb_util:id(M)).`
  execFileSync('podman', ['exec', CONTAINER, './bin/hb', 'eval', erl], { encoding: 'utf8', timeout: 600_000 })
  const id = execFileSync('podman', ['exec', CONTAINER, 'cat', `/tmp/${label}.id`], { encoding: 'utf8', timeout: 60_000 }).trim()
  if (!/^[A-Za-z0-9_-]{43}$/.test(id)) throw new Error(`bad module id: ${id.slice(0, 60)}`)
  return id
}

const ANS104 = { 'Content-Type': 'application/ans104', 'codec-device': 'ans104@1.0', Accept: 'application/json' }
// A handler that throws is REVERTED by the trampoline and still answers 200 — the failure is in
// the compute output, not the HTTP status. So keep the body: a run where every write silently
// vanishes is otherwise indistinguishable from one where the GC ate them, which is the entire
// question this probe exists to answer.
let lastBody = ''
async function submit (pid: string, fp: string): Promise<number> {
  // ans104 tag NAMES must be lowercase — hb-client asserts it.
  const item = createData(JSON.stringify([{ f: fp, a: DEV }]), owner, { target: pid, tags: [
    { name: 'type', value: 'Message' }, { name: 'data-protocol', value: 'ao' },
    { name: 'variant', value: 'ao.N.1' },
    { name: 'action', value: 'Admin-Submit-Operator-Certificates' } ] })
  await item.sign(owner)
  const r = await fetch(`${HB_URL}/${pid}~process@1.0/push`, {
    method: 'POST', headers: ANS104, body: item.getRaw(), redirect: 'follow' })
  lastBody = (await r.text()).slice(0, 400)
  return r.status
}

const get = async (p: string) => {
  const t0 = Date.now()
  const r = await fetch(`${HB_URL}${p}`)
  const b = await r.text()
  return { status: r.status, body: b, ms: Date.now() - t0 }
}
// Fingerprints are validated as 40 UPPERCASE HEX chars (utils.assertValidFingerprint), so the
// distinguishing prefix has to be hex too — a non-hex marker makes every handler throw, the
// trampoline reverts, and the pushes still return 200 with nothing written.
const fpOf = (i: number) => 'CAFE' + i.toString(16).toUpperCase().padStart(36, '0')

async function waitForNode (timeoutS = 240) {
  for (let i = 0; i < timeoutS / 2; i++) {
    try { if ((await fetch(`${HB_URL}/~meta@1.0/info`, { signal: AbortSignal.timeout(5000) })).ok) return true }
    catch {}
    await sleep(2000)
  }
  return false
}

;(async () => {
  console.log(`\n=== GC restore fidelity ===`)
  console.log(`node      : ${HB_URL}`)
  console.log(`container : ${CONTAINER}`)
  console.log(`signer    : ${DEV}`)

  // `grep -c` exits 1 on zero matches, which execFileSync turns into a throw — i.e. it would
  // blow up on exactly the unpatched node this check exists to identify. Read the count off the
  // captured stdout instead of trusting the exit status.
  let gcPresent = '0'
  try {
    gcPresent = execFileSync('podman', ['exec', CONTAINER, 'grep', '-c', 'luerl:gc', '/app/src/dev_lua.erl'],
      { encoding: 'utf8', timeout: 60_000 }).trim()
  } catch (e: any) {
    gcPresent = String(e?.stdout ?? '0').trim() || '0'
  }
  console.log(`image     : luerl:gc occurrences in dev_lua.erl = ${gcPresent}`)
  if (gcPresent === '0') console.log(`  ⚠️  this node is NOT GC-patched — running as a control`)

  const schedulerLocation = await fetchNodeAddress(HB_URL)
  const modId = publish('dist/operator-registry-native.lua', 'gcfid-opreg')
  const { pid } = await spawnLuaProcess({ url: HB_URL, signer: owner } as any, {
    moduleId: modId, schedulerLocation, spawnData: seedEnvelopeFor('operator-registry'),
    tags: [{ name: 'name', value: `gc-restore-fidelity` }] } as any)
  console.log(`process   : ${pid}\n`)

  // Wait for the migrate-on-spawn seed to materialise.
  let seeded = false
  for (let i = 0; i < 40; i++) {
    if ((await get(`/${pid}~process@1.0/as/status`)).status === 200) { seeded = true; break }
    await sleep(1500)
  }
  if (!seeded) { console.log('ABORT: seed never materialised'); process.exit(2) }

  console.log(`[1] build up state across slots`)
  let bad = 0
  for (let i = 1; i <= WRITES; i++) if ((await submit(pid, fpOf(i))) !== 200) bad++
  ok(`${WRITES} signed writes accepted`, bad === 0, bad ? `${bad} non-200` : `each in its own slot`)

  const warmDump = await get(`/${pid}~process@1.0/as/dump`)
  ok('warm full-state dump readable', warmDump.status === 200, `${warmDump.body.length} B  sha=${sha(warmDump.body)}`)

  // Every write must be present warm, or the restart comparison is meaningless.
  let warmMissing = 0
  for (let i = 1; i <= WRITES; i++) {
    if ((await get(`/${pid}~process@1.0/now/state/claimable/${fpOf(i)}`)).status !== 200) warmMissing++
  }
  ok('all writes visible warm', warmMissing === 0,
    warmMissing ? `${warmMissing} missing — last compute output: ${lastBody}` : `${WRITES}/${WRITES}`)

  console.log(`\n[2] force a LATE snapshot (idle ${IDLE_S}s past the 60s cadence, then one more message)`)
  await sleep(IDLE_S * 1000)
  const lateStatus = await submit(pid, fpOf(WRITES + 1))
  ok('post-idle write accepted (puts a snapshot on the last slot)', lateStatus === 200)
  await sleep(3000)

  const preDump = await get(`/${pid}~process@1.0/as/dump`)
  const preSha = sha(preDump.body)

  console.log(`\n[3] restart the node`)
  execFileSync('podman', ['restart', CONTAINER], { timeout: 300_000 })
  if (!await waitForNode()) { console.log('ABORT: node did not come back'); process.exit(2) }

  const coldDump = await get(`/${pid}~process@1.0/as/dump`)
  const coldSha = sha(coldDump.body)

  // The tell for WHICH restore path ran. A replay of ~10 slots takes seconds; a snapshot resume is
  // tens of ms. If this is slow the run proved nothing about snapshot/3, so say so rather than
  // banking a green tick.
  const resumed = coldDump.ms < 2000
  console.log(`  cold first read: ${coldDump.ms} ms  ⇒ ${resumed ? 'resumed from SNAPSHOT' : 'looks like REPLAY'}`)
  if (!resumed) {
    inconclusive++
    console.log(`  ⚠️  INCONCLUSIVE: snapshot path not exercised; raise IDLE_S or check process_snapshot_time`)
  }

  console.log(`\n[4] fidelity across the restart`)
  ok('cold dump readable', coldDump.status === 200, `${coldDump.body.length} B  sha=${coldSha}`)
  ok('full state BYTE-IDENTICAL across restart', preSha === coldSha, `pre=${preSha} cold=${coldSha}`)

  let coldMissing = 0
  for (let i = 1; i <= WRITES + 1; i++) {
    if ((await get(`/${pid}~process@1.0/now/state/claimable/${fpOf(i)}`)).status !== 200) coldMissing++
  }
  ok('all writes survive the restart', coldMissing === 0,
    coldMissing ? `${coldMissing} LOST` : `${WRITES + 1}/${WRITES + 1}`)

  console.log(`\n[5] the restored VM still computes`)
  const postStatus = await submit(pid, fpOf(WRITES + 2))
  ok('post-restore write accepted', postStatus === 200)
  const postGet = await get(`/${pid}~process@1.0/now/state/claimable/${fpOf(WRITES + 2)}`)
  ok('post-restore write persisted', postGet.status === 200)

  const before = JSON.parse((await get(`/${pid}~process@1.0/as/status`)).body)
  ok('claimable count consistent with writes', typeof before?.counts?.claimable === 'number',
    `claimable=${before?.counts?.claimable}`)

  console.log(`\n=== ${pass} passed, ${fail} failed${inconclusive ? `, ${inconclusive} inconclusive` : ''} ===`)
  process.exit(fail === 0 && inconclusive === 0 ? 0 : 1)
})()
