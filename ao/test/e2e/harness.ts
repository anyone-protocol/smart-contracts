// End-to-end test harness for AO processes running on a live HyperBEAM node.
//
// Unlike the unit specs (test/spec/**), which execute the bundled Lua inside an
// in-memory AOS WASM via @permaweb/ao-loader, these e2e tests spawn a REAL
// process on a HyperBEAM node (local docker on :8734 by default) and drive it
// through @permaweb/aoconnect in mainnet mode. They run natively on bun.
//
// Requires a reachable HyperBEAM node (set HB_URL) and DEPLOYER_PRIVATE_KEY.

import 'dotenv/config'
import { connect } from '@permaweb/aoconnect'
import { EthereumSigner } from '@dha-team/arbundles'
import { computeAddress } from '@ethersproject/transactions'
import { hexlify } from '@ethersproject/bytes'
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import {
  createEthSigner,
  resolveAuthority,
  resolveImportAuthority
} from '../../scripts/util/helpers'

export const HB_URL = process.env.HB_URL || 'http://localhost:8734'
export const MODULE =
  process.env.MODULE || 'ISShJH1ij-hPPt9St5UFFr_8Ys3Kj5cyg7zrMGt7H9s'

// ---- tiny assertion + logging harness (no mocha; runs natively on bun) ----

const c = {
  reset: '\x1b[0m', green: '\x1b[32m', red: '\x1b[31m',
  yellow: '\x1b[33m', cyan: '\x1b[36m', dim: '\x1b[2m'
}
export const step = (m: string) => console.log(`${c.cyan}▶${c.reset} ${m}`)
export const info = (l: string, v: unknown) =>
  console.log(`  ${c.dim}${l}:${c.reset} ${fmt(v)}`)
export const warn = (m: string) => console.log(`${c.yellow}!${c.reset} ${m}`)

export function check(cond: unknown, m: string): asserts cond {
  if (!cond) throw new Error(`Assertion failed: ${m}`)
  console.log(`${c.green}✓${c.reset} ${m}`)
}

export function checkEqual(actual: unknown, expected: unknown, m: string) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a !== e) {
    throw new Error(
      `Assertion failed: ${m}\n    expected: ${e}\n    actual:   ${a}`
    )
  }
  console.log(`${c.green}✓${c.reset} ${m} (= ${a})`)
}

function fmt(v: unknown) {
  return typeof v === 'string' ? v : JSON.stringify(v)
}

export const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

/** Wrap an e2e scenario so it logs clearly and sets a non-zero exit on failure. */
export async function run(name: string, main: () => Promise<void>) {
  console.log(`\n${c.cyan}=== ${name} ===${c.reset}`)
  const t0 = Date.now()
  try {
    await main()
    const dt = ((Date.now() - t0) / 1000).toFixed(1)
    console.log(`\n${c.green}PASS${c.reset} ${name} ${c.dim}(${dt}s)${c.reset}\n`)
    process.exit(0)
  } catch (err) {
    const e = err as Error
    console.error(`\n${c.red}FAIL${c.reset} ${name}\n${c.red}${e.stack ?? e.message}${c.reset}\n`)
    process.exit(1)
  }
}

// ---- AO actor + process helpers ----

export interface Actor { ao: any; signer: any }
export interface MessageResult {
  Output?: any
  Messages?: any[]
  Error?: string
  [k: string]: any
}

/**
 * Create an identity: an EVM signer plus its OWN connected aoconnect client.
 *
 * NB: aoconnect's mainnet mode does NOT honor a per-message `signer` override —
 * messages are signed by the client's connect-level signer. So every distinct
 * identity needs its own client; do not try to share one `ao` across signers.
 */
export async function newActor(privateKey: string): Promise<Actor> {
  const signer = await createEthSigner(new EthereumSigner(privateKey))
  const ao = connect({ MODE: 'mainnet', signer, URL: HB_URL } as any)
  return { ao, signer }
}

/** Checksummed 0x EVM address for a private key — matches `msg.From` on hyperbeam. */
export function evmAddress(privateKey: string): string {
  return computeAddress(hexlify(new EthereumSigner(privateKey).publicKey))
}

/** The contract's normalized address form: `0x` + uppercased hex (how it stores them). */
export function normalizeEvmAddress(address: string): string {
  return '0x' + address.replace(/^0x/, '').toUpperCase()
}

export interface AOProcess {
  pid: string
  send(
    actor: Actor,
    action: string,
    data?: string,
    extraTags?: { name: string; value: string }[]
  ): Promise<MessageResult>
  eval(actor: Actor, code: string): Promise<MessageResult>
}

/** Spawn a bare process from MODULE, signed by `owner`. */
export async function spawnProcess(owner: Actor, name: string): Promise<AOProcess> {
  const nodeAddress = await resolveAuthority(HB_URL)
  const scheduler = process.env.SCHEDULER || nodeAddress
  const authority = await resolveImportAuthority(HB_URL)

  step(`Spawning [${name}] on ${HB_URL}`)
  info('module', MODULE)
  info('scheduler', scheduler)
  info('authority', authority)
  const pid = await owner.ao.spawn({
    module: MODULE,
    scheduler,
    authority,
    signer: owner.signer,
    tags: [
      { name: 'App-Name', value: 'Anyone-Protocol' },
      { name: 'Name', value: `${name}-e2e_${Date.now()}` },
      { name: 'Authority', value: authority }
    ],
    data: `${name} e2e`
  })
  info('processId', pid)
  step('Waiting for spawn to settle')
  await sleep(5000)

  const send = async (
    actor: Actor,
    action: string,
    data?: string,
    extraTags: { name: string; value: string }[] = []
  ): Promise<MessageResult> => {
    const slot = await actor.ao.message({
      process: pid,
      tags: [{ name: 'Action', value: action }, ...extraTags],
      ...(data !== undefined ? { data } : {}),
      signer: actor.signer
    })
    return readResult(actor, pid, slot)
  }

  return { pid, send, eval: (actor, code) => send(actor, 'Eval', code) }
}

