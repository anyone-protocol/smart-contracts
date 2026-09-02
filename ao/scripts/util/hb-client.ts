// Minimal HyperBEAM-native AO client — constructs, EVM-signs (ans104) and
// POSTs messages directly. Replaces aoconnect for our use (see
// docs/hyperbeam-migration/NEXT-send-aos-message-native-client.md: aoconnect
// 0.0.98 spawn is hardwired for genesis-wasm and stringifies map-valued
// fields, so it cannot produce a native lua@5.3a process).
//
// Wire protocol (verified against v0.9-FINAL source + live node):
// - Body is a raw signed ANS-104 DataItem; headers select the codec:
//   `Content-Type: application/ans104` (+ `codec-device: ans104@1.0`).
// - EVM signing: arbundles EthereumSigner (sig type 3). The node recovers the
//   committer as the EIP-55 checksummed 0x address (faff allow-list form).
// - Tag names MUST be unique + all-lowercase: dev_codec_ans104 skips its
//   `original-tags` preservation for "normal" tags, guaranteeing the stored
//   message re-encodes bit-exact for signature verification. Mixed-case or
//   path-flattened (`a/b`) tag names can fail re-verification on later reads.
// - The process id IS the DataItem id = base64url(sha256(signature)).
//   secp256k1 signing is deterministic, so identical spawn content from the
//   same wallet yields the SAME pid — pass a unique tag (e.g. `name`) to
//   spawn distinct processes.
// - `variant` must be `ao.N.1`: `ao.TN.1` flips dev_process's default
//   execution-device to genesis-wasm@1.0 (dev_process.erl:134-139).
// - Native lua module: encoded as a nested `module` map (content-type +
//   body/data) via HyperBEAM's ans104 map-bundle format — the same shape
//   dev_lua.erl generate_lua_process proves in-node. The lua source rides in
//   an unsigned bundled child item, so it is not subject to tag-size limits.
//   Alternatives that do NOT work on stock v0.9-FINAL:
//   * process-as-module (`content-type: application/lua` + source as data):
//     dev_lua:load_modules fetches the module body via hb_ao:get_first on the
//     full process message with device process@1.0 active -> re-enters
//     dev_lua:compute -> unbounded recursion, request hangs (dev_lua.erl:155
//     misses the {as, message@1.0} wrap that find_modules uses).
//   * flattened `module/...` tag names: decode into the nested map, but the
//     commitment's `committed` keys then reference flat keys that no longer
//     exist -> re-verification throws missing_committed_key on later reads.
//   Passing `module` = 43-char id of a module already readable by the node
//   also works (flat tag).
import { createData, deepHash, serializeTags, Signer } from '@dha-team/arbundles'
import { createHash } from 'crypto'

export interface HbConfig {
  /** Node base URL, e.g. https://hb-dev.anyone.tech */
  url: string
  /** arbundles Signer — EthereumSigner for our EVM deploy wallets */
  signer: Signer
}

export interface Tag { name: string, value: string }

export interface SpawnLuaOptions {
  /** Lua source; becomes the DataItem data + `content-type: application/lua`.
   *  Mutually exclusive with `moduleId`. */
  luaSource?: string
  /** Id of a lua module already cached/readable on the node. */
  moduleId?: string
  /** Address whose messages the process trusts; defaults to schedulerLocation. */
  authority?: string
  /** Scheduler node address; defaults to the node's own operator address.
   *  Must match a node identity or the node redirects to a remote scheduler. */
  schedulerLocation?: string
  /** Extra tags (unique, lowercase names). Include something unique (e.g.
   *  `name`) to avoid pid collisions between identical spawns. */
  tags?: Tag[]
  /**
   * Spawn-message data — the migration seed envelope (native-bundle.ts
   * buildSeedEnvelope). The runtime consumes it at slot 0 and never again, which
   * is what lets the published module stay pure source. Only meaningful with
   * `moduleId`; the `luaSource` path already uses `data` for the inline bundle.
   */
  spawnData?: string
  /**
   * Force the process's FIRST COMPUTE and confirm it resolves before returning (default
   * true, one extra GET).
   *
   * `/push` only SCHEDULES slot 0 — HyperBEAM computes lazily. A never-computed process
   * still answers 200 on most reads, it just has no state, so an unseeded or broken spawn
   * is indistinguishable from a healthy one until something much later reads the wrong
   * answer. `@permaweb/aoconnect` resolved `now` after a spawn for exactly this reason.
   *
   * Under the D32 globals model this is load-bearing: `as/<view>` does NOT drive slot 0, so
   * without it a just-spawned process serves views from the contract's declared EMPTY shape
   * — including a migrate-on-spawn seed, where a seed diff would compare against nothing.
   *
   * ⚠️ Proves the process COMPUTES, not that a seed LANDED — for that poll the native
   * runtime's `status.initialized`.
   */
  verify?: boolean
  verifyAttempts?: number
  verifyDelayMs?: number
}

