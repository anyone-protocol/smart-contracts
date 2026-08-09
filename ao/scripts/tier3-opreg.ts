// Tier-3: run the NATIVE operator-registry (native runtime + contract) on a real
// HyperBEAM v0.9-FINAL node. Probes the verify-live items:
//  - migrate-on-spawn: does base.state materialize at slot 0 (spawn)?
//  - does a signed write dispatch + mutate state (Axis-0/1 message shape on-device)?
//  - read path + format: what does now/<key> return, and how to invoke computed views?
// Run: HB_URL=http://localhost:8734 bun run scripts/tier3-opreg.ts
import { EthereumSigner } from '@dha-team/arbundles'
import { fetchNodeAddress, spawnLuaProcess, sendMessage } from './util/hb-client'
import fs from 'fs'
import path from 'path'

const HB_URL = process.env.HB_URL || 'http://localhost:8734'
const KEY = process.env.DEPLOYER_PRIVATE_KEY
  || '80611882d38e5502d93305c88b64da234fea23037334ecb9a647249076c5fa37'
const AO = path.resolve(import.meta.dir, '..')
const rd = (rel: string) => fs.readFileSync(path.join(AO, rel), 'utf-8')
const wrap = (src: string) => `(function()\n${src}\nend)()`

// Assemble the native bundle (same shape the luerl Tier-2 runner uses): preload deps,
// install native runtime (sets global `compute`), register the contract table.
const BUNDLE = [
  `package.loaded['json'] = ${wrap(rd('runtime/vendor/json.lua'))}`,
  `package.loaded['.json'] = package.loaded['json']`,
  `package.loaded['.common.errors'] = ${wrap(rd('src/contracts/common/errors.lua'))}`,
  `package.loaded['.common.utils'] = ${wrap(rd('src/contracts/common/utils.lua'))}`,
  `native = ${wrap(rd('runtime/native.lua'))}`,
  `native.install()`,
  `native.register(${wrap(rd('src/contracts/native/operator-registry.lua'))})`,
].join('\n')

const FP_A = 'A'.repeat(40)
const ADDR = '0x' + 'a'.repeat(40)            // normalizes to 0x + 'A'*40

;(async () => {
  const config = { url: HB_URL, signer: new EthereumSigner(KEY.replace(/^0x/, '')) }
  const node = await fetchNodeAddress(HB_URL)
  console.log(`node ${HB_URL} (${node})`)
  console.log(`bundle: ${BUNDLE.length} bytes`)

  // Raw GET so we can see status + content-type + body for any path/format.
  const raw = async (pid: string, p: string) => {
    const r = await fetch(`${HB_URL}/${pid}~process@1.0/${p}`)
    const body = (await r.text())
    return { status: r.status, ct: r.headers.get('content-type') || '', body }
  }
  const show = (label: string, r: { status: number, ct: string, body: string }) =>
    console.log(`  ${label} -> ${r.status} [${r.ct}] ${r.body.replace(/\s+/g, ' ').trim().slice(0, 160)}`)

  console.log('\n1) spawn native operator-registry...')
  const { pid, slot } = await spawnLuaProcess(config, {
    luaSource: BUNDLE,
    tags: [{ name: 'name', value: `native-opreg-${Date.now()}` }],
  })
  console.log(`   pid = ${pid} (slot ${slot})`)

  console.log('\n2) state materialization at spawn (base-addressed reads):')
  show('now/state', await raw(pid, 'now/state'))
  show('now/state/verified', await raw(pid, 'now/state/verified'))
  show('now/state/initialized', await raw(pid, 'now/state/initialized'))

  console.log('\n3) send a signed Admin-Submit-Operator-Certificates (owner = deploy wallet):')
  const w = await sendMessage(config, {
    pid,
    tags: [{ name: 'action', value: 'Admin-Submit-Operator-Certificates' }],
    data: JSON.stringify([{ f: FP_A, a: ADDR }]),
  })
  console.log(`   msg ${w.id} (slot ${w.slot})`)
  console.log(`   push body: ${w.body.replace(/\s+/g, ' ').trim().slice(0, 200)}`)

  console.log('\n4) read back state after the write:')
  show('now/state/claimable', await raw(pid, 'now/state/claimable'))
  show(`now/state/claimable/${FP_A}`, await raw(pid, `now/state/claimable/${FP_A}`))
  show('now/results/output/data', await raw(pid, 'now/results/output/data'))

  console.log('\n5) computed views via as/<view> (global wrappers, JSON codec):')
  const ADDR_STORED = '0x' + 'A'.repeat(40)
  for (const p of [
    'as/status/serialize~json@1.0',
    'as/operators/serialize~json@1.0',
    `as/operator/serialize~json@1.0?address=${ADDR_STORED}`,
    `as/operator/serialize~json@1.0&address=${ADDR_STORED}`,
  ]) {
    show(p, await raw(pid, p))
  }

  console.log('\n6) read-format negotiation (JSON codec in path vs default httpsig):')
  show('now/state/serialize~json@1.0', await raw(pid, 'now/state/serialize~json@1.0'))

  process.exit(0)
})().catch(e => { console.error('FATAL', String(e?.message || e).slice(0, 400)); process.exit(1) })
