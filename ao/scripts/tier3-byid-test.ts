// Confirm the module-by-id fix: spawn by a published MODULE_ID (module carried as a 43-char
// ref, not the ~120KB inline bundle) and hammer messages PAST slot 3 — where inline spawns
// wedge (per-slot module bloat → ~1MB Arweave-flush 400). All 8 should succeed.
// Run: HB_URL=... MODULE_ID=<id> bun run scripts/tier3-byid-test.ts
import { EthereumSigner } from '@dha-team/arbundles'
import { fetchNodeAddress, spawnLuaProcess, sendMessage } from './util/hb-client'

const HB = process.env.HB_URL || 'http://localhost:8734'
const MODULE_ID = process.env.MODULE_ID
if (!MODULE_ID) { console.error('MODULE_ID env required'); process.exit(2) }
const KEY = (process.env.DEPLOYER_PRIVATE_KEY || '80611882d38e5502d93305c88b64da234fea23037334ecb9a647249076c5fa37').replace(/^0x/, '')
const signer = new EthereumSigner(KEY)
const FP = (c: string) => c.repeat(40)

;(async () => {
  console.log(`node ${await fetchNodeAddress(HB)}  moduleId=${MODULE_ID}`)
  let pid: string
  try {
    const r = await spawnLuaProcess({ url: HB, signer },
      { moduleId: MODULE_ID, tags: [{ name: 'name', value: `byid-${Date.now()}` }] })
    pid = r.pid
    console.log(`by-id spawn pid=${pid}`)
  } catch (e: any) {
    console.log(`SPAWN FAILED: ${String(e?.message || e).slice(0, 300)}`); process.exit(1)
  }

  const dump0 = await (await fetch(`${HB}/${pid}~process@1.0/as/dump`)).text()
  console.log(`materialized? ${dump0.slice(0, 70).replace(/\s+/g, ' ')}`)

  let ok = 0, failed = 0
  for (let i = 0; i < 8; i++) {
    try {
      const r = await sendMessage({ url: HB, signer }, {
        pid, tags: [{ name: 'action', value: 'Admin-Submit-Operator-Certificates' }],
        data: JSON.stringify([{ f: FP(String.fromCharCode(65 + i)), a: '0x' + 'a'.repeat(40) }]),
      })
      const out = (await (await fetch(`${HB}/${pid}~process@1.0/now/results/output/data`)).text()).trim()
      console.log(`  msg ${i + 1}: slot=${r.slot} out=${out.slice(0, 16)}`)
      ok++
    } catch (e: any) {
      console.log(`  msg ${i + 1}: FAILED ${String(e?.message || e).slice(0, 70)}`); failed++
    }
  }
  console.log(`\nRESULT: ${ok}/8 ok (inline wedges at ~slot 3; by-id should do all 8)  pid=${pid}`)
  process.exit(failed ? 1 : 0)
})().catch(e => { console.error('FATAL', String(e?.stack || e).slice(0, 400)); process.exit(2) })
