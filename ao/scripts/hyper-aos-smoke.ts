// WS-2: hyper-aos (aos ported to the native lua@5.3a device) smoke test via
// the native client — spawn a hyper-aos process, Eval lua code as the owner,
// read the result. Exercises the aos-level owner/trust chain, which is where
// the EVM getOwner gap lives (stock hyper-aos only recognizes
// rsa-pss-sha512 committers).
//
// Env:
//   HB_URL       node (default local scratch node)
//   SIGNER       arweave | ethereum   (default arweave)
//   MODULE_FILE  lua module source to inline  (default stock hyper-aos.lua)
//   MODULE_ID    spawn by module id instead of inline (FR-recommended flow)
// Runs:
//   SIGNER=arweave  bun run scripts/hyper-aos-smoke.ts   # stock: green
//   SIGNER=ethereum bun run scripts/hyper-aos-smoke.ts   # stock: not trusted
import { readFileSync } from 'fs'
import { createHash } from 'crypto'
import { ArweaveSigner, EthereumSigner } from '@dha-team/arbundles'
import { computeAddress } from 'ethers'
import { fetchNodeAddress, spawnLuaProcess, sendMessage, readState } from './util/hb-client'

const HB_URL = process.env.HB_URL || 'http://localhost:8734'
const SIGNER = process.env.SIGNER || 'arweave'
const MODULE_FILE = process.env.MODULE_FILE
  || '/var/home/jim/dev/anyone-protocol/hyperbeam/test/hyper-aos.lua'
const MODULE_ID = process.env.MODULE_ID
const ETH_KEY = process.env.DEPLOYER_PRIVATE_KEY
  || '80611882d38e5502d93305c88b64da234fea23037334ecb9a647249076c5fa37' // dev test wallet
const AR_KEYFILE = process.env.AR_KEYFILE
  || '/var/home/jim/dev/anyone-protocol/smart-contracts/.keys/arweave-keyfile-o0sHrAFkZDVoQdi-omGRr3jp3xMwSGU9be7Xj6cKLdg.json'

function makeSigner () {
  if (SIGNER === 'ethereum') {
    const key = ETH_KEY.replace(/^0x/, '')
    return { signer: new EthereumSigner(key), address: computeAddress('0x' + key) }
  }
  const jwk = JSON.parse(readFileSync(AR_KEYFILE, 'utf-8'))
  const address = createHash('sha256')
    .update(Buffer.from(jwk.n, 'base64url'))
    .digest('base64url')
  return { signer: new ArweaveSigner(jwk), address }
}

;(async () => {
  const { signer, address } = makeSigner()
  const config = { url: HB_URL, signer }
  console.log(`node:   ${HB_URL} (${await fetchNodeAddress(HB_URL)})`)
  console.log(`signer: ${SIGNER} ${address}`)
  console.log(`module: ${MODULE_ID ?? MODULE_FILE}`)

  console.log('1) spawn hyper-aos process (authority = signer)...')
  const { pid, slot } = await spawnLuaProcess(config, {
    ...(MODULE_ID ? { moduleId: MODULE_ID } : { luaSource: readFileSync(MODULE_FILE, 'utf-8') }),
    authority: address,
    tags: [{ name: 'name', value: `hyper-aos-smoke-${Date.now()}` }],
  })
  console.log(`   pid = ${pid} (slot ${slot})`)

  console.log('2) Eval "return 1 + 41" as owner...')
  await sendMessage(config, {
    pid,
    tags: [{ name: 'action', value: 'Eval' }],
    data: 'return 1 + 41',
  })
  const out1 = await readState(config, pid, 'results/output/data')
  console.log(`   results/output/data = ${JSON.stringify(out1)}`)

  console.log('3) Eval stateful code (Count increment + Send)...')
  await sendMessage(config, {
    pid,
    tags: [{ name: 'action', value: 'Eval' }],
    data: "Count = (Count or 0) + 1; Send({ Target = 'Foo', Data = 'Bar' }); return Count",
  })
  const out2 = await readState(config, pid, 'results/output/data')
  const prompt = await readState(config, pid, 'results/output/prompt').catch(() => 'n/a')
  console.log(`   results/output/data = ${JSON.stringify(out2)} (prompt: ${JSON.stringify(prompt)})`)

  if (out1 === 'Message is not trusted.') {
    console.log('\nRESULT: NOT TRUSTED — aos owner/trust chain rejected the signer (expected for stock hyper-aos + EVM).')
    process.exit(2)
  }
  if (out1 !== '42' || out2 !== '1') throw new Error(`unexpected eval results: ${out1}, ${out2}`)
  console.log('\nHYPER-AOS SMOKE GREEN ✓ (spawn + owner Eval + state via native client)')
  process.exit(0)
})().catch(e => { console.error('\nHYPER-AOS SMOKE FAILED:', String(e?.message || e).slice(0, 400)); process.exit(1) })
