// SPIKE: spawn a NATIVE vanilla lua-device process over HTTP and drive an
// interaction — minimal smoke test of the migration-target runtime (no aos).
// Run: HB_URL=http://localhost:18741 bun run scripts/spawn-lua.ts
import { connect as aoConnect } from '@permaweb/aoconnect'
import { EthereumSigner } from '@dha-team/arbundles'
import { createEthSigner, resolveAuthority } from './util/helpers'

const HB_URL = process.env.HB_URL || 'http://localhost:18741'
const DEV_KEY = '0x80611882d38e5502d93305c88b64da234fea23037334ecb9a647249076c5fa37'

// Minimal vanilla lua process: `compute` is the per-message reducer.
// Counts messages and exposes the count in results/output/body and state.
const LUA = `
function compute(process, message, opts)
  process.count = (process.count or 0) + 1
  process.results = { output = { body = tostring(process.count) } }
  return process
end
`

const _fetch = globalThis.fetch
globalThis.fetch = (async (input: any, init?: any) => {
  const url = typeof input === 'string' ? input : input?.url
  const method = init?.method || 'GET'
  const res = await _fetch(input, init)
  if (method !== 'GET' || /now|result|schedule|push/.test(String(url))) {
    let body = ''; try { body = (await res.clone().text()).slice(0, 220) } catch {}
    console.log(`  ${method} ${String(url).replace(HB_URL, '')} -> ${res.status} ${body.replace(/\s+/g, ' ')}`)
  }
  return res
}) as any

;(async () => {
  const eth = new EthereumSigner(DEV_KEY.replace(/^0x/, ''))
  const signer = await createEthSigner(eth)
  const nodeAddress = await resolveAuthority(HB_URL)
  const ao = aoConnect({ MODE: 'mainnet', signer: signer as any, URL: HB_URL, SCHEDULER: nodeAddress, device: 'process@1.0' } as any)

  console.log('1) spawn native vanilla lua process...')
  const pid = await ao.spawn({
    signer: signer as any, scheduler: nodeAddress,
    module: { 'content-type': 'application/lua', body: LUA } as any,
    tags: [
      { name: 'Execution-Device', value: 'lua@5.3a' },
      { name: 'Authority', value: nodeAddress },
      { name: 'Name', value: 'lua-smoke-' + Date.now() },
    ],
    data: LUA,
  } as any)
  console.log('   pid =', pid)
  await new Promise(r => setTimeout(r, 3000))

  const read = async (path: string) => {
    const r = await _fetch(`${HB_URL}/${pid}~process@1.0/${path}`)
    return `${r.status}:${(await r.text()).trim().slice(0, 40)}`
  }
  console.log('2) count before interaction:', await read('now/count'))

  console.log('3) send an interaction (any message -> compute reducer runs)...')
  const msgId = await ao.message({ process: pid, signer: signer as any, tags: [{ name: 'Action', value: 'Tick' }], data: 'hello' })
  console.log('   msg id =', msgId)
  await new Promise(r => setTimeout(r, 2500))

  console.log('4) count after interaction:', await read('now/count'))
  console.log('5) results/output/body:', await read('now/results/output/body'))
  process.exit(0)
})().catch(e => { console.error('FATAL', String(e?.message || e).slice(0, 200)); process.exit(1) })