export interface SendOptions {
  pid: string
  tags?: Tag[]
  data?: string | Uint8Array
}

const ANS104_HEADERS = {
  'Content-Type': 'application/ans104',
  'codec-device': 'ans104@1.0',
}

// --- HyperBEAM ans104 map-bundle encoding (ar_bundles.erl v0.9-FINAL) ---
// A nested-map key is carried as an UNSIGNED child DataItem inside a binary
// bundle in the outer item's data, plus an unsigned manifest item (JSON map
// of key -> child unsigned id, tags data-protocol=bundle-map, variant=0.0.1).
// The outer item gets bundle-format/bundle-version/bundle-map tags, which
// MUST come first: on re-verification the node re-encodes tags as
// bundle-tags ++ committed-tag-keys (dev_codec_ans104_to.erl:240-242), so any
// other position breaks the byte-exact signature round-trip.

const ZERO_512 = Buffer.alloc(512)

const longTo8ByteLE = (n: number) => {
  const b = Buffer.alloc(8)
  b.writeUInt32LE(n >>> 0, 0)
  return b
}

const longTo32ByteLE = (n: number) => {
  const b = Buffer.alloc(32)
  b.writeUInt32LE(n >>> 0, 0)
  return b
}

/** Serialize + id an UNSIGNED ans104 DataItem (rsa sig type, zeroed sig and
 *  owner — ar.hrl ?DEFAULT_SIG/?DEFAULT_OWNER). Unsigned id = sha256 of the
 *  ANS-104 deep-hash segment (dev_arweave_common.erl generate_id/2). */
async function unsignedItem (tags: Tag[], data: string | Buffer) {
  const dataBuf = Buffer.isBuffer(data) ? data : Buffer.from(data)
  const tagsBytes = Buffer.from(serializeTags(tags))
  const raw = Buffer.concat([
    Buffer.from([1, 0]),      // signature type 1 (rsa), little-endian
    ZERO_512,                 // signature (default: zeroed)
    ZERO_512,                 // owner (default: zeroed)
    Buffer.from([0]),         // no target
    Buffer.from([0]),         // no anchor
    longTo8ByteLE(tags.length),
    longTo8ByteLE(tagsBytes.length),
    tagsBytes,
    dataBuf,
  ])
  const segment = await deepHash([
    Buffer.from('dataitem'),
    Buffer.from('1'),
    Buffer.from('1'),         // signature type as string
    ZERO_512,                 // owner (forced to default for unsigned id)
    Buffer.alloc(0),          // target
    Buffer.alloc(0),          // anchor
    tagsBytes,
    dataBuf,
  ])
  const id = createHash('sha256').update(segment).digest()
  return { raw, id }
}

/** Encode nested-map keys as a HyperBEAM map-bundle: returns the outer data
 *  bytes and the three bundle tags (to be placed FIRST in the outer item). */
async function encodeMapBundle (children: Record<string, { tags: Tag[], data: string | Buffer }>) {
  const entries = await Promise.all(
    Object.entries(children).map(async ([key, child]) =>
      [key, await unsignedItem(child.tags, child.data)] as const
    )
  )
  const manifestJson = JSON.stringify(
    Object.fromEntries(entries.map(([key, item]) => [key, item.id.toString('base64url')]))
  )
  const manifest = await unsignedItem(
    [
      { name: 'data-protocol', value: 'bundle-map' },
      { name: 'variant', value: '0.0.1' },
    ],
    manifestJson
  )
  const items = [manifest, ...entries.map(([, item]) => item)]
  const data = Buffer.concat([
    longTo32ByteLE(items.length),
    ...items.map(item => Buffer.concat([longTo32ByteLE(item.raw.length), item.id])),
    ...items.map(item => item.raw),
  ])
  const bundleTags: Tag[] = [
    { name: 'bundle-format', value: 'binary' },
    { name: 'bundle-version', value: '2.0.0' },
    { name: 'bundle-map', value: manifest.id.toString('base64url') },
  ]
  return { data, bundleTags }
}

