// Pin the trigger for silent write-loss. Each scenario is a FRESH process.
// Report, after each write, the target map's key-set (first char) + its committed-list length.
// Run: MODULE_ID=<id> HB_URL=... bun run scripts/tier3-adjacency-probe.ts
import { EthereumSigner } from '@dha-team/arbundles'
import { Wallet } from 'ethers'
import { spawnLuaProcess, sendMessage } from './util/hb-client'

const HB = process.env.HB_URL || 'http://localhost:8734'
const MODULE_ID = process.env.MODULE_ID!
const KEY = (process.env.DEPLOYER_PRIVATE_KEY || '80611882d38e5502d93305c88b64da234fea23037334ecb9a647249076c5fa37').replace(/^0x/, '')
const signer = new EthereumSigner(KEY)
const OWNER = new Wallet('0x' + KEY).address
const P = (pid: string) => `${HB}/${pid}~process@1.0`
const spawn = async (n: string) => (await spawnLuaProcess({ url: HB, signer }, { moduleId: MODULE_ID, tags: [{ name: 'name', value: `${n}-${Date.now()}` }] })).pid
const sendA = async (pid: string, action: string, tags: Record<string, string>, data = '') => {
  const taglist = [{ name: 'action', value: action }, ...Object.entries(tags).map(([name, value]) => ({ name, value }))]
  try { const r = await sendMessage({ url: HB, signer }, { pid, tags: taglist, data }); return r?.slot ?? '?' } catch (e: any) { return `THREW` }
}
// keys of a map + length of its commitments.committed list (the persisted-key set)
const mapInfo = async (pid: string, map: string) => {
  const r = await fetch(`${P(pid)}/now/state/${map}/serialize~json@1.0`)
  const j: any = await r.json().catch(() => ({}))
  const keys = Object.keys(j).filter((k) => k !== 'commitments' && k !== 'device').map((k) => k[0]).sort().join('') || '∅'
  let committed = '?'
  const c = j.commitments && Object.values(j.commitments)[0] as any
  if (c && Array.isArray(c.committed)) committed = String(c.committed.filter((x: string) => x.length === 40).length)
  return `keys=${keys} committed#=${committed}`
}
const F = (c: string) => c.repeat(40)
const A1 = '0x' + 'A'.repeat(40), A2 = '0x' + 'B'.repeat(40)

;(async () => {
  // S_A: hardware, same map, consecutive slots, Add-Verified-Hardware (value=true)
  const H = await spawn('adjH')
  console.log(`\n=== S_A hardware add consecutive (${H}) ===`)
  console.log('add F1 slot', await sendA(H, 'Add-Verified-Hardware', {}, F('1')), '→', await mapInfo(H, 'verifiedHardware'))
  console.log('add F2 slot', await sendA(H, 'Add-Verified-Hardware', {}, F('2')), '→', await mapInfo(H, 'verifiedHardware'))
  console.log('add F3 slot', await sendA(H, 'Add-Verified-Hardware', {}, F('3')), '→', await mapInfo(H, 'verifiedHardware'))
  console.log('EXPECT keys=123')

  // S_B: claimable, same map, consecutive slots, Admin-Submit (value=address)
  const C = await spawn('adjC')
  console.log(`\n=== S_B claimable add consecutive (${C}) ===`)
  for (const f of ['1', '2', '3']) console.log(`add F${f} slot`, await sendA(C, 'Admin-Submit-Operator-Certificates', {}, JSON.stringify([{ f: F(f), a: OWNER }])), '→', await mapInfo(C, 'claimable'))
  console.log('EXPECT keys=123')

  // S_C: claimable adds INTERLEAVED with writes to another map (blocked)
  const I = await spawn('adjI')
  console.log(`\n=== S_C claimable adds interleaved with blocked writes (${I}) ===`)
  console.log('claim F1 slot', await sendA(I, 'Admin-Submit-Operator-Certificates', {}, JSON.stringify([{ f: F('1'), a: OWNER }])), '→', await mapInfo(I, 'claimable'))
  console.log('block A1 slot', await sendA(I, 'Block-Operator-Address', { address: A1 }), '→ claimable', await mapInfo(I, 'claimable'))
  console.log('claim F2 slot', await sendA(I, 'Admin-Submit-Operator-Certificates', {}, JSON.stringify([{ f: F('2'), a: OWNER }])), '→', await mapInfo(I, 'claimable'))
  console.log('block A2 slot', await sendA(I, 'Block-Operator-Address', { address: A2 }), '→ claimable', await mapInfo(I, 'claimable'))
  console.log('claim F3 slot', await sendA(I, 'Admin-Submit-Operator-Certificates', {}, JSON.stringify([{ f: F('3'), a: OWNER }])), '→', await mapInfo(I, 'claimable'))
  console.log('EXPECT claimable keys=123')

  // S_D: single-message batch add (control — known to work in harness section B)
  const B = await spawn('adjB')
  console.log(`\n=== S_D claimable batch add in ONE message (${B}) ===`)
  console.log('batch F1,F2,F3 slot', await sendA(B, 'Admin-Submit-Operator-Certificates', {}, JSON.stringify([{ f: F('1'), a: OWNER }, { f: F('2'), a: OWNER }, { f: F('3'), a: OWNER }])), '→', await mapInfo(B, 'claimable'))
  console.log('EXPECT keys=123')
  process.exit(0)
})().catch(e => { console.error('FATAL', String(e?.stack || e).slice(0, 300)); process.exit(1) })
