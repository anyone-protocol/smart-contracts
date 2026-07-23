// Confirm the vendored keccak+EIP-55 runs correctly on the ACTUAL device luerl (not just the
// Tier-2 image): spawn a process, Eval the lib + a checksum call, compare to ethers.getAddress.
// Run: MODULE_ID=<id> HB_URL=... bun run scripts/tier3-keccak-eval.ts
import { EthereumSigner } from '@dha-team/arbundles'
import { getAddress } from 'ethers'
import fs from 'fs'
import path from 'path'
import { spawnLuaProcess, sendMessage } from './util/hb-client'

const HB = process.env.HB_URL || 'http://localhost:8734'
const MODULE_ID = process.env.MODULE_ID!
const KEY = (process.env.DEPLOYER_PRIVATE_KEY || '80611882d38e5502d93305c88b64da234fea23037334ecb9a647249076c5fa37').replace(/^0x/, '')
const signer = new EthereumSigner(KEY)
const P = (pid: string) => `${HB}/${pid}~process@1.0`
const lib = fs.readFileSync(path.join(import.meta.dir, 'util', 'eip55-lib.lua'), 'utf-8')

const cases = [
  '0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed',
  '0xdbf03b407c01e7cd3cbea99509d93f8dddc8c6fb',
  '0xD1220A0CF47C7B9BE7A2E6BA89F429762E7B9ADB',  // all-caps input → must canonicalize
  '0x70997970c51812dc3a010c7d01b50e0d17dc79c8',  // OP
]

;(async () => {
  const { pid } = await spawnLuaProcess({ url: HB, signer }, { moduleId: MODULE_ID, tags: [{ name: 'name', value: `keccak-${Date.now()}` }] })
  console.log(`pid=${pid}\n`)
  const raw = (key: string) => fetch(`${P(pid)}/now/${key}`).then(r => r.text())
  let allok = true
  for (const a of cases) {
    const t = performance.now()
    await sendMessage({ url: HB, signer }, { pid, tags: [{ name: 'action', value: 'Eval' }], data: `${lib}\nreturn to_eip55("${a}")` })
    const got = (await raw('results/output/data')).trim()
    const ms = (performance.now() - t).toFixed(0)
    const want = getAddress(a)
    const ok = got === want
    allok = allok && ok
    console.log(`${ok ? 'OK  ' : 'FAIL'} [${ms}ms] ${got}${ok ? '' : `  want ${want}`}`)
  }
  console.log(`\n${allok ? 'DEVICE keccak+EIP-55 == ethers ✓' : 'MISMATCH ✗'}`)
  process.exit(allok ? 0 : 1)
})().catch(e => { console.error('FATAL', String(e?.stack || e).slice(0, 300)); process.exit(1) })
