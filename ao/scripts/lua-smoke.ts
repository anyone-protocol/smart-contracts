// WS-2 success criterion: vanilla lua smoke test over HTTP with the native
// client (no aoconnect) — spawn a minimal lua process, send an interaction,
// read `now/count` incremented.
// Run: HB_URL=http://localhost:8734 bun run scripts/lua-smoke.ts
import { EthereumSigner } from '@dha-team/arbundles'
import { fetchNodeAddress, spawnLuaProcess, sendMessage, readState } from './util/hb-client'

const HB_URL = process.env.HB_URL || 'http://localhost:8734'
const KEY = process.env.DEPLOYER_PRIVATE_KEY
  || '80611882d38e5502d93305c88b64da234fea23037334ecb9a647249076c5fa37' // dev test wallet

// Minimal vanilla lua process: `compute` is the per-message reducer.
const LUA = `
function compute(process, message, opts)
  process.count = (process.count or 0) + 1
  process.results = { output = { body = tostring(process.count) } }
  return process
end
`

;(async () => {
  const config = { url: HB_URL, signer: new EthereumSigner(KEY.replace(/^0x/, '')) }
  console.log(`node: ${HB_URL} (${await fetchNodeAddress(HB_URL)})`)

  console.log('1) spawn native vanilla lua process...')
  const { pid, slot } = await spawnLuaProcess(config, {
    luaSource: LUA,
    tags: [{ name: 'name', value: `lua-smoke-${Date.now()}` }],
  })
  console.log(`   pid = ${pid} (slot ${slot})`)

  const count0 = Number(await readState(config, pid, 'count'))
  console.log(`2) count after spawn: ${count0}`)

  console.log('3) send an interaction...')
  const msg = await sendMessage(config, {
    pid,
    tags: [{ name: 'action', value: 'Tick' }],
    data: 'hello',
  })
  console.log(`   msg id = ${msg.id} (slot ${msg.slot})`)

  const count1 = Number(await readState(config, pid, 'count'))
  const output = await readState(config, pid, 'results/output/body')
  console.log(`4) count after interaction: ${count1}`)
  console.log(`5) results/output/body: ${output}`)

  if (count1 !== count0 + 1) throw new Error(`count did not increment: ${count0} -> ${count1}`)
  if (output !== String(count1)) throw new Error(`output body mismatch: ${output} != ${count1}`)
  console.log('\nSMOKE TEST GREEN ✓ (native spawn + interaction + state read, no aoconnect)')
  process.exit(0)
})().catch(e => { console.error('\nSMOKE TEST FAILED:', String(e?.message || e)); process.exit(1) })
