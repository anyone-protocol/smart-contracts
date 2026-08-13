// Proves, on a REAL node with the REAL relay-rewards bundle, that the settle-slot round is
// served application/json — the payoff for pointing last_snapshot at `results/output` (the
// parent) instead of `results/output/data` (the leaf).
//
// This is the Tier-3 6c block, standalone. The full tier3-relay-validate needs a PUBLISHED
// MODULE_ID because seeding requires a module-id spawn; the content-type claim does not depend
// on the seed, so an inline luaSource spawn proves it without spending a publish cycle.
//
// Run: HB_URL=https://hb-dev.anyone.tech bun run scripts/probe/settle-slot-content-type.ts
import { EthereumSigner } from '@dha-team/arbundles'
import { spawnLuaProcess, sendMessage } from '../util/hb-client'
import fs from 'fs'
import path from 'path'

const HB = process.env.HB_URL || 'https://hb-dev.anyone.tech'
const KEY = process.env.DEPLOYER_PRIVATE_KEY
if (!KEY) throw new Error('DEPLOYER_PRIVATE_KEY required (ao/.env)')

const AO = path.resolve(import.meta.dir, '..', '..')
const BUNDLE = fs.readFileSync(path.join(AO, 'dist/relay-rewards-native.lua'), 'utf8')

const FP = '01DFBD67E3B3F1F04D674B0F78D5F67F6FE49D70'
const ADDR = '0x5f57d2664E9AC6c724623ABA4BAcf3cD43a4c31B'
const T = 1000

let fails = 0
const check = (ok: boolean, label: string, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? '  — ' + detail : ''}`)
  if (!ok) fails++
}

;(async () => {
  const config = { url: HB, signer: new EthereumSigner(KEY.replace(/^0x/, '')) }
  console.log(`node: ${HB}`)

  const { pid } = await spawnLuaProcess(config, {
    luaSource: BUNDLE,
    tags: [{ name: 'name', value: `settle-ct-${Date.now()}` }],
  })
  console.log(`pid = ${pid}\n`)

  await sendMessage(config, {
    pid,
    tags: [{ name: 'action', value: 'Add-Scores' }, { name: 'round-timestamp', value: String(T) }],
    data: JSON.stringify({
      Scores: { [FP]: { Address: ADDR, Network: 1000, IsHardware: false, UptimeStreak: 0, ExitBonus: false, FamilySize: 0, LocationSize: 0 } },
    }),
  })
  await sendMessage(config, {
    pid,
    tags: [{ name: 'action', value: 'Complete-Round' }, { name: 'round-timestamp', value: String(T) }],
  })

  console.log('last_snapshot + the 302:')
  const ptr = JSON.parse(await (await fetch(`${HB}/${pid}~process@1.0/as/last_snapshot`)).text())
  check(ptr.Slot > 0, 'a round settled', `slot ${ptr.Slot}`)
  check(ptr.Path === `compute&slot=${ptr.Slot}/results/output`,
    'Path points at the PARENT, not the /data leaf', ptr.Path)

  const redirUrl = `${HB}/${pid}~process@1.0/as/last_snapshot?redirect=true`
  const noFollow = await fetch(redirUrl, { redirect: 'manual' })
  check(noFollow.status === 302, 'redirect=true answers 302', String(noFollow.status))
  check(noFollow.headers.get('location') === `../compute&slot=${ptr.Slot}/results/output`,
    'relative Location targets the parent', String(noFollow.headers.get('location')))

  const followed = await fetch(redirUrl)
  const fText = await followed.text()
  const fCt = followed.headers.get('content-type') || ''
  check(followed.ok, 'following the redirect lands on the round', String(followed.status))
  check(fCt.includes('application/json'), 'THE CLAIM: served application/json', fCt)
  check(JSON.parse(fText).Timestamp === T, 'target is THIS round', String(JSON.parse(fText).Timestamp))
  check(!!JSON.parse(fText).Details?.[FP], 'target carries Details', 'ok')

  console.log('\nthe /data leaf is unchanged (what the controller reads):')
  const leaf = await fetch(`${HB}/${pid}~process@1.0/compute&slot=${ptr.Slot}/results/output/data`)
  const leafText = await leaf.text()
  const lCt = leaf.headers.get('content-type') || ''
  check(lCt.includes('text/plain'), 'leaf still text/plain', lCt)
  check(leafText === fText, 'parent and leaf are byte-identical', `${leafText.length} B both`)

  console.log(`\n${fails === 0 ? 'ALL PASS' : fails + ' FAILURE(S)'}  —  pid=${pid}`)
  process.exit(fails === 0 ? 0 : 1)
})()
