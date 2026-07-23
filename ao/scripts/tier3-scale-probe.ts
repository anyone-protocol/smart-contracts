// SCALE + PERF probe for the operator-registry native shape at REAL magnitude.
// Live operator-registry: verified≈7932, claimable≈2940 (string→address), hardware≈1088 (bool);
// state file ≈1–2MB. We previously hit push-400 at ~1MB assignment (Arweave flush). This grows the
// STRING-valued `claimable` map across slots (the exact case strip-on-write re-commits every slot)
// and measures: per-slot write latency, state byte-size, read latencies — and catches the size wall.
// Run: MODULE_ID=<strip-on-write id> HB_URL=... [TARGET=8000 BATCH=200] bun run scripts/tier3-scale-probe.ts
import { EthereumSigner } from '@dha-team/arbundles'
import { spawnLuaProcess, sendMessage } from './util/hb-client'

const HB = process.env.HB_URL || 'http://localhost:8734'
const MODULE_ID = process.env.MODULE_ID!
const TARGET = Number(process.env.TARGET || 8000)
const BATCH = Number(process.env.BATCH || 200)
// MODE=claimable (string map, Admin-Submit) | hardware (bool map, Add-Verified-Hardware).
// hardware accumulates across slots WITHOUT strip-on-write (ao-types forces full re-derive) —
// run it on the NO-STRIP module to isolate whether the O(n)/slot write cost is the strip or inherent.
const MODE = process.env.MODE || 'claimable'
const MAP = MODE === 'hardware' ? 'verifiedHardware' : 'claimable'
const KEY = (process.env.DEPLOYER_PRIVATE_KEY || '80611882d38e5502d93305c88b64da234fea23037334ecb9a647249076c5fa37').replace(/^0x/, '')
const signer = new EthereumSigner(KEY)
const P = (pid: string) => `${HB}/${pid}~process@1.0`
const now = () => performance.now()

// deterministic synthetic entries: fp = 40 UPPERCASE hex, addr = 0x + 40 hex
const fp = (i: number) => i.toString(16).toUpperCase().padStart(40, '0')
const addr = (i: number) => '0x' + i.toString(16).padStart(40, '0')

const timed = async <T>(f: () => Promise<T>): Promise<[T, number]> => { const t = now(); const r = await f(); return [r, now() - t] }
const getText = (pid: string, key: string) => fetch(`${P(pid)}/now/${key}`).then(r => r.text())

;(async () => {
  console.log(`node=${HB} module=${MODULE_ID}  MODE=${MODE} map=${MAP}  TARGET=${TARGET} BATCH=${BATCH}`)
  const { pid } = await spawnLuaProcess({ url: HB, signer }, { moduleId: MODULE_ID, tags: [{ name: 'name', value: `scale-${Date.now()}` }] })
  console.log(`pid=${pid}\n`)
  console.log(`entries | slot | writeMs | ${MAP}Bytes | dumpMs | statusMs | 1keyMs`)

  let i = 0, wall = false
  while (i < TARGET && !wall) {
    let action: string, data: string
    if (MODE === 'hardware') {
      const fps = []
      for (let j = 0; j < BATCH && i + j < TARGET; j++) fps.push(fp(i + j))
      action = 'Add-Verified-Hardware'; data = fps.join(',')
    } else {
      const certs = []
      for (let j = 0; j < BATCH && i + j < TARGET; j++) certs.push({ f: fp(i + j), a: addr(i + j) })
      action = 'Admin-Submit-Operator-Certificates'; data = JSON.stringify(certs)
    }
    const count = Math.min(BATCH, TARGET - i)
    const t = now()
    try {
      await sendMessage({ url: HB, signer }, { pid, tags: [{ name: 'action', value: action }], data })
    } catch (e: any) {
      console.log(`\n>>> PUSH FAILED at ~${i} entries: ${String(e?.message || e).slice(0, 160)}`)
      wall = true; break
    }
    const writeMs = now() - t
    i += count

    // checkpoint measurements every ~1000 entries (and at the end)
    if (i % 1000 === 0 || i >= TARGET) {
      const slot = (await getText(pid, 'at-slot')).trim()
      const [mapBody] = await timed(() => getText(pid, `state/${MAP}/serialize~json@1.0`))
      const [, dumpMs] = await timed(() => getText(pid, '~lua@5.3a/dump'))
      const [statusBody, statusMs] = await timed(() => getText(pid, '~lua@5.3a/status'))
      const [, keyMs] = await timed(() => getText(pid, `state/${MAP}/${fp(i - 1)}`))
      const cnt = (() => { try { const c = JSON.parse(statusBody).counts; return MODE === 'hardware' ? c?.hardware : c?.claimable } catch { return '?' } })()
      console.log(`${String(i).padStart(7)} | ${String(slot).padStart(4)} | ${writeMs.toFixed(0).padStart(6)} | ${String(mapBody.length).padStart(14)} | ${dumpMs.toFixed(0).padStart(6)} | ${statusMs.toFixed(0).padStart(7)} | ${keyMs.toFixed(0).padStart(6)}  (status.count=${cnt})`)
    }
  }
  console.log(`\nDONE: loaded ~${i} claimable entries across ~${Math.ceil(i / BATCH)} slots${wall ? ' (HIT SIZE WALL)' : ''}`)
  process.exit(0)
})().catch(e => { console.error('FATAL', String(e?.stack || e).slice(0, 400)); process.exit(1) })
