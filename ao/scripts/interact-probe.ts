// D3 write-interaction probe: spawn a live process, eval a handler, send an
// interaction message, and read the result — proving the full write path
// (message -> schedule -> compute -> read), not just HTTP acceptance.
// Run: HB_URL=https://hb-dev.anyone.tech bun run scripts/interact-probe.ts
import { connect as aoConnect } from '@permaweb/aoconnect'
import { EthereumSigner } from '@dha-team/arbundles'
import { createEthSigner, resolveAuthority, resolveImportAuthority } from './util/helpers'

const HB_URL = process.env.HB_URL || 'https://hb-dev.anyone.tech'
const DEV_KEY = '0x80611882d38e5502d93305c88b64da234fea23037334ecb9a647249076c5fa37'
const MODULE = process.env.MODULE || 'ISShJH1ij-hPPt9St5UFFr_8Ys3Kj5cyg7zrMGt7H9s'

// See the raw node responses (aoconnect hides them).
const _fetch = globalThis.fetch
globalThis.fetch = (async (input: any, init?: any) => {
  const url = typeof input === 'string' ? input : input?.url
  const method = init?.method || 'GET'
  const res = await _fetch(input, init)
  if (method !== 'GET' || /now|result|compute|push/.test(String(url))) {
    let body = ''
    try { body = (await res.clone().text()).slice(0, 200) } catch {}
    console.log(`  ${method} ${String(url).replace(HB_URL, '')} -> ${res.status} ${body.replace(/\s+/g, ' ').slice(0, 160)}`)
  }
  return res
}) as any

const HANDLER = `
Pongs = Pongs or 0
Handlers.add("Ping", Handlers.utils.hasMatchingTag("Action", "Ping"), function(msg)
  Pongs = Pongs + 1
  print("pong #" .. tostring(Pongs))
end)
`

;(async () => {
  const eth = new EthereumSigner(DEV_KEY.replace(/^0x/, ''))
  const signer = await createEthSigner(eth)
  const nodeAddress = await resolveAuthority(HB_URL)
  const authority = await resolveImportAuthority(HB_URL)
  const ao = aoConnect({ MODE: 'mainnet', signer: signer as any, URL: HB_URL, SCHEDULER: nodeAddress })

  console.log('1) spawn...')
  const pid = await ao.spawn({
    tags: [{ name: 'App-Name', value: 'Anyone-Protocol' }, { name: 'Name', value: 'interact-' + Date.now() }, { name: 'Authority', value: authority }],
    signer: signer as any, scheduler: nodeAddress, authority, module: MODULE, data: 'interact-probe',
  })
  console.log('   pid =', pid)
  await new Promise(r => setTimeout(r, 6000))

  console.log('2) eval handler (a write interaction)...')
  const evalId = await ao.message({ process: pid, signer: signer as any, tags: [{ name: 'Action', value: 'Eval' }], data: HANDLER })
  console.log('   eval msg id =', evalId)
  try { const r = await ao.result({ process: pid, message: evalId }); console.log('   eval result:', JSON.stringify(r).slice(0, 160)) } catch (e: any) { console.log('   eval result error:', String(e?.message || e).slice(0, 120)) }

  console.log('3) send Ping interaction...')
  const pingId = await ao.message({ process: pid, signer: signer as any, tags: [{ name: 'Action', value: 'Ping' }], data: '' })
  console.log('   ping msg id =', pingId)
  await new Promise(r => setTimeout(r, 3000))

  console.log('4) read result of the Ping (compute + read-back)...')
  try {
    const r: any = await ao.result({ process: pid, message: pingId })
    const out = r?.Output?.data ?? r?.Output ?? r
    console.log('   PING RESULT Output:', JSON.stringify(out).slice(0, 200))
    console.log(String(JSON.stringify(r)).includes('pong') ? '   ✓ INTERACTION PROCESSED (handler ran)' : '   ? no pong in output — inspect above')
  } catch (e: any) {
    console.log('   ping result error:', String(e?.message || e).slice(0, 160))
  }
  process.exit(0)
})().catch(e => { console.error('FATAL', String(e?.message || e).slice(0, 200)); process.exit(1) })
