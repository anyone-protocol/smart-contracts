// Clean stepwise probe of the post-Block instability. dump-reads (whole state) after each
// step so we see exactly where state/reads diverge. Run: HB_URL=... MODULE_ID=<id> bun run ...
import { EthereumSigner } from '@dha-team/arbundles'
import { spawnLuaProcess, sendMessage } from './util/hb-client'

const HB = process.env.HB_URL || 'http://localhost:8734'
const MODULE_ID = process.env.MODULE_ID!
const KEY = (process.env.DEPLOYER_PRIVATE_KEY || '80611882d38e5502d93305c88b64da234fea23037334ecb9a647249076c5fa37').replace(/^0x/, '')
const signer = new EthereumSigner(KEY)
const P = (pid: string) => `${HB}/${pid}~process@1.0`
const dump = async (pid: string) => {
  const r = await fetch(`${P(pid)}/now/~lua@5.3a/dump`)
  return `[${r.status}] ${(await r.text()).slice(0, 240).replace(/\s+/g, ' ')}`
}
const A = 'A'.repeat(40), B = 'B'.repeat(40), ADDR = '0x' + 'A'.repeat(40)

;(async () => {
  const { pid } = await spawnLuaProcess({ url: HB, signer }, { moduleId: MODULE_ID, tags: [{ name: 'name', value: `probe-${Date.now()}` }] })
  console.log(`pid=${pid}`)
  const step = async (label: string, action: string, tags: Record<string, string> = {}, data = '') => {
    const taglist = [{ name: 'action', value: action }, ...Object.entries(tags).map(([name, value]) => ({ name, value }))]
    let res = 'OK'
    try { const r = await sendMessage({ url: HB, signer }, { pid, tags: taglist, data }); res = `slot=${r.slot}` }
    catch (e: any) { res = `PUSH-400/THREW ${String(e?.message || e).slice(0, 60)}` }
    console.log(`\n${label} → ${res}`)
    console.log(`  dump: ${await dump(pid)}`)
  }
  const ADDR2 = '0x' + 'B'.repeat(40)
  await step('1. Block(ADDR)          ', 'Block-Operator-Address', { address: ADDR })
  await step('2. Block(ADDR2)         ', 'Block-Operator-Address', { address: ADDR2 })
  await step('3. Unblock(ADDR) leaves B', 'Unblock-Operator-Address', { address: ADDR })   // blocked still {ADDR2}
  await step('4. Unblock(ADDR2) EMPTIES', 'Unblock-Operator-Address', { address: ADDR2 })  // blocked -> {}
  process.exit(0)
})().catch(e => { console.error('FATAL', String(e?.stack || e).slice(0, 300)); process.exit(1) })
