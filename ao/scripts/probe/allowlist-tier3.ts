// Tier-3 — the allowlist's TRIE-BACKED STORE, on a real node.
//
// Tier-1 and Tier-2 both drive the in-memory fallback store, because `ao.resolve` does not
// exist in either harness. So everything proven so far is the refcount ARITHMETIC. The parts
// only a node can exercise are all here:
//
//   · does `ao.resolve({'as','trie@1.0', id}, {path='set', ...})` actually persist from inside
//     contract compute, and does the returned id thread forward across slots
//   · does the MIGRATION SEED survive — ~830 distinct operator addresses written in ONE slot
//   · does the gate's read path (`compute/allowlistId/~trie@1.0/<addr>`) return what the
//     contract wrote, including the 'B<count>' block encoding
//   · does a refcount survive a slot boundary, i.e. is the id being re-read correctly rather
//     than a fresh trie being minted each time (which would look fine per-slot and lose history)
//
// Env: HB_URL, CONTAINER
import fs from 'fs'
import path from 'path'
import { execFileSync } from 'node:child_process'
import { EthereumSigner } from '@dha-team/arbundles'
import { computeAddress, hexlify } from 'ethers'
import { fetchNodeAddress, spawnLuaProcess, sendMessage } from '../util/hb-client'
import { seedEnvelopeFor } from '../util/native-bundle'
import { requireDeployerKey } from '../util/helpers'

const HB_URL = process.env.HB_URL || 'http://localhost:8734'
const CONTAINER = process.env.CONTAINER || 'hb-al3'
const AO = path.resolve(import.meta.dir, '../..')
const signer = new EthereumSigner(requireDeployerKey())
const deployerAddr = computeAddress(hexlify(signer.publicKey))
const cfg = { url: HB_URL, signer }
const sleep = (n: number) => new Promise(r => setTimeout(r, n))

