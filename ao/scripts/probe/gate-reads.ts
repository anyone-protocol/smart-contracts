// What does the write gate actually pay to answer "may this address write?", against a
// REAL-SIZED operator-registry (7,932 verified / 2,940 claimable — the live numbers).
//
// This is mechanism-independent: whether the gate ends up as a Lua pricing device, an Erlang
// device, or a controller syncing a static list, something has to answer these reads, and the
// cost decides the shape. Specifically it decides whether Phase 2 (a new address-keyed index in
// the contract, held as a trie) is needed at all:
//
//   * `operators` is ALREADY an address-keyed set — `{[addr] = true}`, verified minus blocked.
//     But it is a computed VIEW: it iterates all ~8k `verified` entries and materialises a ~3k
//     entry map on EVERY call. If a point read into it is ~150 ms, the gate can use it as-is and
//     the contract never changes. If it is seconds, it cannot, and the index has to be stored.
//     That assumption ("a computed view is unusable on a hot path") has been carried since the
//     design was written and never measured.
//   * ACL roles and the owner are the other half of the allow-set (our controller/admin
//     wallets). Those are point lookups into `acl.roles[role][addr]` — expected cheap, but the
//     read PATH for `acl` on the read surface is not something we have exercised.
//
// Everything is read with `compute/<path>`, never `now` — standing rule, and `now` was measured
// at 14,122 ms vs 123 ms under an 8-message backlog.
//
// Env: HB_URL, CONTAINER (to publish the registry module into)
import fs from 'fs'
import path from 'path'
import { execFileSync } from 'node:child_process'
import { EthereumSigner } from '@dha-team/arbundles'
import { fetchNodeAddress, spawnLuaProcess } from '../util/hb-client'
import { seedEnvelopeFor } from '../util/native-bundle'
import { requireDeployerKey } from '../util/helpers'

const HB_URL = process.env.HB_URL || 'http://localhost:8734'
const CONTAINER = process.env.CONTAINER || 'hb-gate'
const AO = path.resolve(import.meta.dir, '../..')
const cfg = { url: HB_URL, signer: new EthereumSigner(requireDeployerKey()) }
const sleep = (n: number) => new Promise(r => setTimeout(r, n))

function publish (rel: string, label: string): string {
  const abs = path.join(AO, rel)
  if (!fs.existsSync(abs)) throw new Error(`missing ${rel} — run scripts/run-e2e.ts to build dist/`)
  execFileSync('podman', ['cp', abs, `${CONTAINER}:/tmp/${label}.lua`], { timeout: 300_000 })
  const erl = `{ok,S}=file:read_file("/tmp/${label}.lua"), M=hb_message:commit(#{ <<"data-protocol">> => <<"ao">>, <<"variant">> => <<"ao.N.1">>, <<"type">> => <<"module">>, <<"content-type">> => <<"application/lua">>, <<"name">> => <<"${label}">>, <<"body">> => S }, #{ <<"priv-wallet">> => hb:wallet() }, <<"ans104@1.0">>), {ok,_}=hb_cache:write(M,#{}), ok=file:write_file("/tmp/${label}.id", hb_util:id(M)).`
  execFileSync('podman', ['exec', CONTAINER, './bin/hb', 'eval', erl], { encoding: 'utf8', timeout: 600_000 })
  const id = execFileSync('podman', ['exec', CONTAINER, 'cat', `/tmp/${label}.id`], { encoding: 'utf8', timeout: 60_000 }).trim()
  if (!/^[A-Za-z0-9_-]{43}$/.test(id)) throw new Error(`bad module id: ${id.slice(0, 60)}`)
  return id
}

/** Median of n timed GETs, plus the status and a short body sample. */
const timed = async (pid: string, sub: string, n = 5) => {
  const url = `${HB_URL}/${pid}~process@1.0/${sub}`
  const ms: number[] = []
  let status = 0, sample = ''
  for (let i = 0; i < n; i++) {
    const t0 = Date.now()
    const r = await fetch(url, { signal: AbortSignal.timeout(120_000) }).catch(() => null)
    ms.push(Date.now() - t0)
    if (r) { status = r.status; sample = (await r.text()).replace(/\s+/g, ' ').slice(0, 48) }
  }
  return { med: [...ms].sort((a, b) => a - b)[Math.floor(n / 2)], status, sample }
}

