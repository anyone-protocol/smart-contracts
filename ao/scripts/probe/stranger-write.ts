// Can an ARBITRARY wallet (not the allow-listed dev signer) write on hb-dev?
//
// This decides whether the dashboard's two open operator actions
// (Submit-Fingerprint-Certificate / Renounce-Fingerprint-Certificate) can be exercised from a
// browser wallet during local testing, or whether every test wallet has to be allow-listed first.
import { EthereumSigner } from '@dha-team/arbundles'
import { Wallet } from 'ethers'
import { spawnLuaProcess, sendMessage } from '../util/hb-client'

const HB = process.env.HB_URL || 'https://hb-dev.anyone.tech'
const KEY = process.env.DEPLOYER_PRIVATE_KEY
if (!KEY) throw new Error('DEPLOYER_PRIVATE_KEY required')

const LUA = `
function compute(process, message, opts)
  process.results = { output = { data = 'OK' } }
  return process
end
`

;(async () => {
  const rand = Wallet.createRandom()
  console.log(`node   : ${HB}`)
  console.log(`stranger wallet: ${rand.address}\n`)

  const dev = { url: HB, signer: new EthereumSigner(KEY.replace(/^0x/, '')) }
  const { pid } = await spawnLuaProcess(dev, {
    luaSource: LUA,
    tags: [{ name: 'name', value: `stranger-write-${Date.now()}` }],
  })
  console.log('spawned by the allow-listed key:', pid)

  const stranger = { url: HB, signer: new EthereumSigner(rand.privateKey.replace(/^0x/, '')) }
  try {
    const r = await sendMessage(stranger, { pid, tags: [{ name: 'action', value: 'Ping' }], data: '' })
    console.log(`\nSTRANGER WRITE: ACCEPTED (slot ${r.slot})`)
    console.log('=> a browser wallet can write on this node; no allow-listing needed to test.')
  } catch (e: any) {
    console.log(`\nSTRANGER WRITE: REJECTED — ${String(e?.message || e).slice(0, 200)}`)
    console.log('=> every test wallet must be allow-listed first; plan the fixture around that.')
  }
})()
