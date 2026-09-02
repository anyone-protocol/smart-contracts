// Build a seed envelope from a node's CURRENT state, for RESPAWNING a live contract.
//
// 🚨 WHY THIS EXISTS, AND WHY `deploy.ts --seed live` IS THE WRONG TOOL HERE.
// `build-seed.ts` reads `state-dumps/2026-07-09/` — the legacynet dump captured for the original
// migration. That is correct for a migration and CATASTROPHIC for a respawn: live
// operator-registry held 3,288 claimable on 2026-08-31 against the dump's 2,940, so respawning
// from it would silently discard ~348 entries and roll the registry back seven weeks.
//
// A respawn must carry the state the process actually holds now. This reads it from the node.
//
// ⚠️ It reads `as/`, NOT `now/`, deliberately. On a WEDGED process `now/` 500s while `as/` still
// serves the last successfully computed state — which is exactly the state we want to preserve.
// That is the whole reason a respawn is possible at all.
//
// `--verify` is the ACCEPTANCE TEST for a cutover: it boots the candidate image locally, spawns a
// process from the envelope, and diffs the resulting `as/dump` against the source node. A seed
// that spawns to different state than it was captured from is the one failure that would be
// invisible until after the PID had been switched.
//
// Usage:
//   bun run scripts/build-respawn-seed.ts <dev|stage|live> [--out <file>]
//   bun run scripts/build-respawn-seed.ts live --verify --image <ref>
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { EthereumSigner } from '@dha-team/arbundles'
import { spawnLuaProcess } from './util/hb-client'

const AO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ENVS: Record<string, string> = {
  dev: 'hb-dev.anyone.tech', stage: 'hb-stage.anyone.tech', live: 'hb.anyone.tech',
}
const env = (process.argv[2] || '').toLowerCase()
if (!ENVS[env]) { console.error('usage: bun run scripts/build-respawn-seed.ts <dev|stage|live> [--out <file>]'); process.exit(2) }
const oi = process.argv.indexOf('--out')
const OUT = oi > -1 ? process.argv[oi + 1] : path.join(AO, 'dist', 'operator-registry-seed.envelope.json')
const BASE = `https://${ENVS[env]}`

const get = async (p: string) => {
  const r = await fetch(`${BASE}${p}`, { signal: AbortSignal.timeout(180_000) })
  if (!r.ok) throw new Error(`GET ${p} -> ${r.status}`)
  return r.text()
}

/** Lua serializes an EMPTY table as `[]`. Every one of these is a MAP, so an array here means
 *  "empty", not "list" — leaving it as `[]` seeds the wrong type and the contract then writes
 *  integer keys into it. */
const asMap = (v: unknown) => (v && typeof v === 'object' && !Array.isArray(v)) ? v as Record<string, unknown> : {}

