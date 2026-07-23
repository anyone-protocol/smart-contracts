// Tier-3 deploy: spawn the NATIVE operator-registry on the local node, populate it with
// realistic data (owner = deploy wallet), and print a menu of ready-to-poke URLs.
// Run: HB_URL=http://localhost:8734 bun run scripts/tier3-deploy.ts
import { EthereumSigner } from '@dha-team/arbundles'
import { Wallet } from 'ethers'
import { fetchNodeAddress, spawnLuaProcess, sendMessage } from './util/hb-client'
import fs from 'fs'
import path from 'path'

const HB_URL = process.env.HB_URL || 'http://localhost:8734'
const KEY = process.env.DEPLOYER_PRIVATE_KEY
  || '80611882d38e5502d93305c88b64da234fea23037334ecb9a647249076c5fa37'
const AO = path.resolve(import.meta.dir, '..')
const rd = (rel: string) => fs.readFileSync(path.join(AO, rel), 'utf-8')
const wrap = (src: string) => `(function()\n${src}\nend)()`

const BUNDLE = [
  `package.loaded['json'] = ${wrap(rd('runtime/vendor/json.lua'))}`,
  `package.loaded['.json'] = package.loaded['json']`,
  `package.loaded['.common.errors'] = ${wrap(rd('src/contracts/common/errors.lua'))}`,
  `package.loaded['.common.utils'] = ${wrap(rd('src/contracts/common/utils.lua'))}`,
  `native = ${wrap(rd('runtime/native.lua'))}`,
  `native.install()`,
  `native.register(${wrap(rd('src/contracts/native/operator-registry.lua'))})`,
].join('\n')

// Deploy wallet address (owner) — DERIVED from the actual signing key (bun auto-loads
// .env, so the key may not be the hardcoded fallback). FP1/FP4 are assigned to it so the
// dev wallet can actually claim FP1 (claimer address must == assigned address).
const DEV = new Wallet('0x' + KEY.replace(/^0x/, '')).address
const NORM_DEV = DEV   // addresses are stored verbatim EIP-55; DEV (Wallet.address) is already EIP-55
const BOB = '0x' + 'B'.repeat(40)
const CHARLS = '0x' + 'C'.repeat(40)
const FP1 = 'A'.repeat(40)   // dev — will be claimed (verified) + hardware
const FP2 = 'B'.repeat(40)   // BOB — claimable, has a registration credit
const FP3 = 'C'.repeat(40)   // CHARLS — claimable + hardware
const FP4 = 'D'.repeat(40)   // dev — claimable

;(async () => {
  const config = { url: HB_URL, signer: new EthereumSigner(KEY.replace(/^0x/, '')) }
  console.log(`node ${HB_URL} (${await fetchNodeAddress(HB_URL)})`)

  const { pid } = await spawnLuaProcess(config, {
    luaSource: BUNDLE,
    tags: [{ name: 'name', value: `native-opreg-deploy-${Date.now()}` }],
  })
  console.log(`spawned pid = ${pid}`)

  const step = async (label: string, tags: { name: string, value: string }[], data = '') => {
    const r = await sendMessage(config, { pid, tags, data })
    console.log(`  ${label} -> slot ${r.slot}`)
  }
  const action = (a: string, extra: Record<string, string> = {}) =>
    [{ name: 'action', value: a }, ...Object.entries(extra).map(([name, value]) => ({ name, value }))]

  console.log('populate:')
  await step('Admin-Submit-Operator-Certificates', action('Admin-Submit-Operator-Certificates'),
    JSON.stringify([
      { f: FP1, a: DEV, hw: true }, { f: FP2, a: BOB },
      { f: FP3, a: CHARLS, hw: true }, { f: FP4, a: DEV },
    ]))
  await step('Submit-Fingerprint-Certificate (claim FP1 as dev)',
    action('Submit-Fingerprint-Certificate', { 'fingerprint-certificate': FP1 }))
  await step('Block-Operator-Address (BOB)', action('Block-Operator-Address', { address: BOB }))
  await step('Add-Registration-Credit (BOB/FP2)',
    action('Add-Registration-Credit', { address: BOB, fingerprint: FP2 }))
  await step('Update-Roles (grant CHARLS admin)', action('Update-Roles'),
    JSON.stringify({ Grant: { [CHARLS]: ['admin'] } }))

  const J = '/serialize~json@1.0'
  const P = `${HB_URL}/${pid}~process@1.0`
  const V = `${P}/now/~lua@5.3a`   // views: pre-encoded JSON strings — NO serialize suffix.
  console.log(`\n=========================  POKE MENU  =========================`)
  console.log(`pid: ${pid}`)
  console.log(`owner (dev wallet): ${NORM_DEV}\n`)
  console.log(`# base-addressed scalar reads (raw value):`)
  console.log(`  ${P}/now/state/verified/${FP1}`)
  console.log(`  ${P}/now/state/claimable/${FP4}`)
  console.log(`  ${P}/now/state/blocked/${BOB}`)
  console.log(`  ${P}/now/state/verifiedHardware/${FP3}`)
  console.log(`\n# whole state / maps — raw HB map, NEEDS ${J} (else HTML explorer):`)
  console.log(`  ${P}/now/state${J}`)
  console.log(`\n# computed views — already json.encode'd, DO NOT append ${J} (it 500s):`)
  console.log(`  ${V}/status`)
  console.log(`  ${V}/operators`)
  console.log(`  ${V}/scoring`)
  console.log(`  ${V}/roles`)
  console.log(`  ${V}/version`)
  console.log(`  ${V}/dump                                    # whole state, clean stripped JSON (admin/seed-diff)`)
  console.log(`  ${V}/operator?address=${NORM_DEV}   # verified FP1 + claimable FP4`)
  console.log(`  ${V}/operator?address=${BOB}          # claimable FP2, blocked=true`)
  console.log(`  ${V}/fingerprints?ids=${FP1},${FP2},${FP3}   # param is 'ids' NOT 'fingerprints' (would shadow the view)`)
  console.log(`===============================================================`)
  process.exit(0)
})().catch(e => { console.error('FATAL', String(e?.message || e).slice(0, 400)); process.exit(1) })
