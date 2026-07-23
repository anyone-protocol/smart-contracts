// D3 faff probe: send an EVM-signed spawn to a lua-device HyperBEAM node with
// (a) an allow-listed wallet and (b) a non-listed wallet, and observe whether
// faff admits or rejects. Reuses the working ans104 EVM signer from spawn.ts.
// Run: npx tsx scripts/faff-probe.ts
import { connect as aoConnect } from '@permaweb/aoconnect'
import { EthereumSigner } from '@dha-team/arbundles'
import { createEthSigner, resolveAuthority } from './util/helpers'
import { randomBytes } from 'node:crypto'

const HB_URL = process.env.HB_URL || 'https://hb-dev.anyone.tech'

// Intercept fetch to see the node's RAW response — aoconnect swallows it.
const _fetch = globalThis.fetch
let TAG = ''
globalThis.fetch = (async (input: any, init?: any) => {
  const url = typeof input === 'string' ? input : input?.url
  const method = init?.method || (typeof input === 'object' ? input?.method : 'GET') || 'GET'
  const res = await _fetch(input, init)
  if (method !== 'GET' || /push|schedule|process/.test(String(url))) {
    let body = ''
    try { body = (await res.clone().text()).slice(0, 300) } catch {}
    console.log(`  [${TAG}] ${method} ${String(url).replace(HB_URL, '')} -> ${res.status} ${body.replace(/\s+/g, ' ')}`)
  }
  return res
}) as any
// Dev test wallet — in the node's faff-allow-list (addr 0xa9A1BdfA75...39AEcE).
const DEV_KEY = '0x80611882d38e5502d93305c88b64da234fea23037334ecb9a647249076c5fa37'
// Fresh random wallet — NOT in the allow-list.
const RND_KEY = '0x' + randomBytes(32).toString('hex')
const MODULE = process.env.MODULE || 'ISShJH1ij-hPPt9St5UFFr_8Ys3Kj5cyg7zrMGt7H9s'

async function probe(label: string, pk: string) {
  TAG = label
  const ethSigner = new EthereumSigner(pk.replace(/^0x/, ''))
  const signer = await createEthSigner(ethSigner)
  const nodeAddress = await resolveAuthority(HB_URL)
  const ao = aoConnect({ MODE: 'mainnet', signer: signer as any, URL: HB_URL, SCHEDULER: nodeAddress })
  try {
    const pid = await ao.spawn({
      tags: [{ name: 'App-Name', value: 'Anyone-Protocol' }, { name: 'Name', value: 'faff-probe-' + Date.now() }],
      signer: signer as any,
      scheduler: nodeAddress,
      module: MODULE,
      data: 'faff-probe',
    })
    console.log(`\n[${label}] PAST FAFF → spawn accepted, pid=${pid}`)
  } catch (e: any) {
    // Dig out the real cause aoconnect wraps under a generic message.
    const parts: string[] = []
    let cur: any = e
    for (let i = 0; i < 6 && cur; i++) {
      if (cur?.message) parts.push(String(cur.message))
      if (cur?.body) parts.push('body=' + (typeof cur.body === 'string' ? cur.body : JSON.stringify(cur.body)))
      if (cur?.status) parts.push('status=' + cur.status)
      cur = cur?.cause
    }
    // also dump any non-standard enumerable props
    try { parts.push('props=' + JSON.stringify(e, Object.getOwnPropertyNames(e))) } catch {}
    const blob = parts.join(' | ')
    const faffHit = /will not service this request|infinity|not authorized|402|forbidden/i.test(blob)
    console.log(`\n[${label}] ${faffHit ? 'FAFF REJECTED ✓' : 'other/unknown'} → ${blob.slice(0, 600)}`)
  }
}

async function probeMessage(label: string, pk: string, pid: string) {
  TAG = label
  const ethSigner = new EthereumSigner(pk.replace(/^0x/, ''))
  const signer = await createEthSigner(ethSigner)
  const ao = aoConnect({ MODE: 'mainnet', signer: signer as any, URL: HB_URL })
  try {
    const id = await ao.message({ process: pid, signer: signer as any, tags: [{ name: 'Action', value: 'Info' }], data: 'probe' })
    console.log(`\n[${label}] message sent, id=${id}`)
  } catch (e: any) {
    console.log(`\n[${label}] message error → ${String(e?.message || e).slice(0, 120)}`)
  }
}

;(async () => {
  console.log(`Probing ${HB_URL}`)
  console.log(`dev wallet allow-listed as 0xa9A1BdfA750Bc1b317c4D139AC6bBfA72839AEcE; random wallet not listed`)
  await probe('DEV / allow-listed', DEV_KEY)
  await probe('RANDOM / not-listed', RND_KEY)
  // Does an operator MESSAGE to a whitelisted PID use a PID-scoped URL (edge-gateable)
  // or bare /push (needs target-based native gating)?
  await probeMessage('DEV msg->stage-op-reg', DEV_KEY, 'hvDrJZWwTjAI7Li38biqu1D9FCUT1q6sAUKNDKaH-xc')
  process.exit(0)
})()