;(async () => {
  console.log(`\n=== what the gate pays, against a real-sized registry ===`)
  const schedulerLocation = await fetchNodeAddress(HB_URL)
  const modId = publish('dist/operator-registry-native.lua', 'gate-opreg')
  const { pid } = await spawnLuaProcess(cfg, {
    moduleId: modId, schedulerLocation, spawnData: seedEnvelopeFor('operator-registry'),
    tags: [{ name: 'name', value: 'gate-registry' }] })
  console.log(`  registry ${pid}`)

  let counts: any = null
  for (let i = 0; i < 60; i++) {
    const r = await fetch(`${HB_URL}/${pid}~process@1.0/now/~lua@5.3a/status`)
    if (r.ok) { counts = JSON.parse(await r.text()).counts; break }
    await sleep(2000)
  }
  if (!counts) { console.log('  registry never seeded'); process.exit(2) }
  console.log(`  seeded   ${JSON.stringify(counts)}`)

  // A real operator address and a real verified fingerprint, taken from live state so the
  // "hit" cases are genuine hits. A synthetic address would only ever exercise the miss path.
  const scoring = await (await fetch(`${HB_URL}/${pid}~process@1.0/now/~lua@5.3a/scoring`)).text()
  const fp = (scoring.match(/"([A-F0-9]{40})"/) || [])[1]
  const addr = (scoring.match(/"(0x[0-9a-fA-F]{40})"/) || [])[1]
  if (!fp || !addr) { console.log('  could not sample a fingerprint/address from state'); process.exit(2) }
  console.log(`  operator ${addr}`)
  console.log(`  fp       ${fp}\n`)

  // Take the role name and a real role-holder from live state rather than guessing. Roles are
  // keyed by ACTION NAME (`Add-Verified-Hardware`, …), not by `admin`/`owner` — guessing `admin`
  // produces a 404 that reads like "the path form is wrong" when the path form was fine.
  const rolesRaw = await (await fetch(`${HB_URL}/${pid}~process@1.0/compute/~lua@5.3a/roles`)).text()
  const roles = JSON.parse(rolesRaw)
  const roleName = Object.keys(roles).find(k => Object.keys(roles[k] ?? {}).some(a => a.startsWith('0x')))
  const roleAddr = roleName ? Object.keys(roles[roleName]).find(a => a.startsWith('0x')) : undefined
  console.log(`  role     ${roleName} -> ${roleAddr}`)

  // Confirm the sampled operator is genuinely IN the set before timing a "hit" against it —
  // otherwise a 404 is ambiguous between "point reads into a view don't work" and "wrong key".
  const opsRaw = await (await fetch(`${HB_URL}/${pid}~process@1.0/compute/~lua@5.3a/operators`)).text()
  const ops = JSON.parse(opsRaw)
  const opAddr = Object.keys(ops).find(a => a.startsWith('0x'))!
  console.log(`  in-set   ${opAddr}  (${Object.keys(ops).length} operators)`)
  console.log(`  sampled addr in set? ${ops[addr] === true}\n`)

  const MISS = '0x' + '0'.repeat(40)
  const cases: Array<[string, string]> = [
    // The question the gate actually asks. `operators` is already an address-keyed set, so if a
    // point read into it resolves, no contract change is needed at all.
    ['operators/<addr>  POINT', `compute/~lua@5.3a/operators/${opAddr}`],
    ['operators/<miss>  POINT', `compute/~lua@5.3a/operators/${MISS}`],
    ['operators  WHOLE VIEW', `compute/~lua@5.3a/operators`],
    // The other half of the allow-set: our controller/admin wallets, by role.
    ['roles  WHOLE VIEW', `compute/~lua@5.3a/roles`],
    ...(roleName && roleAddr
      ? [['roles/<role>/<addr>  POINT', `compute/~lua@5.3a/roles/${roleName}/${roleAddr}`]] as Array<[string, string]>
      : []),
    // Baselines. `blocked` is the one address-keyed map in base state, so it also tells us
    // whether EIP-55 mixed case survives a path segment — a silent lowercase would make every
    // address lookup miss.
    ['state/blocked/<addr>  POINT', `compute/state/blocked/${opAddr}`],
    ['state/verified/<fp>  POINT', `compute/state/verified/${fp}`],
  ]

  console.log(`  ${'read'.padEnd(28)} ${'median'.padStart(8)}  status  sample`)
  for (const [label, sub] of cases) {
    const r = await timed(pid, sub)
    console.log(`  ${label.padEnd(28)} ${String(r.med).padStart(6)} ms  ${String(r.status).padStart(5)}   ${r.sample}`)
  }

  console.log(`\n  medians of 5, warm. If the operators POINT read is ~150 ms the gate can use the`)
  console.log(`  view as it stands and Phase 2 (address-keyed index + trie) is unnecessary.`)
})()
