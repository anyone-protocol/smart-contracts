// Drive scripts/probe/timestamp-probe.lua on a live node and print the raw time fields the
// `lua@5.3a` device hands a contract, next to the host's own Date.now(), so the UNITS are settled
// by evidence. See the probe's header for why (staking-rewards Set-Share / ChangeDelaySeconds).
// Run: HB_URL=http://localhost:8734 MODULE_ID=<probe id> bun run scripts/probe/run-timestamp-probe.ts
import { EthereumSigner } from '@dha-team/arbundles'
import { fetchNodeAddress, spawnLuaProcess, sendMessage, readState } from '../util/hb-client'

const HB = process.env.HB_URL || 'http://localhost:8734'
const MODULE_ID = process.env.MODULE_ID
if (!MODULE_ID) { console.error('MODULE_ID env required'); process.exit(2) }
const KEY = (process.env.DEPLOYER_PRIVATE_KEY || '80611882d38e5502d93305c88b64da234fea23037334ecb9a647249076c5fa37').replace(/^0x/, '')
const signer = new EthereumSigner(KEY)

;(async () => {
  console.log(`node ${await fetchNodeAddress(HB)}  moduleId=${MODULE_ID}`)
  const { pid } = await spawnLuaProcess({ url: HB, signer }, { moduleId: MODULE_ID, tags: [{ name: 'name', value: `ts-probe-${Date.now()}` }] })
  console.log(`spawned pid=${pid}`)

  const before = Date.now()
  await sendMessage({ url: HB, signer }, { pid, tags: [{ name: 'action', value: 'Probe' }] })
  const after = Date.now()

  const out = await readState({ url: HB }, pid, 'results/output/data')
  console.log(`\nhost Date.now() around the send: ${before} .. ${after}  (ms, 13 digits)`)
  console.log(`\ndevice-visible fields:`)
  for (const part of out.split(' | ')) console.log('  ' + part.trim())

  // Classify each numeric candidate by magnitude so the unit is unambiguous.
  console.log(`\nunit verdict:`)
  for (const part of out.split(' | ')) {
    const m = part.trim().match(/^([\w.\-]+)=(\d+)$/)
    if (!m) continue
    const [, k, v] = m
    const n = Number(v)
    const digits = v.length
    let verdict: string
    if (n === 0) verdict = 'ZERO (unset — e.g. node in debug mode)'
    else if (digits === 13) verdict = `MILLISECONDS  (${new Date(n).toISOString()})`
    else if (digits === 10) verdict = `SECONDS       (${new Date(n * 1000).toISOString()})`
    else verdict = `unclear (${digits} digits)`
    console.log(`  ${k.padEnd(22)} ${v.padEnd(16)} ${verdict}`)
  }
  console.log(`\npid=${pid}`)
})().catch(e => { console.error('FATAL', String(e?.stack || e).slice(0, 400)); process.exit(2) })
