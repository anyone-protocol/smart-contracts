// Isolate the validate-harness failure 4: an Admin-Submit that returns OK but whose
// claimable[fp] never persists. Two hypotheses, each on a FRESH process:
//   S1 write-after-revert: does a good write land right after a reverting (error) write?
//   S2 re-add-after-delete: does re-adding a claimable key that was earlier claimed away
//      (set to nil) persist? (FP_A in the harness was claimed→deleted→re-added.)
// Run: MODULE_ID=<id> HB_URL=http://localhost:8734 bun run scripts/tier3-readd-repro.ts
import { EthereumSigner } from '@dha-team/arbundles'
import { Wallet } from 'ethers'
import { spawnLuaProcess, sendMessage } from './util/hb-client'

const HB = process.env.HB_URL || 'http://localhost:8734'
const MODULE_ID = process.env.MODULE_ID!
const KEY = (process.env.DEPLOYER_PRIVATE_KEY || '80611882d38e5502d93305c88b64da234fea23037334ecb9a647249076c5fa37').replace(/^0x/, '')
const signer = new EthereumSigner(KEY)
const OWNER = new Wallet('0x' + KEY).address
const norm = (a: string) => a   // addresses stored verbatim EIP-55; inputs are already EIP-55
const P = (pid: string) => `${HB}/${pid}~process@1.0`
const raw = async (pid: string, key: string) => {
  const r = await fetch(`${P(pid)}/now/${key}`)
  return `[${r.status}] ${(await r.text()).slice(0, 60).replace(/\s+/g, ' ')}`
}
const dumpClaimable = async (pid: string) => {
  const r = await fetch(`${P(pid)}/now/~lua@5.3a/dump`)
  const j: any = await r.json().catch(() => ({}))
  return JSON.stringify(j.claimable ?? null)
}
const send = async (pid: string, action: string, tags: Record<string, string> = {}, data = '') => {
  const taglist = [{ name: 'action', value: action }, ...Object.entries(tags).map(([name, value]) => ({ name, value }))]
  try { await sendMessage({ url: HB, signer }, { pid, tags: taglist, data }); return (await raw(pid, 'results/output/data')).replace(/^\[\d+\] /, '') }
  catch (e: any) { return `THREW ${String(e?.message || e).slice(0, 50)}` }
}

// Valid 40-char fingerprints: pattern is [0123456789ABCDEF] (UPPERCASE hex only).
const X = '1'.repeat(40), Y = '2'.repeat(40), Z = '3'.repeat(40)
const BAD = 'nothex' + 'z'.repeat(34)

;(async () => {
  const { pid } = await spawnLuaProcess({ url: HB, signer }, { moduleId: MODULE_ID, tags: [{ name: 'name', value: `readd-${Date.now()}` }] })
  console.log(`pid=${pid}  OWNER=${OWNER}  norm=${norm(OWNER)}\n`)

  console.log('=== S1: write-after-revert ===')
  console.log('w1 good  →', await send(pid, 'Admin-Submit-Operator-Certificates', {}, JSON.stringify([{ f: X, a: OWNER }])))
  console.log('  claimable/X:', await raw(pid, `state/claimable/${X}`), ' claimable=', await dumpClaimable(pid))
  console.log('err bad  →', await send(pid, 'Admin-Submit-Operator-Certificates', {}, JSON.stringify([{ f: BAD, a: OWNER }])))
  console.log('w2 good  →', await send(pid, 'Admin-Submit-Operator-Certificates', {}, JSON.stringify([{ f: Y, a: OWNER }])))
  console.log('  claimable/Y:', await raw(pid, `state/claimable/${Y}`), ' claimable=', await dumpClaimable(pid))

  console.log('\n=== S2: re-add-after-delete ===')
  console.log('add Z    →', await send(pid, 'Admin-Submit-Operator-Certificates', {}, JSON.stringify([{ f: Z, a: OWNER }])))
  console.log('  claimable/Z:', await raw(pid, `state/claimable/${Z}`), ' claimable=', await dumpClaimable(pid))
  console.log('claim Z  →', await send(pid, 'Submit-Fingerprint-Certificate', { 'fingerprint-certificate': Z }))
  console.log('  claimable/Z:', await raw(pid, `state/claimable/${Z}`), ' verified/Z:', await raw(pid, `state/verified/${Z}`), ' claimable=', await dumpClaimable(pid))
  console.log('re-add Z →', await send(pid, 'Admin-Submit-Operator-Certificates', {}, JSON.stringify([{ f: Z, a: OWNER }])))
  console.log('  claimable/Z:', await raw(pid, `state/claimable/${Z}`), ' claimable=', await dumpClaimable(pid))
  process.exit(0)
})().catch(e => { console.error('FATAL', String(e?.stack || e).slice(0, 300)); process.exit(1) })