const assertLowercaseUnique = (tags: Tag[]) => {
  const seen = new Set<string>()
  for (const { name } of tags) {
    if (name !== name.toLowerCase()) {
      throw new Error(`tag name must be lowercase for ans104 round-trip: ${name}`)
    }
    if (seen.has(name)) throw new Error(`duplicate tag name: ${name}`)
    seen.add(name)
  }
}

async function postAns104 (
  config: HbConfig,
  path: string,
  opts: { tags: Tag[], data: string | Uint8Array, target?: string }
) {
  assertLowercaseUnique(opts.tags)
  const item = createData(opts.data, config.signer, {
    tags: opts.tags,
    ...(opts.target ? { target: opts.target } : {}),
  })
  await item.sign(config.signer)
  const res = await fetch(`${config.url}${path}`, {
    method: 'POST',
    headers: ANS104_HEADERS,
    body: item.getRaw(),
    redirect: 'follow',
  })
  const body = await res.text()
  if (!res.ok) {
    throw new Error(
      `POST ${path} -> ${res.status}: ${body.replace(/\s+/g, ' ').slice(0, 300)}`
    )
  }
  return { id: item.id, res, body }
}

/** The node's operator wallet address (43-char base64url). */
export async function fetchNodeAddress (url: string): Promise<string> {
  const res = await fetch(`${url}/~meta@1.0/info/address`)
  if (!res.ok) throw new Error(`GET /~meta@1.0/info/address -> ${res.status}`)
  return (await res.text()).trim()
}

/**
 * Spawn a native lua-device process. Returns the new pid (= the signed
 * DataItem id) and the assigned slot (0 for a fresh process).
 */
export async function spawnLuaProcess (
  config: HbConfig,
  opts: SpawnLuaOptions
): Promise<{ pid: string, slot: string | null }> {
  if (!opts.luaSource === !opts.moduleId) {
    throw new Error('exactly one of luaSource or moduleId is required')
  }
  // An inline-source spawn encodes the module INTO the data field, so it cannot also carry a
  // seed envelope there — the seed would be silently dropped and the process would come up
  // empty while every call reported success. Seeding requires a module-id spawn.
  if (opts.luaSource && opts.spawnData) {
    throw new Error(
      'spawnData cannot be combined with luaSource: the inline module occupies the data field, ' +
      'so the seed would be discarded. Publish the module and spawn by moduleId instead.'
    )
  }
  const schedulerLocation =
    opts.schedulerLocation ?? await fetchNodeAddress(config.url)
  const processTags: Tag[] = [
    { name: 'device', value: 'process@1.0' },
    { name: 'type', value: 'Process' },
    { name: 'scheduler-device', value: 'scheduler@1.0' },
    { name: 'execution-device', value: 'lua@5.3a' },
    { name: 'push-device', value: 'push@1.0' },
    { name: 'scheduler-location', value: schedulerLocation },
    { name: 'authority', value: opts.authority ?? schedulerLocation },
    { name: 'data-protocol', value: 'ao' },
    { name: 'variant', value: 'ao.N.1' },
    ...(opts.moduleId ? [{ name: 'module', value: opts.moduleId }] : []),
    ...(opts.tags ?? []),
  ]
  let tags = processTags
  let data: string | Buffer = opts.spawnData ?? ''
  if (opts.luaSource) {
    const bundle = await encodeMapBundle({
      module: {
        tags: [{ name: 'content-type', value: 'application/lua' }],
        data: opts.luaSource,
      },
    })
    tags = [...bundle.bundleTags, ...processTags]
    data = bundle.data
  }
  const { id, res } = await postAns104(config, '/push', { tags, data })
  const pid = res.headers.get('process') ?? id
  if (opts.verify !== false) {
    await forceFirstCompute(config, pid, opts.verifyAttempts, opts.verifyDelayMs)
  }
  return { pid, slot: res.headers.get('slot') }
}

