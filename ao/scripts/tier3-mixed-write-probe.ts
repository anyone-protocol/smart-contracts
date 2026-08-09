// Does the BLANKET strip-on-write tax writes to a SMALL map when a BIG cold map is present?
// Load claimable to N (big, string), then time writes that touch ONLY the tiny `blocked` map.
// If Block-writes cost ~O(N) (≈ a claimable write), the blanket strip re-commits the untouched big
// map every slot ⇒ a "strip only mutated maps" refactor would make writes O(dirty) not O(total).
// Run: MODULE_ID=<strip id> HB_URL=... [N=6000 BATCH=300] bun run scripts/tier3-mixed-write-probe.ts
import { EthereumSigner } from '@dha-team/arbundles'
import { Wallet } from 'ethers'
import { spawnLuaProcess, sendMessage } from './util/hb-client'

const HB = process.env.HB_URL || 'http://localhost:8734'
const MODULE_ID = process.env.MODULE_ID!
const N = Number(process.env.N || 6000)
const BATCH = Number(process.env.BATCH || 300)
// LOAD=claimable (string, needs strip to grow) | hardware (bool, grows on NO-STRIP module).
// Use LOAD=hardware on the no-strip module to build a big COLD map, then see if a tiny `blocked`
// write stays cheap (untouched map not re-hashed) — the control for the blanket-strip tax.
const LOAD = process.env.LOAD || 'claimable'
const KEY = (process.env.DEPLOYER_PRIVATE_KEY || '80611882d38e5502d93305c88b64da234fea23037334ecb9a647249076c5fa37').replace(/^0x/, '')
const signer = new EthereumSigner(KEY)
const OWNER = new Wallet('0x' + KEY).address
const P = (pid: string) => `${HB}/${pid}~process@1.0`
const now = () => performance.now()
const fp = (i: number) => i.toString(16).toUpperCase().padStart(40, '0')
const addr = (i: number) => '0x' + i.toString(16).padStart(40, '0')
const send = (pid: string, action: string, tags: Record<string, string>, data = '') =>
  sendMessage({ url: HB, signer }, { pid, tags: [{ name: 'action', value: action }, ...Object.entries(tags).map(([name, value]) => ({ name, value }))], data })
const timeSend = async (pid: string, action: string, tags: Record<string, string>, data = '') => { const t = now(); await send(pid, action, tags, data); return now() - t }
const getTextNoop = (pid: string) => fetch(`${P(pid)}/as/dump`).then(r => r.text())

;(async () => {
  const { pid } = await spawnLuaProcess({ url: HB, signer }, { moduleId: MODULE_ID, tags: [{ name: 'name', value: `mixed-${Date.now()}` }] })
  const coldMap = LOAD === 'hardware' ? 'verifiedHardware' : 'claimable'
  console.log(`pid=${pid}  loading ${coldMap} to ${N} (LOAD=${LOAD}) ...`)
  for (let i = 0; i < N; i += BATCH) {
    if (LOAD === 'hardware') {
      const fps = []
      for (let j = 0; j < BATCH && i + j < N; j++) fps.push(fp(i + j))
      await send(pid, 'Add-Verified-Hardware', {}, fps.join(','))
    } else {
      const certs = []
      for (let j = 0; j < BATCH && i + j < N; j++) certs.push({ f: fp(i + j), a: addr(i + j) })
      await send(pid, 'Admin-Submit-Operator-Certificates', {}, JSON.stringify(certs))
    }
  }
  const coldBytes = (await (await fetch(`${P(pid)}/now/state/${coldMap}/serialize~json@1.0`)).text()).length
  console.log(`loaded. ${coldMap} ≈ ${coldBytes} bytes. blocked is EMPTY.\n`)

  // Separate the cost centers at this state size:
  //   READ  = marshal-in + view + encode result   (NO persist)
  //   NO-OP = marshal-in + revert(no change) + persist-unchanged
  //   WRITE = marshal-in + mutate-1-key + persist-changed
  const t0 = now(); await getTextNoop(pid); const readMs = now() - t0
  console.log(`READ  (dump, no persist):        ${readMs.toFixed(0)} ms`)
  const nms = await timeSend(pid, 'No-Such-Action-NoOp', {})   // unknown action → no state change, no throw
  console.log(`NO-OP write (persist unchanged): ${nms.toFixed(0)} ms`)

  console.log('--- 3 writes to tiny `blocked` map (mutates blocked only) ---')
  for (let k = 0; k < 3; k++) {
    const ms = await timeSend(pid, 'Block-Operator-Address', { address: '0x' + (k + 1).toString(16).padStart(40, '0').toUpperCase() })
    console.log(`  Block #${k + 1}: ${ms.toFixed(0)} ms`)
  }
  console.log('--- 1 write to big `claimable` map (mutates claimable, big) ---')
  const cms = await timeSend(pid, 'Admin-Submit-Operator-Certificates', {}, JSON.stringify([{ f: fp(N + 1), a: addr(N + 1) }]))
  console.log(`  Admin-Submit(1 cert): ${cms.toFixed(0)} ms`)
  console.log('\nIf Block ≈ Admin-Submit, the blanket strip re-commits the big cold map each slot ⇒ strip-only-dirty would help.')
  process.exit(0)
})().catch(e => { console.error('FATAL', String(e?.stack || e).slice(0, 300)); process.exit(1) })
