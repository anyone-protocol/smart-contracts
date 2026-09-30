// Proves the browser write path: a NON-PRIVILEGED wallet claims a fingerprint with LOWERCASE tag
// names (what ao-client requires), and the contract reads them because native.lua's `foldTags`
// title-cases every tag name back before a handler sees it.
import { EthereumSigner } from '@dha-team/arbundles'
import { Wallet } from 'ethers'
import fs from 'fs'
import path from 'path'
import { spawnLuaProcess, sendMessage } from '../util/hb-client'

const HB = process.env.HB_URL || 'http://localhost:8734'
const KEY = process.env.DEPLOYER_PRIVATE_KEY!
const AO = path.resolve(import.meta.dir, '..', '..')
const admin = { url: HB, signer: new EthereumSigner(KEY.replace(/^0x/, '')) }

const FP = 'C'.repeat(40)
const operator = Wallet.createRandom()

const view = async (pid: string, v: string, qs = '') =>
  JSON.parse(await (await fetch(`${HB}/${pid}~process@1.0/as/${v}${qs}`)).text())

;(async () => {
  const { pid } = await spawnLuaProcess(admin, {
    luaSource: fs.readFileSync(path.join(AO, 'dist/operator-registry-native.lua'), 'utf8'),
    tags: [{ name: 'name', value: `claim-casing-${Date.now()}` }],
  })
  console.log('opreg:', pid)
  console.log('operator (fresh, non-privileged):', operator.address)

  await sendMessage(admin, {
    pid,
    tags: [{ name: 'action', value: 'Admin-Submit-Operator-Certificates' }],
    data: JSON.stringify([{ f: FP, a: operator.address }]),
  })
  const before = await view(pid, 'operator', `?address=${operator.address}`)
  console.log('claimable before:', Object.keys(before.claimable || {}).length,
              '| verified before:', Object.keys(before.verified || {}).length)

  // THE CLAIM — exactly what the dashboard now sends: lowercase tag names.
  const self = { url: HB, signer: new EthereumSigner(operator.privateKey.replace(/^0x/, '')) }
  const res = await sendMessage(self, {
    pid,
    tags: [
      { name: 'action', value: 'Submit-Fingerprint-Certificate' },
      { name: 'fingerprint-certificate', value: FP },
      { name: 'ui-cache-key', value: `claim-${Date.now()}` },
    ],
    data: '',
  })
  console.log('claim sent, slot', res.slot)

  const after = await view(pid, 'operator', `?address=${operator.address}`)
  const verified = Object.keys(after.verified || {})
  const claimable = Object.keys(after.claimable || {})
  console.log('claimable after :', claimable.length, '| verified after :', verified.length)
  const ok = verified.includes(FP) && !claimable.includes(FP)
  console.log(`\n${ok ? 'PASS' : 'FAIL'} — lowercase tags accepted, fingerprint moved claimable -> verified`)
  process.exit(ok ? 0 : 1)
})()
