// Does the allowlist seed at SPAWN, or only once a message is scheduled?
//
// ANSWER (measured 2026-08-03, v0.9-FINAL-patched @031aa1c7): it seeds at SLOT 0 — the spawn
// message itself — in the same native.compute pass as the state seed. Sending a message after
// spawn leaves `allowlistId` BYTE-IDENTICAL, so the "nudge" this probe was written to justify
// contributes nothing and is not a deploy step.
//
// What IS required is that slot 0 has been COMPUTED once. On a never-computed process every
// `compute/…` read 508s with "Request creates infinite recursion" — allowlistId, the trie
// lookup, and the Owner's committer read alike. A single `now` read materialises it (~6 s, that
// being the state seed); every gate read is 30–40 ms thereafter. That makes the deploy action a
// FREE READ, not a signed message. No deadlock with the gate on: `now` is in
// p4-non-chargable-routes, so the compute that arms the gate never reaches the gate.
//
// ⚠️ The process id is derived from the signed spawn item, so identical module + seed + signer
// reproduces the SAME pid and silently reuses an already-computed process. That contaminated the
// first two runs of this probe (spawn returned slot "2"). Hence the nonce tag below — without it
// this probe reports a false positive.
//
// Env: HB_URL, CONTAINER, NONCE
import fs from 'fs'
import path from 'path'
import { execFileSync } from 'node:child_process'
import { EthereumSigner } from '@dha-team/arbundles'
import { computeAddress, hexlify } from 'ethers'
import { fetchNodeAddress, spawnLuaProcess, sendMessage } from '../util/hb-client'
import { seedEnvelopeFor } from '../util/native-bundle'
import { requireDeployerKey } from '../util/helpers'

const HB_URL = process.env.HB_URL || 'http://localhost:8734'
const CONTAINER = process.env.CONTAINER || 'hb-seedtest'
const AO = '/var/home/jim/dev/anyone-protocol/smart-contracts/ao'
const signer = new EthereumSigner(requireDeployerKey())
const deployerAddr = computeAddress(hexlify(signer.publicKey))
const cfg = { url: HB_URL, signer }
const sleep = (n: number) => new Promise(r => setTimeout(r, n))

function publish (rel: string, label: string): string {
  const abs = path.join(AO, rel)
  if (!fs.existsSync(abs)) throw new Error(`missing ${rel}`)
  execFileSync('podman', ['cp', abs, `${CONTAINER}:/tmp/${label}.lua`], { timeout: 300_000 })
  const erl = `{ok,S}=file:read_file("/tmp/${label}.lua"), M=hb_message:commit(#{ <<"data-protocol">> => <<"ao">>, <<"variant">> => <<"ao.N.1">>, <<"type">> => <<"module">>, <<"content-type">> => <<"application/lua">>, <<"name">> => <<"${label}">>, <<"body">> => S }, #{ <<"priv-wallet">> => hb:wallet() }, <<"ans104@1.0">>), {ok,_}=hb_cache:write(M,#{}), ok=file:write_file("/tmp/${label}.id", hb_util:id(M)).`
  execFileSync('podman', ['exec', CONTAINER, './bin/hb', 'eval', erl], { encoding: 'utf8', timeout: 600_000 })
  const id = execFileSync('podman', ['exec', CONTAINER, 'cat', `/tmp/${label}.id`], { encoding: 'utf8', timeout: 60_000 }).trim()
  if (!/^[A-Za-z0-9_-]{43}$/.test(id)) throw new Error(`bad module id: ${id.slice(0, 60)}`)
  return id
}

const get = async (p: string) => {
  try {
    const r = await fetch(`${HB_URL}/${p}`, { signal: AbortSignal.timeout(180_000) })
    const t = (await r.text()).trim()
    return { status: r.status, body: t.length > 90 ? t.slice(0, 90) + '…' : t }
  } catch (e: any) { return { status: -1, body: String(e).slice(0, 80) } }
}

const show = async (label: string, p: string) => {
  const t0 = Date.now()
  const r = await get(p)
  console.log(`  ${String(r.status).padStart(4)}  ${((Date.now() - t0) + 'ms').padStart(7)}  ${label.padEnd(34)} ${r.body}`)
  return r
}

;(async () => {
  console.log('\n=== does the allowlist seed at SPAWN, before any message? ===')
  const schedulerLocation = await fetchNodeAddress(HB_URL)
  const modId = publish('dist/operator-registry-native.lua', 'seedtest-opreg')
  console.log(`  module   ${modId}`)

  const { pid, slot } = await spawnLuaProcess(cfg, {
    moduleId: modId, schedulerLocation, spawnData: seedEnvelopeFor('operator-registry'),
    // A nonce: the process id is derived from the signed spawn item, so identical module +
    // identical seed data + identical signer yields the SAME pid and silently reuses the
    // already-computed process — which invalidates the whole test.
    tags: [{ name: 'name', value: 'seed-on-spawn' },
           { name: 'nonce', value: String(process.env.NONCE || Date.now()) }] })
  console.log(`  process  ${pid}`)
  console.log(`  spawn returned slot header: ${JSON.stringify(slot)}`)

  console.log('\n--- IMMEDIATELY AFTER SPAWN, no message sent ---')
  // ORDER MATTERS: read the allowlist FIRST, before anything forces a compute, so we learn
  // whether the gate's own read is sufficient to materialise slot 0.
  await show('committer (FIRST read)',
    `${pid}~process@1.0/compute/process/commitments/${pid}/committer`)
  await show('compute/allowlistId (FIRST read)', `${pid}~process@1.0/compute/allowlistId`)
  await show('compute/allowlistId/~trie/<owner> (FIRST)',
    `${pid}~process@1.0/compute/allowlistId/~trie@1.0/${deployerAddr}`)
  await show('now/status (state)', `${pid}~process@1.0/now/~lua@5.3a/status`)
  await show('now/allowlistId',     `${pid}~process@1.0/now/allowlistId`)
  const ownerRead = await show('compute/process/commitments/<pid>/committer',
    `${pid}~process@1.0/compute/process/commitments/${pid}/committer`)

  console.log('\n--- gate read for the deployer (the Owner) ---')
  await show('compute/allowlistId/~trie/<owner>',
    `${pid}~process@1.0/compute/allowlistId/~trie@1.0/${deployerAddr}`)

  console.log('\n--- now send ONE message (the "nudge") ---')
  const t0 = Date.now()
  await sendMessage(cfg, { pid, tags: [{ name: 'action', value: 'Seed-Nudge' }] })
  console.log(`  first slot took ${Date.now() - t0} ms`)
  await sleep(1500)
  await show('scheduler slot',      `${pid}~process@1.0/slot`)
  await show('compute/allowlistId', `${pid}~process@1.0/compute/allowlistId`)
  await show('compute/allowlistId/~trie/<owner>',
    `${pid}~process@1.0/compute/allowlistId/~trie@1.0/${deployerAddr}`)

  console.log(`\n  owner-read status after spawn was ${ownerRead.status} — the gate's isOwner path`)
})()
