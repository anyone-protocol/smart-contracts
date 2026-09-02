// Per-message cost curve across accumulated slots — the justification for the luerl-GC image patch.
//
// Companion to gc-restore-fidelity.ts. That probe answers "is the patch safe?"; this one answers
// "is it worth applying?" Run it against both images and compare:
//
//   podman run -d --name hb-ctl --network host -e HB_ALLOW_EPHEMERAL_WALLET=true \
//     ghcr.io/memetic-block/hyperbeam-docker:v0.9-FINAL-patched
//   HB_URL=... CONTAINER=hb-ctl bun run scripts/probe/gc-cost-curve.ts
//   # then the same against the GC-patched image
//
// What is being measured: `dev_lua:snapshot/3` serialises the entire luerl VM, and without a
// collect that binary retains every table the process has ever allocated. It is written twice per
// slot, so per-message cost grows with the number of ACCUMULATED SLOTS even though the
// Lua-visible state is barely changing. GROWTH is therefore the signal, not absolute latency —
// absolute numbers move with host load and state size and are not comparable between runs.
//
// The write used is a real admin action on a real migrated ~1 MB operator-registry seed, one new
// certificate per message so each lands in its own slot. Reads are deliberately not measured:
// they were already shown to be unaffected (480 vs 491 ms at 0 vs 150 slots).
//
// Env:
//   HB_URL      node under test
//   WRITES      messages to send (default 50)
//   CONTAINER   local mode: container to publish into and read the image from (default hb-gcp)
//   MODULE_ID   remote mode: id of an ALREADY-PUBLISHED operator-registry module on that node.
//               Set this for hb-dev/stage/live, where there is no container to exec into.
//               Get it from scripts/run-e2e.ts --print-publish-commands.
import fs from 'fs'
import path from 'path'
import { execFileSync } from 'node:child_process'
import { EthereumSigner, createData } from '@dha-team/arbundles'
import { Wallet } from 'ethers'
import { fetchNodeAddress, spawnLuaProcess } from '../util/hb-client'
import { seedEnvelopeFor } from '../util/native-bundle'
import { requireDeployerKey } from '../util/helpers'

const HB_URL = process.env.HB_URL || 'http://localhost:8734'
const CONTAINER = process.env.CONTAINER || 'hb-gcp'
const WRITES = Number(process.env.WRITES || 50)
const AO = path.resolve(import.meta.dir, '../..')

// Signer from DEPLOYER_PRIVATE_KEY (ao/.env, untracked). No fallback by design — see
// requireDeployerKey(). The derived address is printed before the first write so a run is
// always attributable to a signer.
const KEY = requireDeployerKey()
const owner = new EthereumSigner(KEY)
const DEV = new Wallet('0x' + KEY).address
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
const fpOf = (i: number) => 'BEEF' + i.toString(16).toUpperCase().padStart(36, '0')

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
async function submit (pid: string, fp: string) {
  const item = createData(JSON.stringify([{ f: fp, a: DEV }]), owner, { target: pid, tags: [
    { name: 'type', value: 'Message' }, { name: 'data-protocol', value: 'ao' },
    { name: 'variant', value: 'ao.N.1' },
    { name: 'action', value: 'Admin-Submit-Operator-Certificates' } ] })
  await item.sign(owner)
  const t0 = Date.now()
  const r = await fetch(`${HB_URL}/${pid}~process@1.0/push`, {
    method: 'POST', headers: ANS104, body: item.getRaw(), redirect: 'follow' })
  await r.text()
  return { ms: Date.now() - t0, status: r.status }
}

;(async () => {
  // Two modes. Locally we own the container, so publish the module ourselves and read the image
  // to label the run. Against a REMOTE node (hb-dev/stage/live) there is no container to exec
  // into: the module must already be published there — see scripts/run-e2e.ts
  // --print-publish-commands — and MODULE_ID identifies it. The variant label is then unknown,
  // because the only honest way to tell from outside is the curve itself, which is the thing
  // being measured. Do not guess it.
  const MODULE_ID = process.env.MODULE_ID
  let variant: string
  if (MODULE_ID) {
    variant = 'REMOTE (image unknown from here)'
  } else {
    let gc = '0'
    try {
      gc = execFileSync('podman', ['exec', CONTAINER, 'grep', '-c', 'luerl:gc', '/app/src/dev_lua.erl'],
        { encoding: 'utf8', timeout: 60_000 }).trim()
    } catch (e: any) { gc = String(e?.stdout ?? '0').trim() || '0' }
    variant = gc === '0' ? 'STOCK (no GC)' : 'GC-PATCHED'
  }

  console.log(`\n=== GC cost curve — ${variant} ===`)
  console.log(`node ${HB_URL}  ${MODULE_ID ? `module ${MODULE_ID}` : `container ${CONTAINER}`}  writes ${WRITES}`)
  console.log(`signer ${DEV}`)

  const schedulerLocation = await fetchNodeAddress(HB_URL)
  const modId = MODULE_ID || publish('dist/operator-registry-native.lua', 'gccost-opreg')
  const { pid } = await spawnLuaProcess({ url: HB_URL, signer: owner } as any, {
    moduleId: modId, schedulerLocation, spawnData: seedEnvelopeFor('operator-registry'),
    tags: [{ name: 'name', value: `gc-cost-curve` }] } as any)
  console.log(`process ${pid}`)

  for (let i = 0; i < 40; i++) {
    if ((await fetch(`${HB_URL}/${pid}~process@1.0/as/status`)).status === 200) break
    await sleep(1500)
  }

  const lat: number[] = []
  let bad = 0
  for (let i = 1; i <= WRITES; i++) {
    const r = await submit(pid, fpOf(i))
    if (r.status !== 200) bad++
    lat.push(r.ms)
    if (i % 10 === 0 || i === 1) console.log(`  msg ${String(i).padStart(3)}  ${String(r.ms).padStart(6)} ms`)
  }

  const avg = (a: number[]) => Math.round(a.reduce((x, y) => x + y, 0) / a.length)
  const first10 = avg(lat.slice(0, 10)), last10 = avg(lat.slice(-10))
  console.log(`\n  variant      : ${variant}`)
  console.log(`  msg 1        : ${lat[0]} ms`)
  console.log(`  msg ${WRITES}       : ${lat[lat.length - 1]} ms`)
  console.log(`  first-10 avg : ${first10} ms`)
  console.log(`  last-10 avg  : ${last10} ms`)
  console.log(`  GROWTH       : ${(last10 / first10).toFixed(2)}x  <-- the number that matters`)
  if (bad) console.log(`  ⚠️ ${bad}/${WRITES} pushes non-200`)
})()