/**
 * Drive a lazily-scheduled slot 0 by resolving `now/at-slot`, and confirm the node answers.
 * Contract-agnostic on purpose: `at-slot` exists on every process, so this cannot depend on
 * a `status` view that only the native runtime has.
 */
export async function forceFirstCompute (
  config: Pick<HbConfig, 'url'>,
  pid: string,
  attempts = 30,
  delayMs = 500
): Promise<string> {
  let last = ''
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(`${config.url}/${pid}~process@1.0/now/at-slot`)
      if (res.ok) return (await res.text()).trim()
      last = `HTTP ${res.status}`
    } catch (e) { last = String((e as Error)?.message ?? e) }
    if (i < attempts - 1) await new Promise(r => setTimeout(r, delayMs))
  }
  throw new Error(`spawned ${pid} but it never computed after ${attempts} attempts (${last})`)
}

/**
 * Send an interaction to a process; returns the assigned slot and the raw
 * push response body (JSON when the compute result is JSON-encodable).
 */
export async function sendMessage (
  config: HbConfig,
  opts: SendOptions
): Promise<{ id: string, slot: string | null, body: string }> {
  const tags: Tag[] = [
    { name: 'type', value: 'Message' },
    { name: 'data-protocol', value: 'ao' },
    { name: 'variant', value: 'ao.N.1' },
    { name: 'require-codec', value: 'application/json' },
    ...(opts.tags ?? []),
  ]
  const { id, res, body } = await postAns104(
    config,
    `/${opts.pid}~process@1.0/push`,
    { tags, data: opts.data ?? '', target: opts.pid }
  )
  let slot = res.headers.get('slot')
  if (slot === null) {
    try { slot = String(JSON.parse(body).slot) } catch { /* keep null */ }
  }
  return { id, slot, body }
}

/**
 * Content-addressed id of the lua module child exactly as an inline (`luaSource`) spawn
 * embeds it — base64url(sha256(ans104 deep-hash segment)).
 *
 * ⚠️ This id is NOT usable as `moduleId` for a later by-id spawn. An earlier version of this
 * comment claimed an inline spawn leaves the child in the node's cache so a subsequent spawn
 * could reference it — that is FALSE, and it is an expensive thing to believe, because the
 * by-id spawn is ACCEPTED (returns a pid) and only fails later at compute time with
 * `{case_clause,{error,not_found}}` / HTTP 500 on the first `now/` read. Verified refuted
 * 2026-07-26 against v0.9-FINAL, at both ~200B and 806KB module sizes, including after
 * forcing a compute on the inline process first.
 *
 * A spawnable module must be a SIGNED ans104 module message written to the node's cache via
 * `hb_message:commit` + `hb_cache:write` — i.e. the `bin/hb eval` path in
 * scripts/publish-native-module.ts, which runs inside the node container. Its id differs from
 * this one (signed message vs unsigned bundle child). scripts/run-e2e.ts automates that for a
 * container we control and otherwise takes MODULE_ID_* explicitly.
 *
 * Kept because the unsigned child id is still the right thing for inspecting/deduping what an
 * inline spawn embedded — just not for spawning.
 */
export async function moduleIdFor (luaSource: string): Promise<string> {
  const item = await unsignedItem([{ name: 'content-type', value: 'application/lua' }], luaSource)
  return item.id.toString('base64url')
}

/**
 * Read live process state: GET /{pid}~process@1.0/now/<key>. Computes up to
 * the current slot; leaf values return as plain text.
 */
export async function readState (
  config: Pick<HbConfig, 'url'>,
  pid: string,
  key: string
): Promise<string> {
  const res = await fetch(`${config.url}/${pid}~process@1.0/now/${key}`)
  const body = await res.text()
  if (!res.ok) {
    throw new Error(
      `GET now/${key} -> ${res.status}: ${body.replace(/\s+/g, ' ').slice(0, 200)}`
    )
  }
  return body
}
