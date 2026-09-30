// A16 "bug vs by-design" test — run against the NO-STRIP module (bug present).
// Mechanism prediction (do_normalize_commitments verify-mode stale-committed reuse):
//   P1  update an EXISTING string key's value across slots  → PERSISTS (value change ⇒ ID differs ⇒ full re-derive)
//   P2  add a NEW string key alone across slots             → DROPPED  (no committed value changed ⇒ ID matches ⇒ stale kept)
//   P3  update existing key AND add a new key in one slot   → BOTH persist (the update forces re-derive, which covers the new key)
// If P1 & P3 hold, string maps are NOT immutable-by-design — only pure cross-slot key-ADD is broken ⇒ a bug.
// Run: MODULE_ID=<no-strip id> HB_URL=... bun run scripts/tier3-a16-mechanism.ts
import { EthereumSigner } from '@dha-team/arbundles'
import { Wallet } from 'ethers'
import { spawnLuaProcess, sendMessage } from './util/hb-client'

const HB = process.env.HB_URL || 'http://localhost:8734'
const MODULE_ID = process.env.MODULE_ID!
const KEY = (process.env.DEPLOYER_PRIVATE_KEY || '80611882d38e5502d93305c88b64da234fea23037334ecb9a647249076c5fa37').replace(/^0x/, '')
const OP_KEY = '59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d'
const signer = new EthereumSigner(KEY)
const OWNER = new Wallet('0x' + KEY).address, OP = new Wallet('0x' + OP_KEY).address
const norm = (a: string) => a   // addresses stored verbatim EIP-55; inputs are already EIP-55
const P = (pid: string) => `${HB}/${pid}~process@1.0`
const claimable = async (pid: string) => {
  const r = await fetch(`${P(pid)}/as/dump`); const j: any = await r.json().catch(() => ({}))
  return j.claimable ?? {}
}
const submit = async (pid: string, certs: any[]) => {
  try { const r = await sendMessage({ url: HB, signer }, { pid, tags: [{ name: 'action', value: 'Admin-Submit-Operator-Certificates' }], data: JSON.stringify(certs) }); return r?.slot } catch (e: any) { return `THREW` }
}
const F1 = '1'.repeat(40), F2 = '2'.repeat(40)
const show = (m: any) => JSON.stringify(Object.fromEntries(Object.entries(m).map(([k, v]) => [k[0].repeat(3), String(v).slice(0, 6)])))

;(async () => {
  const pid = (await spawnLuaProcess({ url: HB, signer }, { moduleId: MODULE_ID, tags: [{ name: 'name', value: `a16m-${Date.now()}` }] })).pid
  console.log(`pid=${pid}  (module=${MODULE_ID})\n`)

  console.log('slot1 add F1=OWNER              →', await submit(pid, [{ f: F1, a: OWNER }]), show(await claimable(pid)))
  const s2 = await submit(pid, [{ f: F1, a: OP }])
  const c2 = await claimable(pid)
  console.log('slot2 UPDATE F1 → OP  (P1)      →', s2, show(c2), c2[F1] === norm(OP) ? 'P1 PERSISTED ✓' : 'P1 DROPPED ✗')

  const s3 = await submit(pid, [{ f: F1, a: OWNER }, { f: F2, a: OWNER }])
  const c3 = await claimable(pid)
  console.log('slot3 UPDATE F1→OWNER + ADD F2  →', s3, show(c3),
    `[F1 update ${c3[F1] === norm(OWNER) ? '✓' : '✗'}] [F2 add ${c3[F2] === norm(OWNER) ? 'RESCUED ✓ (P3)' : 'DROPPED ✗'}]`)

  // Control: pure add on a fresh key with no update in the same slot (P2)
  const s4 = await submit(pid, [{ f: '3'.repeat(40), a: OWNER }])
  const c4 = await claimable(pid)
  console.log('slot4 pure-ADD F3 (no update,P2)→', s4, show(c4), c4['3'.repeat(40)] ? 'P2 add persisted' : 'P2 DROPPED ✗ (pure add lost)')
  process.exit(0)
})().catch(e => { console.error('FATAL', String(e?.stack || e).slice(0, 300)); process.exit(1) })
