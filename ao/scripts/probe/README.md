# Probes

Each probe answers one question about how a HyperBEAM node or the native runtime behaves. The
findings are the reason these scripts are kept: they state behavior that no offline test shows.

Paths in this document are relative to `ao/`. Run every command from `ao/`:

```sh
bun run scripts/probe/<name>.ts [arguments]
```

The other scripts are indexed in [../README.md](../README.md).

## Contents

- [Running a probe](#running-a-probe)
- [Index](#index)
- [Facts that hold for every probe](#facts-that-hold-for-every-probe)
- [Read path](#read-path)
- [Spawn and seed](#spawn-and-seed)
- [Allow-list and trie](#allow-list-and-trie)
- [Write gate](#write-gate)
- [Cross-process reads](#cross-process-reads)
- [Bundling](#bundling)
- [Image and upgrade](#image-and-upgrade)

## Running a probe

Most probes need a local node:

```sh
podman run -d --name hb-local --network host \
  -e HB_ALLOW_EPHEMERAL_WALLET=true \
  -e HB_WALLET_PATH=/app/wallet.json \
  ghcr.io/memetic-block/hyperbeam-docker:v0.9-FINAL
```

| Variable | Meaning | Default |
| --- | --- | --- |
| `HB_URL` | Base URL of the node | `http://localhost:8734`, except where a section says otherwise |
| `DEPLOYER_PRIVATE_KEY` | EVM key that signs. Required by most probes | None |
| `CONTAINER` | Name of the local container that the probe publishes a module into, or restarts | Per probe |
| `IMAGE` | Image of the container that the probe starts itself | Per probe |
| `KEEP` | Leave the container of the probe running after the run | Off |

Rules:

- A probe that reads `CONTAINER` runs `podman cp` and `podman exec` on that container. Point
  `HB_URL` at the same container.
- A probe that reads `IMAGE` starts its own container with host networking on port 8734. Stop
  any other local node first, and run one such probe at a time.
- Probes that publish a module need `dist/`. Build it with `scripts/run-e2e.ts`, or with
  `scripts/build-native-bundle.ts` and the seed builders.
- Run a probe against a local container. Every write to a deployed node takes a slot, and an
  assignment that fails to publish cannot be published later.
- Absolute latency depends on the host and on the state size. Compare ratios and shapes, not
  milliseconds.

## Index

| Probe | Question |
| --- | --- |
| [`as-view-params.ts`](#as-view-paramsts) | What reaches a view through `as/<view>`, and what comes back |
| [`read-path-calibration.ts`](#read-path-calibrationts) | What does a read cost for each way of holding state |
| [`output-content-type.ts`](#output-content-typets) | Can a handler declare the content type of its output |
| [`settle-slot-content-type.ts`](#settle-slot-content-typets) | Is the settled round of relay rewards served as JSON |
| [`claim-tag-casing.ts`](#claim-tag-casingts) | Does a contract read tags that were sent with lowercase names |
| [`run-timestamp-probe.ts`](#run-timestamp-probets) | Which time fields does the device hand to a contract, and in which units |
| [`seed-on-spawn.ts`](#seed-on-spawnts) | Does the allow-list seed at spawn, or only with the first message |
| [`allowlist-tier3.ts`](#allowlist-tier3ts) | Does the trie-backed allow-list store work on a node |
| [`trie-scale.ts`](#trie-scalets) | Does a trie lookup stay cheap at the size of the operator set |
| [`gate-reads.ts`](#gate-readsts) | What does a point read into a computed view cost |
| [`p4-lua-pricing.ts`](#p4-lua-pricingts) | Can a Lua script serve as the pricing device of `p4@1.0` |
| [`p4-gate-e2e.ts`](#p4-gate-e2ets) | Does the write gate decide correctly from contract state |
| [`gate-subject-replay.ts`](#gate-subject-replayts) | Does the gate refuse a bundler upload envelope that is replayed at a push path |
| [`stranger-write.ts`](#stranger-writets) | Can a wallet that is on no list write to a process |
| [`xproc-syntax.ts`](#xproc-syntaxts) | Which forms of `ao.resolve` read the state of another process |
| [`xproc-gate.ts`](#xproc-gatets) | Does a cross-process read wait behind the backlog of its target |
| [`bundler-landing.ts`](#bundler-landingts) | Does the data of a bundle that the node made itself land on Arweave |
| [`gated-bundler-repro.ts`](#gated-bundler-reprots) | Does the upload of the node reach its own bundler behind a Lua pricing device |
| [`gc-cost-curve.ts`](#gc-cost-curvets) | Does the cost of a message grow with the number of slots |
| [`gc-restore-fidelity.ts`](#gc-restore-fidelityts) | Is state identical after a restart of the node |
| [`opreg-wedge-repro.ts`](#opreg-wedge-reprots) | Can an image continue a process whose trie another image wrote |

| Lua file | Used by | Content |
| --- | --- | --- |
| `p4-pricing.lua` | `p4-lua-pricing.ts` | A minimal pricing device. The probe inserts the allowed address at run time |
| `timestamp-probe.lua` | `run-timestamp-probe.ts` | A `compute` that reports every time field of the request |

## Facts that hold for every probe

| Fact | Consequence |
| --- | --- |
| `now/<path>` computes to the latest slot before it answers | It waits behind every queued message. It is the read that shows whether a process still computes |
| `compute/<path>` serves the latest computed state | It does not wait behind queued messages |
| `as/<view>` serves a view from the last computed state | It keeps answering 200 after a process has stopped computing |
| `as/<view>` does not compute slot 0 | A process that has never computed answers views from the declared empty state. Read `now/` once after a spawn |
| A process that has never computed answers 508 `Request creates infinite recursion` on every `compute/` path | One `now/` read ends that state |
| The process id is the id of the signed spawn item, and EVM signing is deterministic | The same module, seed and signer give the same process id and an existing process. Add a unique tag to every spawn |
| With `accept: application/json` the node wraps a scalar in a commitment envelope | Read a scalar without that header |
| Without an `accept` header some routes answer with the Hyperbuddy page and HTTP 200 | Send `accept: application/json` where a JSON answer is expected, and assert that the answer is JSON |
| `<pid>~process@1.0/slot` answers with the Hyperbuddy page | The slot number is at `slot/current` |
| HTTP 400 has many sources: the allow-list, the gate, a malformed message | Identify a refusal by its message, not by its status |
| A handler that throws is reverted, and the push still answers 200 | Read the output of the slot to see the error |
| A snapshot of a process is taken at most once per `process_snapshot_time`, 60 seconds by default | To test a restore, idle longer than that and send one more message |
| `dev_p4` reports every failure of its pricing device as `Could not estimate price of request.` | Start the node with `HB_PRINT=lua_error,lua` to see the Lua error |
| `HB_PRINT` output goes to the standard error of the container | Read both streams of the container log |
| `config.flat` in the image sets `priv_key_location`, spelled with underscores. `HB_CONFIG=config.json` alone drops it | The node creates a new identity at every start. Pass `HB_CONFIG=config.flat,config.json` when a probe restarts a node |

## Read path

### as-view-params.ts

Question: what reaches a view through `as/<view>`, and what comes back.

```sh
HB_URL=http://localhost:8734 bun run scripts/probe/as-view-params.ts
```

`DEPLOYER_PRIVATE_KEY` is optional. The probe spawns from inline source and prints status,
time and body of nine reads.

Findings:

- A query parameter reaches the view. `as/one?address=X` arrives as `req.address`.
- `as/one&address=X` also works. After a device suffix it does not:
  `as/one/serialize~json@1.0&address=X` loses the parameter, and the view answers a miss with
  HTTP 200. Use `?`.
- A view without its parameter runs and sees no parameter. It is not an error.
- Path segments select from a raw return only. `as/raw/verified/AAA` returns the leaf.
- A wrapped view returns a `body` string, so a path segment after it answers 404. Add a
  parameter to the view.
- The wrapper `{ body = <json string>, ['content-type'] = 'application/json' }` comes back as
  inlined JSON without envelope keys.
- A view that returns a nested Lua table has every child content-addressed, as
  `"<key>+link": "<id>"`. Each child costs one more request. `serialize~json@1.0` does not
  inline the children. The runtime encodes a view result before it returns it for this reason.
- A view cannot `require` a module that the device provides. The VM of a read holds only what
  the module source preloaded. `require` of a module that was not preloaded answers HTTP 500.
- The bundles from `scripts/util/native-bundle.ts` preload json and the common libraries. An
  inline source in a probe must preload what its views require.
- When state is in a Lua global, a view function is the only way to read it. A data global
  answers 500.

See [../../docs/runtime.md](../../docs/runtime.md#views).

### read-path-calibration.ts

Question: what does a read cost when state is on the process message, in a Lua global, or in a
trie.

```sh
HB_URL=http://localhost:8734 bun run scripts/probe/read-path-calibration.ts
```

| Variable | Default | Meaning |
| --- | --- | --- |
| `VERIFIED` | `7932` | Entries in the verified map |
| `CLAIMABLE` | `2940` | Entries in the claimable map |
| `SLOTS` | `20` | Messages sent before the reads |
| `REPS` | `7` | Reads per measurement. The median is reported |
| `FORCE_SNAPSHOT` | Off | `1` idles past the snapshot interval and sends one more message before the reads |

| Read | Path |
| --- | --- |
| Point lookup through a view | `as/one` |
| Whole state through a view | `as/dump` |
| Point read into state on the message | `now/state/verified/<fingerprint>` |

Findings:

- The cost of a read follows what the view returns. A view that returns one row is cheaper
  than a read that addresses into the whole state.
- A path segment after a view name selects from the result after the whole view was built.
- State in a Lua global is reachable through views only. A path such as `now/state/<key>`
  resolves only while state is on the process message.
- Without an `accept` header the node renders the answer through Hyperbuddy, and the time
  measured is the time to build HTML.
- A 404 answers fast. The probe records what came back for every read, so that a fast 404 is
  not counted as a fast read.

### output-content-type.ts

Question: can a handler declare the content type of its output, as a view can.

```sh
HB_URL=<url> bun run scripts/probe/output-content-type.ts
```

`HB_URL` defaults to `https://hb-dev.anyone.tech`. `DEPLOYER_PRIVATE_KEY` is required. The probe
sends one message per output shape and reads each slot at `results/output` and at the leaf.

| Case | Output of the handler |
| --- | --- |
| `bare` | `{ data = <json string> }` |
| `data-ct` | `{ data = <json string>, ['content-type'] = 'application/json' }` |
| `body-ct` | `{ body = <json string>, ['content-type'] = 'application/json' }` |
| `body-bare` | `{ body = <json string> }` |
| `table` | `{ data = <Lua table> }` |
| `table-top` | The Lua table is the output message |

Findings:

- A content type on the output message is served at `compute&slot=<n>/results/output`.
- It is not served at `results/output/data`. That path selects a leaf binary. Direct from the
  node the leaf has no content type. Through the nginx edge it is served as
  `text/plain; charset=utf-8`, which is the default of the edge.
- `?accept=application/json` encodes the answer as an envelope with `ao-result`, `body`,
  `commitments` and `status`. The payload is an escaped string inside `body`.
- Tags arrive as keys of `message.body`. The top level of the message holds the assignment:
  `slot`, `timestamp`, `process`, `path` and the commitments.
- The node also runs `compute` to estimate the price of a message. In that call `message.body`
  is not always a table. A module that indexes it without a type check makes `POST /push`
  answer 400.
- A `compute` that returns without setting `process.results` makes `POST /push` answer 400.

See [../../docs/runtime.md](../../docs/runtime.md#handler-output).

### settle-slot-content-type.ts

Question: is the settled round of relay rewards served as `application/json`.

```sh
HB_URL=<url> bun run scripts/probe/settle-slot-content-type.ts
```

`HB_URL` defaults to `https://hb-dev.anyone.tech`. `DEPLOYER_PRIVATE_KEY` is required. Needs
`dist/relay-rewards-native.lua`. The probe spawns from inline source, because the content type
does not depend on a seed.

Findings:

- `as/last_snapshot` returns a pointer whose `Path` is `compute&slot=<n>/results/output`.
- `as/last_snapshot?redirect=true` answers 302. The `Location` is relative, because a view does
  not see the process id.
- Following the redirect returns the round with `content-type: application/json`.
- `results/output` and `results/output/data` return the same bytes. Only the first carries the
  declared content type.
- `as/last_round_details?address=<address>` returns every relay of that address in one request
  and no relay of another address.
- Each entry of that answer equals the answer of `as/last_round_details?fingerprint=<fp>`.
- A lowercase address is canonicalized. An unknown address answers `{}`.

### claim-tag-casing.ts

Question: does a contract read tags that were sent with lowercase names.

```sh
HB_URL=http://localhost:8734 bun run scripts/probe/claim-tag-casing.ts
```

`DEPLOYER_PRIVATE_KEY` is required. Needs `dist/operator-registry-native.lua`.

Findings:

- A wallet without a role claims a fingerprint with the tags `action` and
  `fingerprint-certificate` in lowercase. The fingerprint moves from claimable to verified.
- The runtime folds every tag name to title case before a handler reads it.
- Senders use lowercase tag names. A signed item with other tag names can fail signature
  verification on a later read.

### run-timestamp-probe.ts

Question: which time fields does the `lua@5.3a` device hand to a contract, and in which units.

```sh
HB_URL=http://localhost:8734 MODULE_ID=<id> bun run scripts/probe/run-timestamp-probe.ts
```

`MODULE_ID` is the id of `timestamp-probe.lua`, published on the node first.
`DEPLOYER_PRIVATE_KEY` is optional. The probe prints every field next to the clock of the host
and classifies each number by its digit count.

Findings:

- `timestamp` on the assignment is the clock of the scheduler in milliseconds.
- `block-timestamp` is the time of the Arweave block in seconds. It is 0 on a node that runs in
  debug mode.
- hyper-aos maps `os.time` to `block-timestamp`. A contract that expects milliseconds from it
  is wrong by a factor of 1000.
- The native runtime uses `timestamp`. See
  [../../docs/runtime.md](../../docs/runtime.md#timestamps).

## Spawn and seed

### seed-on-spawn.ts

Question: does the allow-list seed at spawn, or only when the first message is scheduled.

```sh
HB_URL=http://localhost:8734 CONTAINER=<name> bun run scripts/probe/seed-on-spawn.ts
```

| Variable | Default | Meaning |
| --- | --- | --- |
| `CONTAINER` | `hb-seedtest` | Container that receives the module |
| `NONCE` | The current time | Value of the `nonce` tag of the spawn |

`DEPLOYER_PRIVATE_KEY` is required. Needs the operator registry bundle and seed in `dist/`.

Findings:

- The allow-list seeds at slot 0, which is the spawn message, in the same compute as the state
  seed.
- A message after the spawn leaves `allowlistId` unchanged. No message is needed to build the
  allow-list.
- Slot 0 must have been computed once. One `now/` read does that.
- Before that read, every `compute/` path answers 508: `allowlistId`, the trie lookup and the
  read of the owner.
- The first compute is a free read and not a signed message. `now` is a free route for a
  process id on the route list of the node, so the read does not pass the gate.
- The first compute of a seeded process takes seconds, because it loads the state seed. Later
  gate reads are fast.

## Allow-list and trie

### allowlist-tier3.ts

Question: does the trie-backed store of the allow-list work on a node. The offline tiers use a
plain table, because `ao.resolve` exists on a node only.

```sh
HB_URL=http://localhost:8734 CONTAINER=<name> bun run scripts/probe/allowlist-tier3.ts
```

`CONTAINER` defaults to `hb-al3`. `DEPLOYER_PRIVATE_KEY` is required. Needs the operator
registry bundle and seed in `dist/`.

Findings:

- `ao.resolve({ 'as', 'trie@1.0', id }, { path = 'set', ... })` persists from inside the
  compute of a contract. The id that it returns carries over to the next slot.
- The seed of the allow-list, several hundred addresses, is written in one slot.
- The read of the gate, `compute/allowlistId/~trie@1.0/<address>`, returns what the contract
  wrote, including the `B<count>` encoding of a block.
- A stored count is an integer string.
- A reference count survives a slot boundary. The contract reads the trie id from state in
  every slot and does not create a new trie.
- The owner of the process is on the allow-list.
- A lookup of an unknown address answers 404. A hit and a miss take the same time.
- The allow-list is keyed by the EIP-55 form of an address. The all-lowercase spelling of the
  same address does not resolve. The node delivers committers in EIP-55 form, so the gate looks
  up the stored spelling.

See [../../docs/runtime.md](../../docs/runtime.md#allow-list).

### trie-scale.ts

Question: does a point lookup into a `~trie@1.0` stay cheap at the size of the operator set.

```sh
HB_URL=http://localhost:8734 N=8000 bun run scripts/probe/trie-scale.ts
N=1000,8000,20000 bun run scripts/probe/trie-scale.ts
```

| Variable | Default | Meaning |
| --- | --- | --- |
| `N` | `1000,8000,20000` | Key counts, one run per count |
| `BATCH` | `500` | Keys per insert batch while seeding |

`DEPLOYER_PRIVATE_KEY` is required. Keys have the shape of an address: `0x` and 40 hex
characters.

| Column | Measures |
| --- | --- |
| `seed` | Time to build the whole trie |
| `hit`, `miss` | A point lookup through the process |
| `by-id` | A point lookup when the trie id is known |
| `update` | A change of one key |
| `composed` | A change of one key with the path `set/id` |

Findings:

- The cost of a point lookup does not grow with the number of keys. A lookup follows the
  length of the key.
- A hit and a miss cost the same.
- A lookup by trie id is cheaper than a lookup through the process.
- A `set` commits and writes the whole trie. The cost of changing one key grows with the size
  of the trie.
- Write every change of a slot in one `set`. One `set` per key multiplies the cost.
- On a stock image the path `set/id` does not return the id of the new trie. It returns a
  table.
- `scripts/qualify-node.ts` gates on the ratio of the lookup time at the largest key count to
  the time at the smallest. The ceiling is 2.0.

### gate-reads.ts

Question: what does it cost to answer "may this address write" from a computed view of an
operator registry of realistic size.

```sh
HB_URL=http://localhost:8734 CONTAINER=<name> bun run scripts/probe/gate-reads.ts
```

`CONTAINER` defaults to `hb-gate`. `DEPLOYER_PRIVATE_KEY` is required. Needs the operator
registry bundle and seed in `dist/`.

Findings:

- A computed view builds its whole result on every call. A point read into the view pays for
  the whole view.
- The gate therefore reads a stored index: the allow-list trie. A trie read does not load the
  process.
- Roles are keyed by action name, for example `Add-Verified-Hardware`. A read of a role named
  `admin` answers 404 when no such role exists.
- The mixed case of an EIP-55 address survives a path segment.

The probe reads `compute/~lua@5.3a/<view>` and `compute/state/<key>`. Those paths resolve only
for a module that keeps its state on the process message. The native contracts are read through
`as/<view>`.

## Write gate

See [../../docs/write-gate.md](../../docs/write-gate.md) for the gate itself.

### p4-lua-pricing.ts

Question: can a Lua script serve as the pricing device of `p4@1.0`.

```sh
bun run scripts/probe/p4-lua-pricing.ts
IMAGE=<ref> KEEP=1 bun run scripts/probe/p4-lua-pricing.ts
```

| Variable | Default | Meaning |
| --- | --- | --- |
| `IMAGE` | `ghcr.io/memetic-block/hyperbeam-docker:v0.9-FINAL-patched` | Image under test |
| `KEEP` | Off | `1` leaves the container `hb-p4spike` running |
| `HB_PRINT` | Unset | Passed to the node |

The probe needs no key. It generates an allowed key and a refused key per run and starts its own
node with `pricing-device: lua@5.3a` and `ledger-device: faff@1.0`.

Findings:

- A Lua script works as a pricing device.
- `dev_p4` calls the function `estimate` with the hook message as `base` and
  `{ path = 'estimate', request = <the signed request>, body = <messages> }` as `req`.
- `'infinity'` refuses the request with HTTP 400. The ledger is not consulted.
- The integer `0` admits the request for free. The ledger is not consulted.
- Any other value is a price. `dev_p4` then asks the ledger for a balance.
- A float `0.0` is a price, not an admission. With `faff@1.0` as the ledger the request then
  answers 500, because that device exports no balance function. Return `math.tointeger(0)`.
- A refusal happens at the request hook, before the scheduler assigns a slot. A refused write
  takes no slot.
- `faff@1.0` admits a request without signers. A Lua gate must refuse it explicitly.
- The pricing device and the ledger device are declared on one hook message, and `dev_lua`
  reads its script from the `module` key of that message. A Lua pricing device and a Lua ledger
  device cannot use different scripts.
- `p4@1.0` belongs on both hooks: `on/request` estimates and `on/response` charges.
- A node that ignores its configuration file has no pricing device and admits everything.
  Assert that the configuration took effect before trusting an admission.
- A write to a process must carry the message envelope and the target. A bare item is rejected
  as malformed with HTTP 400, the status that a refusal also has.
- The first request through the device pays for the start of the Lua VM. Measure cost on a
  warm device.
- Derive an EVM address with keccak over the uncompressed public key. The last 20 bytes of the
  public key are not the address.

### p4-gate-e2e.ts

Question: does the write gate decide correctly when it reads contract state, and what does a
decision cost.

```sh
bun run scripts/probe/p4-gate-e2e.ts
VERIFY=1 bun run scripts/probe/p4-gate-e2e.ts
```

| Variable | Default | Meaning |
| --- | --- | --- |
| `IMAGE` | `hyperbeam-luaenc:local` | Image under test. The default is an image built locally |
| `VERIFY` | Off | `1` also runs `scripts/verify-access-policy.ts local` against the node of the probe |
| `KEEP` | Off | `1` leaves the container `hb-gate-e2e` running |
| `HB_PRINT` | Unset | Passed to the node |

`DEPLOYER_PRIVATE_KEY` is required. Needs the three native bundles and seeds in `dist/`.

The node starts without `p4`. The probe spawns and seeds the contracts, rewrites the
configuration, and restarts the container on the same store.

Findings:

- The allow-list of the operator registry holds the owner, the role holders and the operators.
  A write to it needs one read.
- The allow-list of a reward contract holds the owner and the role holders. An operator is
  admitted for a reward contract through the allow-list of the operator registry. That needs
  two reads.
- A refusal by the gate takes no slot and writes no state. A rejection by the contract takes
  both.
- Every decision of the gate pays for its reads of contract state. The refusal path is the
  path that an attacker uses, so its cost is the one to measure.
- A trie miss answers HTTP 404 with an HTML body. It is not an empty 200.
- The gate refuses every unsigned request and does not tell a read from a write. The free
  routes must name every read verb that a consumer uses: `now`, `compute`, `slot` and `as`. A
  verb that is missing answers 400.
- Free reads are granted per process id. A route pattern that matches any process id makes the
  node a free read service for every process.
- The root route `^/$` must be free, or the gate refuses the request that redirects to
  Hyperbuddy.
- The gate is referenced by module id and not inlined. Other source has another id.
- The production hook chain has 6 hooks with `p4@1.0` last. Over HTTP the hooks are indexed
  from 1, so `p4` is entry 6.
- The `device` key of a rendered hook holds the name of the serializer. Identify the `p4` hook
  by `pricing-device`.
- After the gate is on, a spawn is refused for every signer that is not a deploy wallet.
- Rewrite a bind-mounted configuration file in place. Replacing the file changes the inode, and
  the mount keeps the old file.
- A node without an edge must keep `p4` in front of `~bundler@1.0`. The free bundler route of
  stage and live is safe only because their edge refuses that route.

### gate-subject-replay.ts

Question: does the gate refuse a bundler upload envelope that is replayed at a push path.

```sh
bun run scripts/probe/gate-subject-replay.ts
GATE_SRC=<file.lua> bun run scripts/probe/gate-subject-replay.ts
```

| Variable | Default | Meaning |
| --- | --- | --- |
| `IMAGE` | An image digest in the script | Image under test |
| `GATE_SRC` | `runtime/write-gate.lua` | Gate source to publish |
| `KEEP` | Off | `1` leaves the container `hb-subject-replay` running |

`DEPLOYER_PRIVATE_KEY` is required. The probe points `bundler-ans104` at a local listener on
port 9099, sends one write, keeps the bytes that the node posted, and replays them over a raw
socket at `/<pid>~process@1.0/push`.

Findings:

- The upload envelope of the node is unsigned httpsig with `bundler-subject: body`. The
  signature is on the nested item. `hb_http:post` does not commit what it sends.
- Whether a `committer` field can be trusted depends on the codec of the request:

  | Codec | Signature verified |
  | --- | --- |
  | `ans104@1.0` | Always |
  | `tx@1.0` | Always |
  | `httpsig@1.0` | Only when `force_signed_requests` is set |
  | Other | Always, by `hb_message:verify` |

- A gate that takes a signer from a nested field of an unsigned httpsig request trusts a field
  that nothing verified.
- The gate refuses the replayed envelope with
  `Node will not service this request under any circumstances.`, and no slot is taken.
- The refusal message is the evidence. A gate that admits the replay also ends in HTTP 400,
  because the request fails later in the push.
- A request body built by hand does not test this. It fails to decode before it reaches `p4`.

### stranger-write.ts

Question: can a wallet that is on no list write to a process on a node.

```sh
HB_URL=<url> bun run scripts/probe/stranger-write.ts
```

`HB_URL` defaults to `https://hb-dev.anyone.tech`. `DEPLOYER_PRIVATE_KEY` is required. The probe
spawns with the deployer key and sends one message with a random key.

Findings:

- A node with an allow-list refuses the write of a wallet that is not on the list, also to a
  process that an allow-listed wallet spawned. A process id with a free route that covers
  `push` is exempt.
- A local node without an allow-list accepts a write from any wallet.
- Test a browser wallet against a local node.

## Cross-process reads

### xproc-syntax.ts

Question: which forms of `ao.resolve` read the state of another process from inside `compute`.

```sh
HB_URL=http://localhost:8734 bun run scripts/probe/xproc-syntax.ts
```

`DEPLOYER_PRIVATE_KEY` is required. Process B holds a marker. Process A reads it in five ways
and records what each returns.

| Form | Result |
| --- | --- |
| `ao.resolve({ 'as', 'process@1.0', pid }, 'now/state/marker')` | The value |
| `ao.resolve(pid .. '~process@1.0/now/state/marker')` | The value |
| `ao.resolve({ path = '/' .. pid .. '~process@1.0/now/state/marker' })` | The value |
| `ao.resolve({ 'as', 'process@1.0', pid }, { path = 'now/state/marker' })` | The process message, not the value |

Findings:

- A process can read the state of another process during `compute`.
- One form returns the process message without an error.
- A malformed path raises an Erlang error that `pcall` does not catch. The error leaves
  `compute`, and the process cannot compute any further slot.
- Never build a resolve path from a value that was not validated.
- Establish a path form on a throwaway process, or over HTTP, before a contract uses it.

### xproc-gate.ts

Question: does a cross-process read wait behind the backlog of its target.

```sh
HB_URL=http://localhost:8734 CONTAINER=<name> bun run scripts/probe/xproc-gate.ts
```

`CONTAINER` defaults to `hb-spike`. `DEPLOYER_PRIVATE_KEY` is required. Needs the operator
registry bundle and seed in `dist/`. A gate process makes one cross-process read per message, so
the time of a push minus the time of an empty push is the cost of the read.

Findings:

- `now/<path>` computes to the latest slot. A read through `now` waits until every queued
  message of the target is computed.
- `compute/<path>` does not wait. `dev_process` reads `slot` or `compute` from the request.
  Without a slot it serves the latest known state and computes nothing.
- A caller that reads through `now` inherits the backlog of the target. Writes queued on the
  target slow every such reader.
- The gate reads through `compute`.

The probe reads `state/verified/<fingerprint>` of its target. That path resolves only for a
module that keeps its state on the process message.

## Bundling

### bundler-landing.ts

Question: does the data of a bundle that the node made itself land on Arweave.

```sh
bun run scripts/probe/bundler-landing.ts dev
bun run scripts/probe/bundler-landing.ts --url https://hb-dev.anyone.tech --wait 900
CONTROL=<txid> bun run scripts/probe/bundler-landing.ts dev
```

| Option or variable | Default | Meaning |
| --- | --- | --- |
| `<env>` | None | `dev`, `stage` or `live` |
| `--url <base>` | None | Node to test, in place of an environment |
| `--wait <seconds>` | `900` | How long to wait for a new bundle |
| `--gateway <url>` | `https://arweave.net` | Gateway for the checks |
| `CONTROL` | Unset | Id of a transaction whose data is known to be retrievable. The probe checks it first |
| `DEPLOYER_PRIVATE_KEY` | None | Required in active mode. Must be admitted by the node |

| Mode | When | What it does |
| --- | --- | --- |
| Active | The bundler route answers | Records the newest transaction of the node, posts one item, waits for a new transaction, and checks its data |
| Passive | The edge answers 403 for `~bundler@1.0` | Posts nothing. Reads the newest assignment items of the node, walks `bundledIn` to the L1 root, and checks who signed the root and whether its data is retrievable |

Findings:

- A mined bundle transaction does not prove that its data landed. The header and the chunks are
  posted separately. A node can mine the transaction while every chunk is refused with
  `400 data_root_not_found`.
- `/tx/<id>/status` and `/tx/<id>/offset` reflect the header only. They look healthy for a
  bundle whose data is missing.
- The check that tells the two apart is `GET <gateway>/raw/<txid>`. A landed bundle answers 200
  with exactly `data_size` bytes. A failed bundle answers 404. A short body is a failure.
- The header is indexed before the chunks are seeded. An early 404 is expected. Only a 404 that
  persists is a finding.
- A POST to `~bundler@1.0/tx` without `accept: application/json` answers with the Hyperbuddy
  page and HTTP 200.
- The node does not tell a client which L1 transaction an item landed in. The probe watches the
  Arweave address of the node through GraphQL.
- The node pays for its bundles with its own wallet.
- With `bundler-max-items` unset, a small batch is flushed by the idle timer, after minutes.
- A run that sees no new bundle is inconclusive. It is not a failure.
- The owner of the L1 root of an assignment shows who bundled it. Bundles nest, so walk
  `bundledIn` to the root.
- GraphQL lists the assignment items of a node under the same owner as its L1 bundles. The
  items have a data size of 0. Only the bundles carry bytes.
- A locked edge has no route for `~bundler@1.0` and answers 403. That is correct.
- Passive mode judges what the node published recently. After a change to the bundler
  configuration, wait for new assignments.
- The verdict follows the configured `bundler-ans104`. A node that points at an external
  uploader and is bundled by it behaves correctly.

### gated-bundler-repro.ts

Question: does the upload of the node reach its own bundler when the pricing device is Lua.

```sh
bun run scripts/probe/gated-bundler-repro.ts
```

| Variable | Default | Meaning |
| --- | --- | --- |
| `IMAGE` | An image digest in the script | Image under test |
| `GATE_SRC` | `runtime/write-gate.lua` | Gate source to publish |
| `HB_PRINT` | `lua_error` | Extra print topics. `bundler_short` is always added |
| `VERBOSE` | Off | `1` prints the node events of each phase |
| `KEEP` | Off | `1` leaves the container `hb-bundler-repro` running |

`DEPLOYER_PRIVATE_KEY` is required. The probe runs the same write once with `faff@1.0` and once
with `lua@5.3a` as the pricing device, with `bundler-ans104` on loopback. It passes when the
upload reaches the bundler under both.

Findings:

- The node posts every scheduled message and every assignment to its configured bundler. With
  a loopback bundler that is a request to itself, and the request runs the `on/request` hooks.
- `dev_lua` must encode a request to hand it to a Lua pricing device. Stock `dev_lua` cannot
  encode a cache link. A request that carries one answers 400
  `Could not estimate price of request.`
- The image needs the patch that teaches `dev_lua` to encode a link. The probe fails on an
  image without it.
- The scheduler discards the result of its upload and does not retry. After a refused upload
  the slots keep advancing, and their assignments never reach Arweave.
- The scheduler uploads inline, because `scheduling_mode` defaults to `sync`.
- The upload envelope is unsigned. `faff@1.0` admits it, and the gate refuses an unsigned
  request. That difference is real and is not the cause of a failed estimate.
- Test a suspected cause by substitution. A gate that admits everything fails in the same way
  on an image without the patch.
- `bundler_short` events carry `queueing_item`. That event is the evidence that the bundler
  accepted the upload.
- A POST of `{}` to a push path answers 400 `Message is not valid.` under both pricing devices.
  The request is rejected before `p4` is consulted.

## Image and upgrade

### gc-cost-curve.ts

Question: does the cost of a message grow with the number of accumulated slots.

```sh
HB_URL=http://localhost:8734 CONTAINER=<name> bun run scripts/probe/gc-cost-curve.ts
HB_URL=<url> MODULE_ID=<id> bun run scripts/probe/gc-cost-curve.ts
```

| Variable | Default | Meaning |
| --- | --- | --- |
| `WRITES` | `50` | Messages to send. Each takes its own slot |
| `CONTAINER` | `hb-gcp` | Local mode: container that receives the module |
| `MODULE_ID` | Unset | Remote mode: id of an operator registry module that is published on that node |

`DEPLOYER_PRIVATE_KEY` is required. Needs the operator registry bundle and seed in `dist/`. The
probe prints the average of the first 10 and of the last 10 messages and their ratio as
`GROWTH`.

Findings:

- `dev_lua:snapshot/3` serializes the whole Lua VM. Without a collection, the VM retains every
  table that the process ever allocated, and the snapshot is written twice per slot.
- On an image without the collection, the cost of a message grows with the number of slots
  while the state hardly changes.
- On an image that collects after compute, the cost stays flat.
- Reads are not affected by the number of slots.
- The ratio is the signal. `scripts/qualify-node.ts` gates on it with a ceiling of 1.50.
- Against a remote node the build cannot be named from outside. The curve is the evidence.

### gc-restore-fidelity.ts

Question: is state identical after a restart of the node, on an image that collects the Lua VM.

```sh
HB_URL=http://localhost:8734 CONTAINER=<name> bun run scripts/probe/gc-restore-fidelity.ts
```

| Variable | Default | Meaning |
| --- | --- | --- |
| `CONTAINER` | `hb-gcp` | Container to restart |
| `WRITES` | `8` | Signed writes before the snapshot |
| `IDLE_S` | `70` | Seconds to idle so that a snapshot is taken. Must exceed 60 |

`DEPLOYER_PRIVATE_KEY` is required. Needs the operator registry bundle and seed in `dist/`.

Findings:

- The collection works on a copy of the VM state that is made for serialization. The running
  VM continues on its own state. The collection can therefore change behavior only after a
  restore.
- A warm read proves nothing about the collection. Every check is made across a restart.
- The collector marks from the global table, the metatables and the stacks. State that is
  reachable from those roots survives.
- State is byte-identical across the restart.
- A node restores from the latest snapshot and replays the slots after it. Without a snapshot
  it replays from slot 0.
- The time of the first read after the restart shows which path ran. A resume from a snapshot
  is fast. A replay is slow. A run that replayed is inconclusive and exits 1.
- The `fingerprints` view takes a comma-separated `ids` parameter and answers for all of them
  in one request. Do not give a parameter the name of its view.
- A fingerprint is 40 uppercase hex characters. A test fingerprint with another character makes
  every handler fail, and every push still answers 200.

### opreg-wedge-repro.ts

Question: can an image continue a process whose allow-list trie another image wrote.

```sh
bun run scripts/probe/opreg-wedge-repro.ts
bun run scripts/probe/opreg-wedge-repro.ts --seed <file>
IMAGE=<candidate> bun run scripts/probe/opreg-wedge-repro.ts --history 3 --from-image <deployed> --expect-healthy
```

| Option | Default | Meaning |
| --- | --- | --- |
| `--seed <file>` | An empty seed | State dump to seed from |
| `--raw-seed <file>` | None | A spawn payload that is already an envelope |
| `--history <n>` | `0` | Batches of certificates to send before the test writes. Each batch uses new fingerprints and grows the trie |
| `--from-image <ref>` | None | Spawn and build history on this image, then restart on `IMAGE` with the same store |
| `--gate` | Off | Restart the node with `p4` and the write gate, in the hook chain of stage and live |
| `--expect-healthy` | Off | Exit 1 when the process stops computing. Without it, that outcome exits 0 |

| Variable | Default | Meaning |
| --- | --- | --- |
| `IMAGE` | An image digest in the script | Image under test |
| `NAME` | `hb-wedge` | Name of the container |
| `STORE_VOL` | `hb-wedge-store` | Volume that holds the store across an image change |
| `PROBE_KEY` | A fixed test key | Key that signs |
| `KEEP` | Off | Leave the container running |
| `CONTAINER_ENGINE` | `podman` | Container engine |

Findings:

- A process that was spawned on an image computes on that image. That says nothing about a
  process that an earlier image wrote.
- After an upgrade from `v0.9-FINAL` to a build that loads devices from the preloaded store,
  the first message that grants an allow-list entry fails with
  `Erlang error while running Lua: undef`. It fails on images without local patches as well.
- Across that boundary a read of the trie succeeds, and a write that grants nothing succeeds.
  Only a write that grants fails.
- After the failure every compute attempts the failed slot again and fails. State stays at the
  last computed slot, and the scheduler keeps accepting messages.
- `as/` keeps answering 200 with the last computed state. `now/` answers with the error.
- `HB_PRINT=lua_error` prints nothing for this error.
- The offline tiers cannot show the failure. They use a plain table in place of the trie.
- A test of an upgrade must build trie state on the old image, change the image on the same
  store, and then send a write that grants.
- A node that restarts needs a persistent wallet. With an ephemeral wallet the node has a new
  address after a restart, and the process points at the old one. Every write then fails.
- `p4` must sit behind the hook chain of production. With `p4` alone the request is absent from
  the hook message, and the gate sees no signer.
- A state dump holds the state of the last computed slot. The payload of the spawn item holds
  the state that the process started from.