let fails = 0, checks = 0
const check = (ok: boolean, label: string, detail = '') => {
  checks++; if (!ok) fails++
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? '  — ' + detail : ''}`)
}

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

/** Exactly the read the p4 gate performs. Returns the raw value, or null when absent. */
const gateRead = async (pid: string, addr: string) => {
  const t0 = Date.now()
  const r = await fetch(`${HB_URL}/${pid}~process@1.0/compute/allowlistId/~trie@1.0/${addr}`,
    { signal: AbortSignal.timeout(120_000) })
  const ms = Date.now() - t0
  if (!r.ok) return { v: null as string | null, ms, status: r.status }
  const t = (await r.text()).trim()
  return { v: t === '' ? null : t, ms, status: r.status }
}

;(async () => {
  console.log(`\n=== Tier-3 — allowlist trie store on a real node ===`)
  const schedulerLocation = await fetchNodeAddress(HB_URL)
  const modId = publish('dist/operator-registry-native.lua', 'al3-opreg')
  const { pid } = await spawnLuaProcess(cfg, {
    moduleId: modId, schedulerLocation, spawnData: seedEnvelopeFor('operator-registry'),
    tags: [{ name: 'name', value: 'allowlist-tier3' }] })
  console.log(`  registry ${pid}`)
  console.log(`  deployer ${deployerAddr}  (spawn committer = Owner)`)

  let counts: any = null
  for (let i = 0; i < 90; i++) {
    const r = await fetch(`${HB_URL}/${pid}~process@1.0/as/status`)
    if (r.ok) { counts = JSON.parse(await r.text()).counts; break }
    await sleep(2000)
  }
  if (!counts) { console.log('  registry never seeded'); process.exit(2) }
  console.log(`  seeded   ${JSON.stringify(counts)}`)

  // The seed only runs on the first COMPUTE, so nudge one message through and time it — this
  // is the ~830-address single-slot write.
  const t0 = Date.now()
  await sendMessage(cfg, { pid, tags: [{ name: 'action', value: 'Seed-Nudge' }] })
  console.log(`  first slot (carries the allowlist seed): ${Date.now() - t0} ms`)

  const idRes = await fetch(`${HB_URL}/${pid}~process@1.0/compute/allowlistId`)
  const trieId = (await idRes.text()).trim()
  check(/^[A-Za-z0-9_-]{43}$/.test(trieId),
    'the contract persisted a trie id (the store actually wrote through ao.resolve)',
    trieId.slice(0, 50))

  // A genuine operator from the live seed.
  const scoring = await (await fetch(`${HB_URL}/${pid}~process@1.0/as/scoring`)).text()
  const op = (scoring.match(/"(0x[0-9a-fA-F]{40})"/) || [])[1]
  const fp = (scoring.match(/"([A-F0-9]{40})"/) || [])[1]
  console.log(`  operator ${op}\n`)

  const hit = await gateRead(pid, op)
  check(hit.v !== null, 'a seeded operator IS on the allowlist', `value ${hit.v} in ${hit.ms} ms`)
  check(/^\d+$/.test(hit.v ?? ''), 'the stored count is an integer string, not a float',
    String(hit.v))

  const ownerHit = await gateRead(pid, deployerAddr)
  check(ownerHit.v !== null, 'the process Owner is on the allowlist', `value ${ownerHit.v}`)

  const miss = await gateRead(pid, '0x' + '9'.repeat(40))
  check(miss.v === null, 'an unknown address is NOT on the allowlist',
    `value ${miss.v} / HTTP ${miss.status}`)

  console.log(`\n  gate read: hit ${hit.ms} ms, miss ${miss.ms} ms  (no timing asymmetry to enumerate with)`)

  // --- mutations must persist ACROSS SLOTS ------------------------------------------------
  // The id has to be re-read from state each slot. If a fresh trie were minted per slot every
  // single-slot assertion above would still pass while all history was silently lost.
  console.log(`\n  --- mutations across slots ---`)
  const BLOCKED = op!
  await sendMessage(cfg, { pid, tags: [
    { name: 'action', value: 'Block-Operator-Address' }, { name: 'address', value: BLOCKED } ] })
  await sleep(1500)
  const blocked = await gateRead(pid, BLOCKED)
  check(/^B\d+$/.test(blocked.v ?? ''),
    'blocking writes the B<count> veto, preserving the reason count',
    String(blocked.v))
  check(blocked.v === 'B' + hit.v,
    'the preserved count matches what was there before the block',
    `${hit.v} -> ${blocked.v}`)

  await sendMessage(cfg, { pid, tags: [
    { name: 'action', value: 'Unblock-Operator-Address' }, { name: 'address', value: BLOCKED } ] })
  await sleep(1500)
  const unblocked = await gateRead(pid, BLOCKED)
  check(unblocked.v === hit.v,
    'unblocking restores the EXACT prior count across slots (id threaded, not re-minted)',
    `${blocked.v} -> ${unblocked.v}`)

  // A brand-new operator, admin-assigned: the bootstrap path.
  //
  // ⚠️ The contract canonicalizes through `eip55.checksum`, so it stores the MIXED-CASE form.
  // The allowlist is therefore keyed by the checksummed address, and the gate must look up the
  // same spelling — which it does in production, because the node hands it an already-EIP-55
  // committer (D6). Asserted both ways here: an all-lowercase spelling of the same address must
  // NOT resolve, or a future change that lowercased keys would go unnoticed until an operator
  // was locked out.
  const RAW = '0x' + 'a'.repeat(40)
  const NEWFP = 'FADE' + '0'.repeat(36)
  await sendMessage(cfg, { pid,
    tags: [{ name: 'action', value: 'Admin-Submit-Operator-Certificates' }],
    data: JSON.stringify([{ f: NEWFP, a: RAW }]) })
  await sleep(1500)

  const stored = (await (await fetch(
    `${HB_URL}/${pid}~process@1.0/compute/state/claimable/${NEWFP}`)).text()).trim()
  check(/^0x[0-9a-fA-F]{40}$/.test(stored) && stored !== RAW,
    'the contract canonicalized the address to EIP-55 before storing it', stored)

  const fresh = await gateRead(pid, stored)
  check(fresh.v !== null,
    'an admin-assigned CLAIMABLE fingerprint immediately allows the new operator to write',
    `value ${fresh.v}`)

  const rawMiss = await gateRead(pid, RAW)
  check(rawMiss.v === null,
    'the same address in non-EIP-55 spelling does NOT resolve (keys are stored verbatim)',
    `value ${rawMiss.v}`)

  console.log(`\n${fails === 0 ? 'PASS' : 'FAILED'} — ${checks - fails}/${checks} checks`)
  process.exit(fails === 0 ? 0 : 1)
})()
