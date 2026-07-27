// W-A.5c — relay-rewards DURABILITY / message-size ceiling on a live node. Drives Add-Scores at
// increasing fingerprint counts against the seeded (~719KB) process to find where the node stops
// ACCEPTING + COMPUTING a single message — that ceiling sets the staged-path batch size. Cancels
// each pending round between sizes to keep state clean. (Bundler/Arweave durability is checked
// separately.)
// Run: HB_URL=http://localhost:8734 MODULE_ID=<seed id> bun run scripts/tier3-relay-durability.ts
import { EthereumSigner } from '@dha-team/arbundles'
import { fetchNodeAddress, spawnLuaProcess, sendMessage, readState } from './util/hb-client'
import { seedEnvelopeFor } from './util/native-bundle'

const HB = process.env.HB_URL || 'http://localhost:8734'
const MODULE_ID = process.env.MODULE_ID
if (!MODULE_ID) { console.error('MODULE_ID env required'); process.exit(2) }
const KEY = (process.env.DEPLOYER_PRIVATE_KEY || '80611882d38e5502d93305c88b64da234fea23037334ecb9a647249076c5fa37').replace(/^0x/, '')
const signer = new EthereumSigner(KEY)
const AA = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'

const SIZES = (process.env.SIZES || '420,1000,2000,4000,9750').split(',').map(Number)
const PREV_TS = 1783064041960   // seeded PreviousRound.Timestamp; each round must exceed it

const mkScores = (n: number) => {
  const Scores: Record<string, any> = {}
  for (let i = 0; i < n; i++) {
    const fp = i.toString(16).padStart(40, '0').toUpperCase()   // unique valid 40-hex fingerprint
    Scores[fp] = { Address: AA, Network: 1000, IsHardware: false, UptimeStreak: 1, ExitBonus: false, FamilySize: 1, LocationSize: 1 }
  }
  return JSON.stringify({ Scores })
}

let pid: string
;(async () => {
  console.log(`node ${await fetchNodeAddress(HB)}  moduleId=${MODULE_ID}`)
  const r = await spawnLuaProcess({ url: HB, signer }, { moduleId: MODULE_ID, spawnData: seedEnvelopeFor('relay-rewards'), tags: [{ name: 'name', value: `relay-dura-${Date.now()}` }] })
  pid = r.pid
  console.log(`spawned pid=${pid}\n`)
  console.log('  n      bytes    add-status(ms)   staged?   complete(ms)   settled?')

  for (let i = 0; i < SIZES.length; i++) {
    const n = SIZES[i]
    const ts = PREV_TS + 3600000 + i   // distinct round per size, all > seeded prevTs
    const data = mkScores(n)
    const bytes = Buffer.byteLength(data)
    let addMs = 0, addOk = false, staged = -1, compMs = 0, settled = false
    try {
      const t0 = performance.now()
      await sendMessage({ url: HB, signer }, { pid, tags: [{ name: 'action', value: 'Add-Scores' }, { name: 'round-timestamp', value: String(ts) }], data })
      addMs = Math.round(performance.now() - t0); addOk = true
      // confirm it staged (count keys under PendingRounds/<ts>)
      const pr = await readState({ url: HB }, pid, `state/PendingRounds/${ts}/serialize~json@1.0`).catch(() => '{}')
      try { const m = JSON.parse(pr); staged = Object.keys(m).filter(k => /^[0-9A-F]{40}$/.test(k)).length } catch { staged = -1 }
      // complete the round to test compute+persist at size
      const t1 = performance.now()
      await sendMessage({ url: HB, signer }, { pid, tags: [{ name: 'action', value: 'Complete-Round' }, { name: 'round-timestamp', value: String(ts) }] })
      compMs = Math.round(performance.now() - t1)
      const out = await readState({ url: HB }, pid, 'results/output/data').catch(() => 'error')
      settled = out.trim().startsWith('{') && !out.includes('error')
    } catch (e: any) {
      console.log(`  ${String(n).padEnd(6)} ${String(bytes).padEnd(8)} ADD FAILED: ${String(e?.message || e).slice(0, 90)}`)
      continue
    }
    console.log(`  ${String(n).padEnd(6)} ${String(bytes).padEnd(8)} ${addOk ? 'ok' : 'FAIL'} ${String(addMs).padStart(6)}ms      ${staged === n ? staged + '✓' : staged + '≠' + n}   ${String(compMs).padStart(6)}ms      ${settled ? 'yes✓' : 'NO'}`)
  }
  console.log(`\npid=${pid}`)
  process.exit(0)
})().catch(e => { console.error('FATAL', String(e?.stack || e).slice(0, 400)); process.exit(2) })
