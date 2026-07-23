// Decisive: does an error slot cause LOST writes (persist-loss) or a stale `now` (read lag)?
// Proc A: three good writes, no error   → baseline, expect {F1,F2,F3}
// Proc B: good, ERROR, good, good, good → find exactly which persist; re-read at end.
// Track at-slot to correlate. Run: MODULE_ID=<id> HB_URL=... bun run scripts/tier3-persist-probe.ts
import { EthereumSigner } from '@dha-team/arbundles'
import { Wallet } from 'ethers'
import { spawnLuaProcess, sendMessage } from './util/hb-client'

const HB = process.env.HB_URL || 'http://localhost:8734'
const MODULE_ID = process.env.MODULE_ID!
const KEY = (process.env.DEPLOYER_PRIVATE_KEY || '80611882d38e5502d93305c88b64da234fea23037334ecb9a647249076c5fa37').replace(/^0x/, '')
const signer = new EthereumSigner(KEY)
const OWNER = new Wallet('0x' + KEY).address
const P = (pid: string) => `${HB}/${pid}~process@1.0`
const atSlot = async (pid: string) => (await fetch(`${P(pid)}/now/at-slot`)).text().catch(() => '?')
const claimable = async (pid: string) => {
  const r = await fetch(`${P(pid)}/now/~lua@5.3a/dump`); const j: any = await r.json().catch(() => ({}))
  return Object.keys(j.claimable ?? {}).map((k) => k[0]).sort().join('') || '∅'
}
const submit = async (pid: string, f: string, a = OWNER) => {
  const taglist = [{ name: 'action', value: 'Admin-Submit-Operator-Certificates' }]
  try { const r = await sendMessage({ url: HB, signer }, { pid, tags: taglist, data: JSON.stringify([{ f, a }]) }); return `slot=${r?.slot ?? '?'}` }
  catch (e: any) { return `THREW ${String(e?.message || e).slice(0, 40)}` }
}
const F1 = '1'.repeat(40), F2 = '2'.repeat(40), F3 = '3'.repeat(40), F4 = '4'.repeat(40)
const BAD = 'nothex' + 'z'.repeat(34)
const spawn = async (n: string) => (await spawnLuaProcess({ url: HB, signer }, { moduleId: MODULE_ID, tags: [{ name: 'name', value: `${n}-${Date.now()}` }] })).pid

;(async () => {
  const A = await spawn('probeA')
  console.log(`\n=== Proc A (no errors) ${A} ===`)
  console.log('add F1 →', await submit(A, F1), ' at-slot=', await atSlot(A), ' claimable=', await claimable(A))
  console.log('add F2 →', await submit(A, F2), ' at-slot=', await atSlot(A), ' claimable=', await claimable(A))
  console.log('add F3 →', await submit(A, F3), ' at-slot=', await atSlot(A), ' claimable=', await claimable(A))
  console.log('EXPECT claimable=123')

  const B = await spawn('probeB')
  console.log(`\n=== Proc B (error mid-stream) ${B} ===`)
  console.log('add F1 →', await submit(B, F1), ' at-slot=', await atSlot(B), ' claimable=', await claimable(B))
  console.log('ERROR  →', await submit(B, BAD), ' at-slot=', await atSlot(B), ' claimable=', await claimable(B))
  console.log('add F2 →', await submit(B, F2), ' at-slot=', await atSlot(B), ' claimable=', await claimable(B))
  console.log('add F3 →', await submit(B, F3), ' at-slot=', await atSlot(B), ' claimable=', await claimable(B))
  console.log('add F4 →', await submit(B, F4), ' at-slot=', await atSlot(B), ' claimable=', await claimable(B))
  console.log('--- re-read B claimable 3x (is it a now lag?) ---')
  for (let i = 0; i < 3; i++) console.log(`  reread[${i}] at-slot=`, await atSlot(B), ' claimable=', await claimable(B))
  console.log('  B latest results/output/data =', (await (await fetch(`${P(B)}/now/results/output/data`)).text()).slice(0, 80))

  // Proc C: mirror the harness EXACTLY — read results/output/data after every send.
  const readOut = async (pid: string) => (await (await fetch(`${P(pid)}/now/results/output/data`)).text()).trim()
  const submitThenRead = async (pid: string, f: string) => {
    const r = await submit(pid, f); const out = await readOut(pid); return `${r} out=${out.slice(0, 24)}`
  }
  const C = await spawn('probeC')
  console.log(`\n=== Proc C (harness pattern: read output after each send) ${C} ===`)
  console.log('add F1 →', await submitThenRead(C, F1), ' claimable=', await claimable(C))
  console.log('add F2 →', await submitThenRead(C, F2), ' claimable=', await claimable(C))
  console.log('add F3 →', await submitThenRead(C, F3), ' claimable=', await claimable(C))
  console.log('EXPECT claimable=123')
  process.exit(0)
})().catch(e => { console.error('FATAL', String(e?.stack || e).slice(0, 300)); process.exit(1) })