/**
 * Read a computed message result, polling until it has settled. The genesis-wasm
 * push on a HyperBEAM node is asynchronous, so `result` can return before the
 * outbox is populated; we re-fetch until the result carries an Error, outbox
 * Messages, or an Output (the Eval-of-source case returns an empty Output).
 */
async function readResult(
  actor: Actor,
  pid: string,
  slot: any,
  attempts = Number(process.env.E2E_RESULT_RETRIES ?? 6)
): Promise<MessageResult> {
  let last: MessageResult = {}
  for (let i = 1; i <= attempts; i++) {
    last = await actor.ao.result({ process: pid, slot })
    const ready =
      last?.Error != null ||
      (Array.isArray(last?.Messages) && last.Messages.length > 0) ||
      (last?.Output != null && 'data' in last.Output)
    if (ready) return last
    await sleep(700 * i)
  }
  return last
}

// ---- reading process state from the node cache over HTTP (no messages) ----
//
// Prefer this over sending a View-style message to read state: it queries the
// already-computed state tree the node serves, so it is synchronous and avoids
// the async settle flakiness of round-tripping a fresh message + result.

// HyperBEAM decorates every state map with these metadata keys; strip them
// (and the `+link` content-address suffix) to recover the real entries.
const STATE_META = new Set(['commitments', 'device', 'ao-types'])

/**
 * GET a MAP/message value from a process's cached `now` state tree as JSON.
 * Returns null on 404. NB: `serialize~json@1.0` only applies to messages/maps —
 * for a scalar leaf (a string/number) use `readLeaf`, which 200s where this 500s.
 */
export async function readState(pid: string, path = ''): Promise<any> {
  const tail = path ? `${path}/` : ''
  const res = await fetch(`${HB_URL}/${pid}~process@1.0/now/${tail}serialize~json@1.0`)
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`readState(${path}) failed: ${res.status}`)
  return res.json()
}

/**
 * GET a scalar leaf value from cached state as raw text (no serialize device).
 * Returns null on 404. Use for map entries whose value is a string/number, e.g.
 * `readLeaf(pid, 'claimable_fingerprints_to_operator_addresses/<fingerprint>')`.
 */
export async function readLeaf(pid: string, path: string): Promise<string | null> {
  const res = await fetch(`${HB_URL}/${pid}~process@1.0/now/${path}`)
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`readLeaf(${path}) failed: ${res.status}`)
  return (await res.text()).trim()
}

/** The real entry keys of a hyperbeam state map, minus metadata decorations. */
export function stateKeys(obj: any): string[] {
  if (!obj || typeof obj !== 'object') return []
  return Object.keys(obj)
    .filter(k => !STATE_META.has(k))
    .map(k => k.replace(/\+link$/, ''))
    .filter(k => k.length > 0)
    .sort()
}

/**
 * A hyperbeam state map as a plain object (metadata keys stripped). Use for maps
 * whose values are leaf scalars (e.g. fingerprint -> address) — reading a leaf
 * path directly 500s, so read the parent map and index it.
 */
export function stateEntries(obj: any): Record<string, any> {
  if (!obj || typeof obj !== 'object') return {}
  const out: Record<string, any> = {}
  for (const [k, v] of Object.entries(obj)) {
    if (STATE_META.has(k)) continue
    out[k.replace(/\+link$/, '')] = v
  }
  return out
}

/**
 * Poll the cached state keys at `path` until they equal `expected` (order-
 * independent), to absorb any lag between a mutation settling and `now`
 * reflecting it. Returns the final keys seen (sorted) for assertion.
 */
export async function pollStateKeys(
  pid: string,
  path: string,
  expected: string[],
  attempts = 8
): Promise<string[]> {
  const want = JSON.stringify([...expected].sort())
  let keys: string[] = []
  for (let i = 1; i <= attempts; i++) {
    keys = stateKeys(await readState(pid, path))
    if (JSON.stringify(keys) === want) return keys
    await sleep(500 * i)
  }
  return keys
}

/** Spawn a process and Eval its bundled `dist/<contractName>.lua` source. */
export async function deployContract(
  owner: Actor,
  contractName: string
): Promise<AOProcess> {
  const proc = await spawnProcess(owner, contractName)
  const sourcePath = join(resolve(), `./dist/${contractName}.lua`)
  if (!existsSync(sourcePath)) {
    throw new Error(
      `Bundled source not found: ${sourcePath} — run \`bun run process:build\` first`
    )
  }
  step(`Eval bundled source ./dist/${contractName}.lua`)
  const r = await proc.eval(owner, readFileSync(sourcePath, 'utf8'))
  if (r?.Error) throw new Error(`Eval of ${contractName} source failed: ${r.Error}`)
  return proc
}