;(async () => {
  console.log(`=== respawn seed from ${BASE} (env=${env}) ===`)
  const routes = await get('/~meta@1.0/info/p4-non-chargable-routes/1/template')
  const pid = routes.match(/[A-Za-z0-9_-]{43}/)?.[0]
  if (!pid) throw new Error('could not read the operator-registry pid from the node routes')
  console.log(`  process ${pid}`)

  const dump = JSON.parse(await get(`/${pid}~process@1.0/as/dump`))
  const roles = JSON.parse(await get(`/${pid}~process@1.0/as/roles`))

  const state = {
    claimable: asMap(dump.claimable),
    verified: asMap(dump.verified),
    blocked: asMap(dump.blocked),
    verifiedHardware: asMap(dump.verifiedHardware),
    registrationCredits: asMap(dump.registrationCredits),
    registrationCreditsRequired: dump.registrationCreditsRequired === true,
  }
  const envelope = { 'ao-migration-seed': 1, state, acl: { roles } }
  const json = JSON.stringify(envelope)
  fs.mkdirSync(path.dirname(OUT), { recursive: true })
  fs.writeFileSync(OUT, json)

  const n = (o: object) => Object.keys(o).length
  console.log(`  claimable            ${n(state.claimable)}`)
  console.log(`  verified             ${n(state.verified)}`)
  console.log(`  blocked              ${n(state.blocked)}`)
  console.log(`  verifiedHardware     ${n(state.verifiedHardware)}`)
  console.log(`  registrationCredits  ${n(state.registrationCredits)}`)
  console.log(`  creditsRequired      ${state.registrationCreditsRequired}`)
  console.log(`  acl roles            ${Object.keys(roles).join(', ') || '(none)'}`)
  // A respawn with no roles cannot be written to by the controllers, and the failure would only
  // surface after the cutover.
  if (Object.keys(roles).length === 0) {
    console.error('\nREFUSING: no ACL roles. The controllers would be unable to write to the respawned process.')
    process.exit(1)
  }
  console.log(`\nwrote ${path.relative(AO, OUT)} (${(json.length / 1048576).toFixed(2)} MiB)`)

  if (!process.argv.includes('--verify')) {
    console.log('Spawn with:  bun run scripts/deploy.ts operator-registry --seed current')
    console.log('⚠️  Run again with --verify before a cutover: it proves this envelope spawns to')
    console.log('    byte-identical state on the image you are about to deploy.')
    return
  }

  // ---- verification: spawn it on the candidate image and diff against the source ----
  const ii = process.argv.indexOf('--image')
  const IMAGE = ii > -1 ? process.argv[ii + 1] : process.env.IMAGE
  if (!IMAGE) throw new Error('--verify needs --image <ref> (the image you intend to deploy)')
  const ENGINE = process.env.CONTAINER_ENGINE || 'podman'
  const NAME = 'hb-respawn-verify'
  const RELDIR = '/app/_build/default/rel/hb'
  const KEY = '0x' + '11'.repeat(32)
  const sh = (a: string[], ms = 120_000) =>
    execFileSync(ENGINE, a, { encoding: 'utf8', timeout: ms, stdio: ['ignore', 'pipe', 'pipe'] })
  const digest = (o: unknown) =>
    crypto.createHash('sha256').update(JSON.stringify(sortDeep(o))).digest('hex')

  console.log(`\n=== verifying against ${IMAGE.slice(0, 60)}… ===`)
  const cfg = path.join(AO, 'dist', 'respawn-verify-config.json')
  fs.writeFileSync(cfg, JSON.stringify({ 'faff-allow-list': ['0x19E7E376E7C213B7E7e7e46cc70A5dD086DAff2A'] }))
  sh(['rm', '-f', NAME], 60_000)
  // config.flat MUST stay in HB_CONFIG — it is the only thing setting priv_key_location, and
  // without it the node mints a new identity per boot.
  sh(['run', '-d', '--name', NAME, '--network', 'host',
    '-v', `${cfg}:${RELDIR}/config.json:ro,Z`,
    '-e', 'HB_CONFIG=config.flat,config.json', '-e', 'HB_ALLOW_EPHEMERAL_WALLET=true', IMAGE])
  const HB = 'http://localhost:8734'
  let up = false
  for (let i = 0; i < 60 && !up; i++) {
    try { up = (await fetch(`${HB}/~meta@1.0/info/address`)).ok } catch {}
    if (!up) await new Promise(r => setTimeout(r, 2000))
  }
  if (!up) { console.log(sh(['logs', '--tail', '30', NAME])); throw new Error('verify node did not come up') }

  const src = path.join(AO, 'dist', 'operator-registry-native.lua')
  if (!fs.existsSync(src)) execFileSync('bun', ['run', 'scripts/build-native-bundle.ts', 'operator-registry'], { cwd: AO, timeout: 300_000 })
  sh(['cp', src, `${NAME}:/tmp/o.lua`], 300_000)
  sh(['exec', NAME, './bin/hb', 'eval',
    `{ok,S}=file:read_file("/tmp/o.lua"), M=hb_message:commit(#{ <<"data-protocol">> => <<"ao">>, ` +
    `<<"variant">> => <<"ao.N.1">>, <<"type">> => <<"module">>, <<"content-type">> => <<"application/lua">>, ` +
    `<<"name">> => <<"opreg">>, <<"body">> => S }, #{ <<"priv-wallet">> => hb:wallet() }, <<"ans104@1.0">>), ` +
    `{ok,_}=hb_cache:write(M,#{}), ok=file:write_file("/tmp/o.id", hb_util:id(M)).`], 600_000)
  const moduleId = sh(['exec', NAME, 'cat', '/tmp/o.id'], 60_000).trim()

  const { pid: newPid } = await spawnLuaProcess(
    { url: HB, signer: new EthereumSigner(KEY.replace(/^0x/, '')) } as any,
    { moduleId, spawnData: json, tags: [{ name: 'name', value: `respawn-verify-${Date.now()}` }] })

  const localDump = await (await fetch(`${HB}/${newPid}~process@1.0/as/dump`)).json()
  const localRoles = await (await fetch(`${HB}/${newPid}~process@1.0/as/roles`)).json()
  sh(['rm', '-f', NAME], 60_000)

  const stateOk = digest(localDump) === digest(dump)
  const rolesOk = digest(localRoles) === digest(roles)
  console.log(`  state  ${stateOk ? 'IDENTICAL' : 'DIFFERS'}  (${digest(dump).slice(0, 16)} vs ${digest(localDump).slice(0, 16)})`)
  console.log(`  roles  ${rolesOk ? 'IDENTICAL' : 'DIFFERS'}`)
  if (!stateOk || !rolesOk) {
    console.error('\nREFUSING: the envelope does not spawn to the state it was captured from. Do NOT cut over.')
    process.exit(1)
  }
  console.log('\n✅ envelope verified — spawns byte-identical state on this image.')
})()

/** Order-independent comparison: JSON object key order is not meaningful here. */
function sortDeep (v: any): any {
  if (Array.isArray(v)) return v.map(sortDeep)
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.keys(v).sort().map(k => [k, sortDeep(v[k])]))
  }
  return v
}
