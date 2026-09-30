# Scripts

Build, deploy, verification and test tooling for the contracts.

Paths in this document are relative to `ao/`. Run every command from `ao/`:

```sh
bun run scripts/<name>.ts [arguments]
```

| Location | Content |
| --- | --- |
| `scripts/` | The tools indexed in this document |
| `scripts/util/` | Shared modules. See [Utilities](#utilities) |
| `scripts/probe/` | Probes that each answer one question about node behavior. See [probe/README.md](probe/README.md) |
| `scripts/legacy/` | Tools for the legacy contracts. See [Legacy scripts](#legacy-scripts) |
| `scripts/test-keys/` | Public test keys for the legacy tools. Never add their addresses to a node's allow-list |

Related documents:

| Document | Content |
| --- | --- |
| [../docs/runtime.md](../docs/runtime.md) | The native runtime: state, views, migration seed, allow-list |
| [../docs/contracts.md](../docs/contracts.md) | The three native contracts |
| [../docs/write-gate.md](../docs/write-gate.md) | The gate that decides who may write |
| [../docs/READING-THE-CONTRACTS.md](../docs/READING-THE-CONTRACTS.md) | The read surface for consumers |
| [../docs/durability-and-recovery.md](../docs/durability-and-recovery.md) | Snapshots, publishing and recovery |
| [../docs/node-qualification.md](../docs/node-qualification.md) | Qualifying a HyperBEAM image |
| [../spec/README.md](../spec/README.md) | The contract test tiers |
| [../../operations/ao/README.md](../../operations/ao/README.md) | The Nomad jobs that run these scripts |

## Contents

- [Conventions](#conventions)
- [Build](#build)
- [Deploy and publish modules](#deploy-and-publish-modules)
- [Verify](#verify)
- [Test tiers](#test-tiers)
- [Snapshots and recovery](#snapshots-and-recovery)
- [Development fixtures](#development-fixtures)
- [Smoke tests](#smoke-tests)
- [State capture from the legacy network](#state-capture-from-the-legacy-network)
- [Utilities](#utilities)
- [Legacy scripts](#legacy-scripts)

In the index tables, the Arguments column shows what follows `bun run scripts/<script>`. The
Environment column lists the variables that the script reads, with the default in parentheses.

## Conventions

### Environment file

Bun loads `ao/.env` when a script runs from `ao/`. A variable set on the command line takes
precedence. `HB_URL` and `DEPLOYER_PRIVATE_KEY` usually come from that file, so it decides which
node a script reaches and which key signs. Read the node and the signer address that a script
prints before its first write.

### Shared variables

| Variable | Meaning | Default |
| --- | --- | --- |
| `HB_URL` | Base URL of the HyperBEAM node | Per script. Required by `deploy.ts`, `run-e2e.ts`, `verify-migration.ts` and `verify-deployment.ts`. `http://localhost:8734` in most test scripts. `https://hb-dev.anyone.tech` in `dev-walkthrough.ts`, `faff-probe.ts` and `interact-probe.ts` |
| `DEPLOYER_PRIVATE_KEY` | EVM private key in hex, with or without `0x`. Signs spawns and messages | Per script. See [Signing keys](#signing-keys) |
| `MODULE_ID` | Id of a module that the node can resolve | None |
| `CONTAINER_ENGINE` | `podman` or `docker`, for scripts that run a container | `podman` |
| `LUERL_IMAGE` | Image of the Tier 2 luerl runner | `anyone-luerl:1.3.0` |
| `REPORTS_DIR` | Directory for generated reports | A directory beside the repository checkout. It exists on a workstation only, so set the variable in a container |

### Signing keys

| Behavior when `DEPLOYER_PRIVATE_KEY` is unset | Scripts |
| --- | --- |
| Stops with an error | `deploy.ts`, `dev-walkthrough.ts`, `dev-dashboard-fixture.ts`, `dev-staking-mirror.ts`, `tier3-deploy.ts`, `spawn-lua.ts`, `faff-probe.ts`, `interact-probe.ts`, `publish-view.ts` |
| Signs with a development key that is committed in this repository | `staking-view-golden.ts`, the other `tier3-*.ts` scripts, `lua-smoke.ts`, `hyper-aos-smoke.ts`, `bint-luerl-conformance.ts` |
| Skips the step that needs a signature | `verify-migration.ts` |

`run-e2e.ts` reads `E2E_PRIVATE_KEY` and falls back to the committed development key.
`qualify-node.ts` reads `E2E_PRIVATE_KEY`, then `DEPLOYER_PRIVATE_KEY`, then the committed key.

Rules:

- The committed development key is public. Never add its address to a node's allow-list. It is
  suitable for a throwaway local container only.
- The signer of a spawn becomes the owner of the process. The owner never changes.
- A signer that is not on the node's allow-list is refused with HTTP 400 and
  `Node will not service this request under any circumstances.` That answer means the signer is
  not admitted. It does not mean the node is broken.
- A test that expects a refusal must sign with a key generated for that run. A key that is
  allow-listed anywhere turns the refusal check into a false pass.

### Environments

| Name | Host |
| --- | --- |
| `dev` | `hb-dev.anyone.tech` |
| `stage` | `hb-stage.anyone.tech` |
| `live` | `hb.anyone.tech` |
| `local` | `localhost:8734`, or `LOCAL_HOST` |

A local node for testing:

```sh
podman run -d --name hb-local --network host \
  -e HB_ALLOW_EPHEMERAL_WALLET=true \
  -e HB_WALLET_PATH=/app/wallet.json \
  ghcr.io/memetic-block/hyperbeam-docker:v0.9-FINAL
```

Scripts that start their own container use host networking on port 8734. Stop any other local
node first, and run one such script at a time. `qualify-node.ts` uses port 8735 by default.

### Exit codes

Unless a section says otherwise:

| Code | Meaning |
| --- | --- |
| 0 | Every check passed |
| 1 | At least one check failed |
| 2 | Usage error, missing configuration, or an error in the script itself |

### Module ids

A module can be made resolvable in two ways. The two produce different ids for the same bytes.

| Kind | Made by | Id | Resolves on |
| --- | --- | --- | --- |
| Durable | `publish-module.ts`, `deploy.ts --publish` | Id of the signed ANS-104 data item | Any node, through the gateway, once the item is indexed |
| Node-local | `bin/hb eval` on the node host: `publish-modules.sh`, `deploy.ts --publish-cmd`, `run-e2e.ts --publish-container`, `publish-native-module.ts` | `hb_util:id` of the message that the node wallet committed | The node whose cache holds it |

Rules:

- An id depends on the signing wallet as well as on the bytes. The same source signed by
  another wallet gets another id.
- A node-local id exists in one cache. Publish on the node that will use the module. A rebuilt
  node or a second node cannot resolve it, and a process spawned against it stops computing
  when that cache is lost.
- A spawn by module id is accepted even when the node cannot resolve the module. The failure
  appears at the first compute.
- A durable id resolves only after the gateway has indexed the item. Indexing can take hours
  after the bundler accepts the item.
- `deploy.ts` refuses a module that is not retrievable from Arweave, unless
  `--allow-unpublished-module` is passed.
- A seeded spawn must reference its module by id. An inline module occupies the data field of
  the spawn message, which is where the seed travels.

### Artifacts in `dist/`

`dist/` is build output and is not committed.

| File | Written by | Read by |
| --- | --- | --- |
| `<contract>.lua` | `bundle.ts` | Legacy deploy tools, the mocha suite |
| `<contract>-deploy.lua` | `bundle-deploy.ts` | Tools for the older runtime |
| `<contract>-native.lua` | `build-native-bundle.ts`, `deploy.ts` | Module publishing, inline spawns |
| `<contract>-seed.envelope.json` | The seed builders, `build-respawn-seed.ts` | Every seeded spawn |
| `<contract>-seed.expected.json` | The seed builders | State comparisons in `deploy.ts` and the verify and Tier 3 scripts |
| `<contract>-seed.lua` | The seed builders | luerl fixtures only. Never spawn from it |
| `relay-oracle-min.lua`, `relay-oracle-probe.json` | `build-relay-oracle.ts`, `build-relay-probe.ts` | `tier3-relay-validate.ts` |
| `staking-oracle-probe.json` | `build-staking-oracle.ts` | `tier3-staking-validate.ts` |
| `<contract>-publish.json` | `deploy.ts --publish` | `publish-module.ts --recheck` |
| `e2e-logs/` | `run-e2e.ts` | People |
| `qualify-logs/` | `qualify-node.ts` | People |

`deploy.ts` with `--seed live` or `--seed stage`, `verify-migration.ts`, `verify-deployment.ts`
and `run-e2e.ts` rebuild the seed files of a contract. Each rebuild overwrites
`<contract>-seed.envelope.json` and `<contract>-seed.expected.json`.

## Build

| Script | Purpose | Arguments | Environment |
| --- | --- | --- | --- |
| `bundle.ts` | Bundles each legacy contract in `src/contracts/` into `dist/<contract>.lua`. `bun run build` runs it | None | None |
| `lua-bundler.ts` | Module. `bundle(entryPath)` inlines the local modules that a Lua entry file requires. A module that is not found locally is left for the host to provide | Not run directly | None |
| `bundle-deploy.ts` | Bundles one legacy contract with the older runtime (`runtime/runtime.lua`) into one file that defines `compute`. Writes `dist/<contract>-deploy.lua` | `<contract> <StateGlobal>`, for example `operator-registry OperatorRegistry` | `STAGE_DIR` (`/tmp`): where the staging directory is created |
| `build-native-bundle.ts` | Builds the pure-source module of a native contract: `dist/<contract>-native.lua` | `<contract>`: `operator-registry`, `relay-rewards` or `staking-rewards` | None |
| `build-seed.ts` | Builds the operator registry seed from the state dump. See [Seed builders](#seed-builders) | `[net]`: `live` (default) or `stage` | None |
| `build-relay-seed.ts` | Builds the relay rewards seed from the state dump | `[net] [--previous-round <value>]` | None |
| `build-staking-seed.ts` | Builds the staking rewards seed from the state dump | `[net]` | None |
| `build-respawn-seed.ts` | Builds an operator registry seed from the state that a node holds now. See [build-respawn-seed.ts](#build-respawn-seedts) | `<env> [--out <file>] [--verify --image <ref>]` | `IMAGE`, `CONTAINER_ENGINE` (`podman`) |
| `build-relay-oracle.ts` | Builds `dist/relay-oracle-min.lua`: native relay rewards seeded with the configuration and previous round of the dump, and empty reward maps. Needs the relay seed | None | None |
| `build-relay-probe.ts` | Runs `spec/luerl/scenarios/relay-round-probe.lua` under luerl on `dist/relay-oracle-min.lua` and writes `dist/relay-oracle-probe.json` | None | `TIMEOUT` (`900`, seconds), `CONTAINER_ENGINE`, `LUERL_IMAGE` |
| `build-staking-oracle.ts` | Runs the shared staking round under luerl on the full seed bundle and writes `dist/staking-oracle-probe.json`. Needs the staking seed | None | `N` (`250`): pairs in the round. `CONTAINER_ENGINE`, `LUERL_IMAGE` |
| `build-size-ladder.ts` | Writes inert Lua files of 100, 500, 1024, 2048, 5120 and 10240 KB, for measuring which item sizes settle through a bundler | `[outdir]` (`dist/size-ladder`) | None |
| `gen-keys-ar.ts` | Generates Arweave keys and prints them as JSON | None | `NUMBER_OF_KEYS_TO_GENERATE` (`10`) |

Notes:

- The native module is pure source. The same bytes serve every environment and every reseed,
  because the seed travels in the spawn message.
- `build-native-bundle.ts` needs its contract argument. `publish-native-module.ts` and
  `buildBundle()` without an argument build the operator registry.
- The files from `build-size-ladder.ts` are permanent once published. Each file states in its
  header that it is an inert capacity probe.
- The output of `gen-keys-ar.ts` contains private keys. Do not commit it or write it to a log.
- The oracle builders fail when the round computes nothing. A round that computed nothing would
  match a node that also computed nothing.
- `relay-round-probe.lua` runs in `bundle` mode on `dist/relay-oracle-min.lua` only. A timeout
  in `build-relay-probe.ts` usually means the scenario ran against another bundle.

Build order for the Tier 3 oracles:

```sh
bun run scripts/build-relay-seed.ts && bun run scripts/build-relay-oracle.ts && bun run scripts/build-relay-probe.ts
bun run scripts/build-staking-seed.ts && bun run scripts/build-staking-oracle.ts
```

`run-e2e.ts` runs these builders itself.

### Seed builders

`build-seed.ts`, `build-relay-seed.ts` and `build-staking-seed.ts` transform the state dump in
`state-dumps/` into the state shape of the native contract.

Each builder writes three files for its contract:

| File | Content |
| --- | --- |
| `dist/<contract>-seed.envelope.json` | The seed as spawn data: `{ "ao-migration-seed": 1, "state": ..., "acl": { "roles": ... } }` |
| `dist/<contract>-seed.expected.json` | The migrated state and roles, used as the reference in comparisons |
| `dist/<contract>-seed.lua` | The contract with the seed embedded, for luerl fixtures |

Transform rules:

| Contract | Rule |
| --- | --- |
| All | Every address is canonicalized to EIP-55 with `ethers.getAddress`. A malformed address fails the build |
| All | Role holders are canonicalized in the same way |
| All | An empty collection in the dump is an array. It is read as an empty map |
| Operator registry | Fingerprint keys are kept verbatim. The blocked list becomes a set keyed by address |
| Relay rewards | `PreviousRound` keeps `Timestamp`, `Period`, `Summary` and `Configuration`. `Details` is dropped. `PendingRounds` is empty |
| Staking rewards | Pair maps are flattened to `hodler/operator` keys. `PreviousRound.Details` becomes seven parallel maps. `Running` and `Share` stay numbers. `PendingRounds` is empty |

The staking builder checks that no hodler and no pair is lost, both in the address transform
and in the flattening.

`--previous-round` of `build-relay-seed.ts` sets `PreviousRound.Timestamp` in the seed. A round
pays `TokensPerSecond` times the seconds since that timestamp, so the value decides what the
first round after the spawn pays.

| Value | First round covers |
| --- | --- |
| `keep` (default) | The time since the last round in the state dump |
| `now` | The time since the seed was built |
| `0` | Nothing. The contract computes a round length of 0 when the previous timestamp is 0 |
| Epoch milliseconds | The time since that moment |

Rules:

- A redeploy of a state chain that is in use must not use `keep`. Pass `0` or `now`.
- `keep` exists so that the expected files and the golden fixtures stay stable.
- With `now`, build the seed immediately before the spawn. The time between the build and the
  first round is paid by the first round.
- `build-staking-seed.ts` and `build-seed.ts` take no `--previous-round` option. The staking
  seed copies `PreviousRound.Timestamp` from the dump.

### build-respawn-seed.ts

Builds the seed envelope for a respawn of the operator registry from the state that a node
serves now. A respawn from the state dump would discard every change made since the dump.

```sh
bun run scripts/build-respawn-seed.ts <dev|stage|live> [--out <file>]
bun run scripts/build-respawn-seed.ts live --verify --image <ref>
```

| Option | Default | Meaning |
| --- | --- | --- |
| `--out <file>` | `dist/operator-registry-seed.envelope.json` | Where the envelope is written |
| `--verify` | Off | Spawn from the envelope on a local container and compare the result with the source |
| `--image <ref>` | `IMAGE` | Image for `--verify`. Use the image that will be deployed |

What it does:

1. Reads the process id from entry 1 of the node's `p4-non-chargable-routes`.
2. Reads `as/dump` and `as/roles` of that process.
3. Writes the envelope.
4. With `--verify`: starts the container `hb-respawn-verify` from the image, publishes the
   operator registry module into it, spawns from the envelope, and compares the digests of
   state and roles with the source.

Rules:

- It builds the envelope of the operator registry only.
- Check the process id that it prints. Entry 1 of the route list must be the operator registry.
- It reads `as/`, not `now/`. On a process that can no longer compute, `now/` fails while `as/`
  still serves the last computed state.
- It refuses to write an envelope without roles. The controllers could not write to a process
  that was spawned from it.
- Run `--verify` before a cutover. It exits 1 when the envelope does not spawn to the state it
  was captured from.
- An empty Lua table serializes as `[]`. The script reads every state map as a map, so an empty
  map is not seeded as a list.
- Build the envelope last. `verify-migration.ts` and `verify-deployment.ts` rebuild
  `dist/operator-registry-seed.envelope.json` from the state dump and overwrite it.
- Spawn with `deploy.ts operator-registry --seed current`.

## Deploy and publish modules

| Script | Purpose | Arguments | Environment |
| --- | --- | --- | --- |
| `deploy.ts` | Builds, publishes, spawns and verifies a native contract. See [deploy.ts](#deployts) | `<contract> --seed <source> [options]` | See the section |
| `publish-module.ts` | Publishes Lua modules to Arweave through a bundler and waits for settlement. See [publish-module.ts](#publish-modulets) | `<file.lua> [...] [options]` | `BUNDLER` (required), `PUBLISH_KEY` (required), `GATEWAY` (`https://arweave.net`) |
| `publish-modules.sh` | Publishes the contract modules and the write gate into the cache of one node. See [publish-modules.sh](#publish-modulessh) | `[env] [--gate-only]` | Needs the `nomad` command and access to the cluster |
| `publish-native-module.ts` | Writes the operator registry bundle and prints the commands that commit it into the cache of a local container named `hb-tier3` | `[outfile]` (`dist/operator-registry-native.lua`) | None |
| `publish-view.ts` | Uploads `src/views/<VIEW_NAME>.lua` through Turbo | None | `VIEW_NAME` (required), `VIEW_VERSION` (`dev`), `DEPLOYER_PRIVATE_KEY` (required), `USE_CONSOLE_LOGGER` |

The commands that `publish-native-module.ts` prints also call `hb_client:upload`. From
`bin/hb eval` that call targets the bundler that is compiled into the node, whatever the node
configuration says. The id that the commands print is node-local. Use `publish-module.ts` for a
durable publication.

### deploy.ts

```sh
# phase 1: publish the module durably, then wait for settlement
BUNDLER=<url> PUBLISH_KEY=<hex> bun run scripts/deploy.ts <contract> --seed <source> --publish

# phase 2: spawn from the settled module id and verify
HB_URL=<url> DEPLOYER_PRIVATE_KEY=<hex> MODULE_ID=<id> \
  bun run scripts/deploy.ts <contract> --seed <source>
```

`<contract>` is `operator-registry`, `relay-rewards` or `staking-rewards`.

| Option | Meaning |
| --- | --- |
| `--seed live`, `--seed stage` | Build the seed from the state dump of that environment and send it with the spawn |
| `--seed current` | Send the envelope that `build-respawn-seed.ts` wrote |
| `--seed none` | Send no seed. The process starts from the declared empty state |
| `--previous-round <value>` | Passed to the seed builder. Read by `build-relay-seed.ts` only. See [Seed builders](#seed-builders) |
| `--publish` | Publish the module through `publish-module.ts`, write `dist/<contract>-publish.json`, and exit |
| `--publish-cmd` | Print the node host commands that produce a node-local id, and exit |
| `--allow-unpublished-module` | Spawn without checking that the module is on Arweave. For tests only |
| `--dry-run` | Run every step before the spawn, then exit |

| Variable | Needed for | Meaning |
| --- | --- | --- |
| `HB_URL` | Spawn | Node to spawn on. Required |
| `DEPLOYER_PRIVATE_KEY` | Spawn | Signs the spawn. Required. Its address becomes the owner |
| `MODULE_ID` | Spawn | Id of the published module. Required |
| `SCHEDULER` | Spawn | Scheduler location. Default: the address of the node |
| `AUTHORITY` | Spawn | Authority. Default: the address of the node |
| `CONTRACT_CONSUL_KEY` | Spawn | Consul key that receives the process id. Optional |
| `CONSUL_IP`, `CONSUL_PORT` | Spawn | Required when `CONTRACT_CONSUL_KEY` is set |
| `CONSUL_TOKEN` | Spawn | Consul token. Optional |
| `BUNDLER`, `PUBLISH_KEY` | `--publish` | See [publish-module.ts](#publish-modulets) |

Steps of the spawn phase:

1. Build the module from source. When `dist/<contract>-native.lua` already exists, compare it
   with the build and stop on a difference.
2. Build or load the seed.
3. Check the module: indexed on Arweave, its bundle mined, at least 50 confirmations deep, and
   the bytes at `https://arweave.net/raw/<id>` equal to the local bundle by SHA-256.
4. Spawn, with the forced first compute deferred.
5. With `CONTRACT_CONSUL_KEY`: write the process id to Consul and wait up to 300 seconds until
   the node serves `slot/current` for it. The node restarts on the change, so connection errors
   during the wait are expected.
6. Force the first compute and wait until `status.initialized` is true.
7. Compare the counts of the `status` view with the expected seed.
8. Check the reads that the write gate makes: the owner is readable from the spawn commitment,
   `allowlistId` is a trie id, and the gate read path admits the deployer, every seeded role
   holder and, for the operator registry, a sample of seeded operators.
9. On any failure after step 5, restore the previous value of the Consul key and exit 1.

Rules:

- `--seed` has no default.
- Nothing has a fallback. A missing `HB_URL`, key or module id stops the run.
- `--seed live` and `--seed stage` rebuild the seed and overwrite a seed built by hand. Pass
  builder options to `deploy.ts`.
- A redeploy of relay rewards on a state chain that is in use passes `--previous-round 0` or
  `--previous-round now`.
- To replace a running operator registry, use `--seed current`. `--seed live` starts from the
  state dump.
- `--seed current` needs an envelope with roles. With `--seed current`, remove a
  `dist/<contract>-seed.expected.json` that an earlier seed build left. The count check reads
  that file when it exists, and it describes the dump.
- `MODULE_ID` must be the id of the bytes that this checkout or image builds. The byte check
  refuses an id that was published from another commit.
- In a container the bundle is part of the image and is read-only. A difference between the
  bundle and the source means the image is stale. Rebuild the image.
- On a workstation, rebuild a stale bundle with `build-native-bundle.ts <contract>`.
- The node must be one of ours. Hosts under `forward.computer`, `ao-testnet.xyz` and
  `arweave.dev` are refused.
- When `SCHEDULER` is not the address of the node, the node does not adopt the process.
- On a node with the write gate, set `CONTRACT_CONSUL_KEY`. The verification reads are unsigned.
  They are free only for process ids in `p4-non-chargable-routes`, and that list is rendered
  from the Consul keys.
- When verification fails and the key had no previous value, the key names a process that was
  not verified. Clear it by hand.
- Without `CONTRACT_CONSUL_KEY` the script prints the `consul kv put` command. Record the
  process id by hand.
- `--publish --dry-run` still posts the module to the bundler. It only skips the wait for
  settlement.
- A process that has never computed answers 508 `Request creates infinite recursion` on every
  `compute/` path. The gate checks therefore run after the first compute.

Every deploy creates a new process id. See
[Process ids](../docs/READING-THE-CONTRACTS.md#process-ids).

### publish-module.ts

Signs each file as an ANS-104 data item with `PUBLISH_KEY`, posts it to `BUNDLER`, and waits
until the gateway index confirms it.

```sh
BUNDLER=<url> PUBLISH_KEY=<hex> bun run scripts/publish-module.ts <file.lua> [...]
bun run scripts/publish-module.ts --check-only <id>
bun run scripts/publish-module.ts --recheck <manifest.json>
```

| Option | Default | Meaning |
| --- | --- | --- |
| `--wait <seconds>` | `2400` | How long to wait for settlement. `0` does not wait |
| `--manifest <file>` | None | Write file, id, size and publication time of every accepted item. Written before the wait |
| `--recheck <manifest>` | None | Check every item of a manifest again. Exit 0 when all are indexed |
| `--check-only <id>` | None | Check one id again. Exit 0 when it is indexed |
| `--verify-spawn <node-url>` | None | After settlement, ask that node to resolve the module by id. Use a node with a cold cache |

| Variable | Default | Meaning |
| --- | --- | --- |
| `BUNDLER` | None. Required | Base URL of the bundler |
| `PUBLISH_KEY` | None. Required | EVM key that signs. Its address must be admitted by the bundler |
| `GATEWAY` | `https://arweave.net` | Gateway for the checks |

Three ids exist for one module:

| Id | What it is | Use |
| --- | --- | --- |
| Item id | Id of the signed data item. The bundler returns it and Arweave indexes it | Pass this one as the module id |
| `hb_util:id` | Id in the local cache of a node | Node-local only |
| Bundle transaction id | The L1 transaction that carries the item | Evidence of mining. It is not the module |

Rules:

- A bundler answers 200 with a receipt when it has queued an item. That is not persistence.
- Only the GraphQL index of the gateway says that an item settled. The data endpoint can answer
  200 from a cache for an item that has not settled.
- A data item lives inside a bundle. `/tx/<item id>/status` answers Not Found for it, which
  says nothing. Bundles nest. The confirmations of the root bundle are the evidence of mining.
- A mined transaction does not prove that its chunks were seeded. Retrieve the bytes as well.
- Send `Accept: application/json` with a POST to a node. Without it the node answers with the
  Hyperbuddy page and HTTP 200.
- Tag names are lowercase and unique. The node can then encode the stored item again
  bit-exact for signature verification.
- Keep the manifest. Without it the ids of an interrupted run are lost.

### publish-modules.sh

```sh
scripts/publish-modules.sh [dev|stage|live] [--gate-only]
```

Publishes `dist/operator-registry-native.lua`, `dist/relay-rewards-native.lua`,
`dist/staking-rewards-native.lua` and `runtime/write-gate.lua` into the cache of the node of
one environment, through `nomad alloc exec` and `bin/hb eval`. The default environment is
`dev`. `--gate-only` publishes the write gate alone and does not need `dist/`.

Rules:

- Publish on the node that will use the module. The id depends on the wallet of that node.
  Expect a different id per environment.
- A module in the cache of the node resolves without a round trip to Arweave.
- The write gate fails closed. A gate module that is missing from the cache refuses every write
  to every gated contract.
- Order: publish, then set the id in the configuration of the node, then deploy the node.
- Publishing the same bytes on the same node again yields the same id.
- Build `dist/` first with `build-native-bundle.ts` for each contract.

## Verify

| Script | Purpose | Arguments | Environment |
| --- | --- | --- | --- |
| `qualify-node.ts` | Decides whether a HyperBEAM image may be deployed. See [qualify-node.ts](#qualify-nodets) | `--image <ref>` or `--url <url>`, and options | `E2E_PRIVATE_KEY`, `DEPLOYER_PRIVATE_KEY`, `CONTAINER_ENGINE`, `LUERL_IMAGE`, `MODULE_ID_*` |
| `verify-access-policy.ts` | Checks the access policy that a node has loaded and that its edge enforces. See [verify-access-policy.ts](#verify-access-policyts) | `[env ...] [--dos] [--dos-force]` | `PERTURB`, `LOCAL_HOST`, `LOCAL_GATED`, `LOCAL_ALLOW_LIST` |
| `verify-migration.ts` | Checks that a spawned process is a faithful migration of the state dump. See [verify-migration.ts](#verify-migrationts) | `<contract> --seed <net> [--skip-replay]` | `HB_URL` (required), `PID` (required), `DEPLOYER_PRIVATE_KEY` |
| `verify-deployment.ts` | Reads a deployed process and writes a report. See [verify-deployment.ts](#verify-deploymentts) | `[--behavioral] [--report <path>]` | `CONTRACT`, `PID`, `HB_URL` (all required), `SEED_NET` (`live`), `EXPECTED_MODULE_ID`, `REPORTS_DIR` |
| `staking-view-golden.ts` | Captures every staking view before and after a round and compares with a recorded golden. See [staking-view-golden.ts](#staking-view-goldents) | `[--check] [--resample]` | `MODULE_ID` (required), `HB_URL` (`http://localhost:8734`), `DEPLOYER_PRIVATE_KEY` |
| `validate-address-migration.ts` | Checks on the state dump that canonicalizing an address to EIP-55 keeps its 20 bytes | None | None |

`validate-address-migration.ts` checks four properties:

| Check | Property |
| --- | --- |
| Byte preservation | For every stored address, the EIP-55 form has the same bytes |
| Convergence | An address that is already EIP-55 stays unchanged. An all-caps address converges to the same form |
| Identity | A sender in EIP-55 form and the same operator in all-caps form map to one address |
| Rejection | `getAddress` rejects a malformed address and a wrong checksum |

### qualify-node.ts

[../docs/node-qualification.md](../docs/node-qualification.md) is the reference. This section is
a summary.

```sh
bun run scripts/qualify-node.ts --image <ref>
bun run scripts/qualify-node.ts --image <ref> --from-image <deployed-ref>
bun run scripts/qualify-node.ts --image <ref> --from-image <deployed-ref> --record-baseline
bun run scripts/qualify-node.ts --url https://hb-stage.anyone.tech --env stage
bun run scripts/qualify-node.ts --list
```

| Option | Default | Meaning |
| --- | --- | --- |
| `--image <ref>` | None | Image to qualify. Started locally as a container |
| `--url <url>` | None | Node that is already running. Fewer phases apply |
| `--env <name>` | None | With `--url`: `dev`, `stage` or `live`. Required by the `policy` phase |
| `--allow-remote-writes` | Off | With a `--url` that is not loopback: also run the phases that spawn and write |
| `--from-image <ref>` | None | The image that is deployed now. Enables the `trie-crossing` phase |
| `--baseline <file>` | `spec/fixtures/node-baseline.json` | Baseline to compare against or to write |
| `--record-baseline` | Off | Write the baseline |
| `--record-partial` | Off | With `--record-baseline`: record although phases were deselected |
| `--only a,b`, `--skip a,b` | All phases | Select phases by id |
| `--list` | Off | Print the phase table and exit |
| `--quick` | Off | Smaller samples. Cannot record a baseline |
| `--keep` | Off | Leave the container running |
| `--stream` | Off | Copy the output of every subprocess to the console |
| `--port <n>` | `8735` | Host port of the container |
| `--container <name>` | `hb-qualify` | Name of the container |

| Phase | Modes | Writes | Runs |
| --- | --- | --- | --- |
| `toolchain` | image | No | Reads versions and the patch fingerprint from the image |
| `tier2` | image, url | No | `spec/run-tier2.sh` |
| `identity` | image, url | No | Device and root path checks |
| `fingerprint` | image, url | No | The opt and device surface of the build |
| `config` | image | No | A second container with a production-shaped configuration |
| `modules` | image | No | Builds the native modules and publishes them into the container |
| `smoke` | image, url | Yes | Spawn, compute, read, write, revert |
| `trie-crossing` | image | No | `probe/opreg-wedge-repro.ts --expect-healthy` |
| `verticals` | image, url | Yes | `run-e2e.ts --keep-artifacts` |
| `golden` | image, url | Yes | `staking-view-golden.ts --check` |
| `economics` | image, url | Yes | `probe/gc-cost-curve.ts` and `probe/trie-scale.ts` |
| `restore` | image | No | `probe/gc-restore-fidelity.ts` |
| `policy` | url | No | `verify-access-policy.ts <env>`, then again with `PERTURB=1` |

The Writes column marks the phases that are skipped against a remote node unless
`--allow-remote-writes` is passed.

Rules:

- One of `--image` and `--url` is required. They exclude each other.
- The subject is an image, not a deployment. Reference the image by digest.
- Pass `--from-image` for every upgrade. `trie-crossing` is the only phase that tests whether
  the candidate can continue processes that the deployed image wrote.
- Against a remote node the phases that write are skipped. `--allow-remote-writes` creates
  processes on that node permanently.
- Absolute latency never fails a run. Ratios, counts and identity do.
- A baseline is recorded from a full run only. A failed or skipped phase blocks recording.
- The golden depends on the signer, because the `status` view reports the owner. Use the key
  that the golden was recorded with.
- Run `toolchain` and `tier2` together. `toolchain` asserts that the luerl version of the image
  equals the version that Tier 2 runs.
- `dist/qualify-logs/` is cleared at the start of a run. Every phase writes its output there.

### verify-access-policy.ts

Checks two layers independently:

| Layer | Source of the check |
| --- | --- |
| Node | The `on/request` hooks, the allow-list, the free routes and the rate limit options, read back from `/~meta@1.0/info` |
| Edge | The nginx whitelist, probed over the public host |

```sh
bun run scripts/verify-access-policy.ts dev stage live
bun run scripts/verify-access-policy.ts dev --dos
PERTURB=1 bun run scripts/verify-access-policy.ts stage
```

| Option or variable | Default | Meaning |
| --- | --- | --- |
| `<env> ...` | Every entry of the table in the script, `local` included | Environments to check: `dev`, `stage`, `live`, `local` |
| `--dos` | Off | Also test the body size cap and the rate limit. Generates load. Runs on `dev` only |
| `--dos-force` | Off | With `--dos`: also run on `stage` and `live` |
| `PERTURB=1` | Off | Self-test. Corrupts the expectations and expects the checks to fail. Prints `PERTURB OK` and exits 0 when they do |
| `LOCAL_HOST` | `localhost:8734` | Host of the `local` environment |
| `LOCAL_GATED` | `true` | Whether the `local` node runs the write gate |
| `LOCAL_ALLOW_LIST` | Empty | Comma-separated allow-list that is expected on the `local` node |

What is checked:

| Area | Checks |
| --- | --- |
| Identity | The node reports an address. Several nodes have distinct addresses |
| Hooks | `on/request` has 6 hooks. The last one is `p4@1.0` |
| Gate | On a gated node: the pricing device is `lua@5.3a`, the ledger device is `faff@1.0`, the gate is referenced by module id, `gated-processes` holds 3 ids, `operator-registry` is one of them, and every gated process is computable on this node. On a node without the gate, both devices are `faff@1.0` |
| Deploy wallets | Every entry is an EVM address. The address of the node itself is absent |
| Allow-list | Non-empty, well formed, no duplicates, equal to the expected set |
| Free routes | 7 entries, plus the bundler entry on a node that bundles for itself. On a gated node the contract routes are narrowed to the read verbs `now`, `compute`, `slot` and `as` |
| Root | `/` answers 307 |
| Rate limit options | `rate-limit-requests`, `rate-limit-max` and `rate-limit-period` read back with the expected values |
| Edge | `/~meta@1.0`, `/~hyperbuddy@1.0`, `/push` and the contract ids are admitted. On a locked edge a foreign process id and an unrouted path answer 403 |
| Reads | On a gated node, unsigned reads of the contracts stay free for every read verb |
| Spawn | A signer that is on no list cannot spawn. An unsigned request cannot create a process |
| Contract writes | On a gated node, a signer that is on no list is refused for the contract ids. On a node without the gate, that signer passes the allow-list for the contract ids. A foreign process id is refused on both |
| Bundler | A signer that is on no list cannot get an item accepted by `~bundler@1.0`. An unsigned item is refused |
| Bundler pairing | The bundler route is free only on a node whose bundler target is loopback and whose edge refuses `~bundler@1.0` |
| Load, with `--dos` | A body of 11 MB answers 413. Requests above the rate limit answer 429 while others are served. Service recovers after a short idle |

Rules:

- Name the environments. Without a name the run includes `local`.
- The expected policy is declared in the `ENVS` table of the script and is independent of the
  job specs. Change the table in the same change that changes a job spec.
- Whether a node is gated is declared in the table, not detected.
- The exit code is 0 only when no check failed and none was skipped.
- The spawn probe signs an item without process tags with a key generated for the run. The item
  cannot create a process, so the probe is safe against `live`.
- `--dos` trips the rate limiter for the source address for a few seconds. The rate limit check
  draws a conclusion only when the probe exceeded 30 requests per second.
- A `local` node has no edge. Its edge checks are skipped.
- Run `PERTURB=1` after every change to the script. A check that still passes under corrupted
  expectations has stopped checking.

Facts about the node configuration that the checks rely on:

| Fact | Consequence |
| --- | --- |
| Option keys are lowercase with hyphens | A key spelled with underscores is not an error. It is not found, so the option keeps its default. An allow-list spelled that way is empty |
| `priv_key_location` in `config.json` is stripped as private data | The node creates a new identity at every start. Keep the key location in `config.flat` |
| A list option renders scalar entries inline and message entries as `<n>+link` | Fetch a message entry by its index. Indexes are 1-based over HTTP |
| A scalar option exists only as a key of the info message | `/~meta@1.0/info/<key>` answers 500 for a scalar |
| The JSON rendering overwrites the `device` key of a hook | Identify the `p4` hook by its `pricing-device` key |
| `dev_faff` admits a request without signers | An unsigned request passes the allow-list. It still cannot create a process |
| The node signs its own uploads on the nested item, not on the envelope | The gate sees the upload as unsigned. A wallet list cannot admit it |

### verify-migration.ts

```sh
HB_URL=<url> PID=<pid> bun run scripts/verify-migration.ts <contract> --seed <live|stage> [--skip-replay]
```

| Step | Check |
| --- | --- |
| 1. Manifest | The dump files hash to the SHA-256 values in the manifest of the dump |
| 2. Transform | A rebuild of the seed is byte-identical to the previous build |
| 3. State | The `dump` view of the process equals the expected state, key by key |
| 4. Roles | The `roles` view equals the expected roles |
| 5. Tail | Every message in the recorded message tail predates the dump. The only failures are `Claim-Rewards` without rewards. A reward contract ended on a completed round |
| 6. Fail closed | Each failed claim of the tail is sent to the process again and must fail with the same reason |

Rules:

- Run it against a freshly spawned process. A process that has been written to since its seed
  differs from the dump.
- The seed is rebuilt with the default options of the builder. A relay rewards process that was
  seeded with another `--previous-round` value differs in `PreviousRound.Timestamp`.
- Step 6 sends messages. They fail, so the state does not change, and each one takes a slot.
  `--skip-replay` makes the run read-only.
- Without `DEPLOYER_PRIVATE_KEY` step 6 is skipped.
- Compare state by structure, never by JSON string. The node encodes from Lua tables, and the
  key order is not stable.

### verify-deployment.ts

```sh
CONTRACT=<contract> PID=<pid> HB_URL=<url> \
  bun run scripts/verify-deployment.ts [--behavioral] [--report <path>]
```

| Option or variable | Default | Meaning |
| --- | --- | --- |
| `--behavioral` | Off | Run the Tier 3 validator of the contract against a twin spawned from the same module id |
| `--report <path>` | `verify-<contract>-report.md` in `REPORTS_DIR` | Where the report is written |
| `SEED_NET` | `live` | The dump that the state is compared with: `live` or `stage` |
| `EXPECTED_MODULE_ID` | None | Fail when the process runs another module |

| Section | Checks |
| --- | --- |
| A | The process computes. The runtime reports the expected contract. The process is initialized. The module id |
| B | The state equals the transform of the dump. The seed is rebuilt for `SEED_NET` first |
| C | Every view that a consumer calls answers, is not empty, and answers within 2 seconds |
| D | Role holders exist and are on the allow-list. An unknown address is not |
| E | The deliberate deviations from the legacy contracts, listed for the reader |
| F | With `--behavioral`: writes, role checks and revert on the twin |

Rules:

- The script never sends a message to the deployed process.
- The exit code is 0 only when no finding is `CRITICAL` or `HIGH`.
- For `relay-rewards` the script always records one `HIGH` finding about the read path of the
  dashboard. The exit code for that contract is therefore 1.
- Section B holds for a process that has not been written to since its seed.
- Section B rebuilds the seed files of the contract in `dist/`.

### staking-view-golden.ts

```sh
MODULE_ID=<id> HB_URL=<url> bun run scripts/staking-view-golden.ts             # record
MODULE_ID=<id> HB_URL=<url> bun run scripts/staking-view-golden.ts --check     # compare
MODULE_ID=<id> HB_URL=<url> bun run scripts/staking-view-golden.ts --resample  # record with a new sample
```

The script spawns staking rewards from the seed, captures every view for a sample of addresses,
drives one round, and captures the views again. It makes two checks:

| Check | Compares | Detects |
| --- | --- | --- |
| Seed | Every view with the seed | A view that disagrees with the migrated state |
| Golden | Every view with its recording in `spec/fixtures/staking-view-golden.json` | A change that a consumer can see: a number format, null in place of absent, a count that counts pairs where it counted hodlers. Key order is ignored |

Rules:

- Needs `dist/staking-rewards-seed.envelope.json`. Build it with `build-staking-seed.ts`.
- `--check` is the authoritative comparison. A diff of two golden files is not.
- The sample of addresses is taken from the existing golden, in both modes. A new recording
  stays comparable with the one it replaces.
- `--resample` selects a new sample. The result cannot be compared with any earlier capture.
- The golden depends on the signer, because `status` reports the owner. Check and record with
  the same key.
- One difference is accepted by name: `status.counts.rewardedHodlers` is 2 lower than in the
  golden, because a pair-keyed map cannot hold a hodler without pairs. Every other difference
  fails.
- The module id and the round timestamp in the `meta` section differ per run and are not
  compared.

## Test tiers

[../spec/README.md](../spec/README.md) describes the tiers. Tier 1 runs with busted and has no
script here.

| Script | Tier | Purpose | Arguments | Environment |
| --- | --- | --- | --- | --- |
| `run-e2e.ts` | 3 | Runs the end-to-end suite against a node. See [run-e2e.ts](#run-e2ets) | Options | `HB_URL` (required), `E2E_PRIVATE_KEY`, `CONTAINER_ENGINE`, `MODULE_ID_*`, `SUSTAINED_ROUNDS` (`10`) |
| `tier2-relay-datasets.ts` | 2 | Runs three captured score datasets at token scale through native relay rewards under luerl. Every `Complete-Round` must return a snapshot with details | None | `CONTAINER_ENGINE`, `LUERL_IMAGE` |
| `tier2-relay-legacy-crosscheck.ts` | 2 | Runs one round through the legacy relay rewards contract and the native one under luerl and compares details, summary and cumulative rewards. Needs the relay seed | None | `K` (`300`): fingerprints. `PERTURB`. `CONTAINER_ENGINE`, `LUERL_IMAGE` |
| `tier2-staking-legacy-crosscheck.ts` | 2 | The same for staking rewards, in three runs: the dump configuration, operator shares, and the share change delay. Reads the state dump | None | `K` (`300`): pairs. `PERTURB`. `CONTAINER_ENGINE`, `LUERL_IMAGE` |
| `bint-luerl-conformance.ts` | 3 | Evaluates integer arithmetic at token scale on the device VM and compares with BigInt results | None | `HB_URL` (`http://localhost:8734`), `MODULE_FILE`, `VERBOSE`, `DEPLOYER_PRIVATE_KEY` |
| `tier3-validate.ts` | 3 | Drives the operator registry through its whole surface with two signers | None | `MODULE_ID` (required), `HB_URL` (`http://localhost:8734`), `DEPLOYER_PRIVATE_KEY` |
| `tier3-seed-validate.ts` | 3 | Spawns the operator registry from its seed and checks counts, state, roles, address lookup and a write after the seed | None | Same |
| `tier3-relay-validate.ts` | 3 | Spawns relay rewards from its seed, drives the oracle round and compares every reward with the luerl oracle. Checks the settle slot pointer and `last_snapshot` | None | Same |
| `tier3-staking-validate.ts` | 3 | Spawns staking rewards from its seed, checks the read surface, drives the oracle round and compares with the luerl oracle | None | Same, and `N` (`250`), `PERTURB` |
| `tier3-sustained.ts` | 3 | Many rounds, claims, the remaining actions, a refused write and a node restart. See [tier3-sustained.ts](#tier3-sustainedts) | `<relay\|staking>` | `MODULE_ID` (required), `HB_URL`, `CONTAINER`, `CONTAINER_ENGINE`, `ROUNDS` (`10`), `WIDTH` (`300` relay, `250` staking), `BATCH` (`100`), `RESTART_AFTER` (half of `ROUNDS`), `DEPLOYER_PRIVATE_KEY` |

Notes:

- `PERTURB` is a negative control. The cross-checks then give the native side a configuration
  that differs by one unit of `TokensPerSecond`, and `tier3-staking-validate.ts` shifts one
  reward by one unit. The run must report mismatches. `tier3-staking-validate.ts` exits 0 under
  `PERTURB` when it found failures.
- The cross-checks compare parsed objects. Keys are lowercased before the comparison, because
  the legacy contracts store addresses as `0x` plus uppercase hex and the native ones as EIP-55.
- The cross-checks assert that every branch fired: hardware, exit bonus, every uptime tier, the
  delegate split, share values of 0 and 1. Agreement between two sides proves nothing about a
  branch that did not run.
- Run C of the staking cross-check asserts the one intended difference in behavior. The legacy
  contract adds a delay in seconds to a timestamp in milliseconds. The native contract converts
  the delay to milliseconds.
- The cross-checks use small round timestamps. The legacy contracts key a table by the round
  timestamp, and luerl treats a large integer key as an array index.
- `MODULE_FILE` of `bint-luerl-conformance.ts` defaults to an absolute path on one workstation.
  Set it to `vendor/hyper-aos.lua`.
- luerl integers have arbitrary precision. `tonumber` of a decimal string returns a float, so
  amounts are parsed digit by digit. The `bint` library is not used under luerl: its width
  detection does not terminate there.

### run-e2e.ts

```sh
HB_URL=http://localhost:8734 bun run scripts/run-e2e.ts --publish-container hb-e2e
HB_URL=<url> MODULE_ID_RELAY=<id> bun run scripts/run-e2e.ts --only relay
bun run scripts/run-e2e.ts --print-publish-commands
```

| Option | Meaning |
| --- | --- |
| `--publish-container <name>` | Register the modules inside that local container |
| `--print-publish-commands` | Print the commands that register the modules on a node, and exit. Needs no node |
| `--only <keys>` | Run a subset of `surface`, `opreg`, `relay`, `staking`, `sustained-relay`, `sustained-staking` |
| `--sustained` | Add the two runs of `tier3-sustained.ts` |
| `--keep-artifacts` | Build only the artifacts that are missing from `dist/` |

| Variable | Default | Meaning |
| --- | --- | --- |
| `HB_URL` | None. Required | Node under test |
| `E2E_PRIVATE_KEY` | The committed development key | Key that signs. Its address must be admitted by the node |
| `MODULE_ID_NATIVE`, `MODULE_ID_OPREG`, `MODULE_ID_RELAY`, `MODULE_ID_STAKING` | None | Ids of modules that are already registered on the node |
| `SUSTAINED_ROUNDS` | `10` | Rounds per sustained run |
| `CONTAINER_ENGINE` | `podman` | Engine for the luerl oracle and for `--publish-container` |

| Stage | Content |
| --- | --- |
| 0. Preflight | The node answers. The signer is admitted, tested with a small spawn |
| 1. Artifacts | Native bundles, seeds and oracles |
| 2. Modules | One registration per distinct file. `surface` and `opreg` share the operator registry module |
| 3. Verticals | `tier3-validate.ts`, `tier3-seed-validate.ts`, `tier3-relay-validate.ts`, `tier3-staking-validate.ts`, and the sustained runs |
| 4. Migration | `verify-migration.ts` for each seeded contract, on a freshly spawned process |
| 5. Summary | Counts of passed, failed, errored and skipped stages |

Rules:

- Every vertical spawns by module id. A module must be registered on the node first. An inline
  spawn does not make its module resolvable by id.
- For a node without a local container, run the printed commands on the node and pass the ids
  in `MODULE_ID_*`.
- The modules are pure source. The seed travels with each spawn.
- `FAIL` means that a vertical failed its checks. `ERROR` means that the harness failed.
- A skipped stage is not evidence. The summary lists every skip.
- With `--only`, select `relay` together with `sustained-relay`, and `staking` together with
  `sustained-staking`. Modules and artifacts are selected by `relay` and `staking`.
- Stage 4 uses fresh processes. The verticals write to their processes, and a process that was
  written to differs from the dump.
- `dist/e2e-logs/` holds the full output of failed stages only, and the directory is not
  cleared. A file there can be from an earlier run.
- The suite needs the Tier 2 image for the oracle rounds.

### tier3-sustained.ts

```sh
HB_URL=<url> MODULE_ID=<id> CONTAINER=<name> bun run scripts/tier3-sustained.ts relay
HB_URL=<url> MODULE_ID=<id> CONTAINER=<name> bun run scripts/tier3-sustained.ts staking
```

| Section | Content |
| --- | --- |
| A | Spawn from the seed |
| B | `ROUNDS` rounds of batched `Add-Scores` and `Complete-Round`, timed |
| C | The tracked balances increase strictly in every round |
| D | `Claim-Rewards`: claim, earn more, check that the claimed amount did not move, claim again |
| E | `Cancel-Round`, `Update-Configuration`, `Set-Delegate` for relay rewards, the share actions for staking rewards |
| F | A write from a signer without a role is rejected and changes nothing |
| G | Restart the node. The `dump` view must be byte-identical afterwards. Then continue |

Rules:

- Without `CONTAINER`, section G and the disk measurements are skipped.
- A write that the contract rejects still takes a slot.
- A balance that is absent reads as 0. A balance that cannot be read is an error.
- The per-round timing and the disk use show whether per-message cost grows with the number of
  slots. Compare the columns between two images.

### Tier 3 investigations

Each script asks one question on fresh processes. All read `MODULE_ID`, `HB_URL`
(`http://localhost:8734`) and `DEPLOYER_PRIVATE_KEY`, unless the table says otherwise.

| Script | Question | Arguments and extra environment |
| --- | --- | --- |
| `tier3-deploy.ts` | Spawns the native operator registry from inline source, fills it with sample data and prints URLs to read | No `MODULE_ID`. `DEPLOYER_PRIVATE_KEY` is required |
| `tier3-opreg.ts` | What do the read paths of the native operator registry return: status, content type and body | No `MODULE_ID` |
| `tier3-msgshape.ts` | How does the device present action, tags and data of a message to `compute` | No `MODULE_ID` |
| `tier3-byid-test.ts` | Does a process spawned by module id keep computing over 8 messages | None |
| `tier3-keccak-eval.ts` | Does the vendored keccak and EIP-55 code in `util/eip55-lib.lua` give the same result on the device VM as `ethers.getAddress` | None |
| `tier3-a16-mechanism.ts` | Which changes to a string-valued map persist across slots: an update of a value, a new key alone, both in one slot | None |
| `tier3-adjacency-probe.ts` | Which sequence of writes loses a key: adds in consecutive slots, adds interleaved with writes to another map, a batch in one message | None |
| `tier3-persist-probe.ts` | Does a slot that ends in an error lose later writes, or does it delay reads | None |
| `tier3-readd-repro.ts` | Does a write persist directly after a reverted write, and does a key persist that is added again after it was deleted | None |
| `tier3-unblock-repro.ts` | How does state change step by step through block and unblock | None |
| `tier3-scale-probe.ts` | How do write latency, state size and read latency develop while a map grows across slots | `TARGET` (`8000`), `BATCH` (`200`), `MODE` (`claimable` or `hardware`) |
| `tier3-mixed-write-probe.ts` | Does a write to a small map cost as much as a write to a large one when a large map is present | `N` (`6000`), `BATCH` (`300`), `LOAD` (`claimable` or `hardware`) |
| `tier3-relay-durability.ts` | What is the largest `Add-Scores` message that the node accepts and computes on a seeded relay rewards process | `SIZES` (`420,1000,2000,4000,9750`) |
| `tier3-relay-realistic.ts` | Does a round over seeded fingerprints equal a luerl oracle, and do the cumulative totals equal seed plus round reward | `K` (`300`) |

Notes:

- Several of these scripts read base-addressed paths such as `now/state/<key>`. The native
  contracts keep their state in a Lua global, so those paths do not resolve against them. Read
  through `as/<view>`. See [../docs/runtime.md](../docs/runtime.md#views).
- State on the process message loses a key that is added to a string-valued map after the first
  slot. See [../docs/runtime.md](../docs/runtime.md#state).
- The device delivers the tags of a message as lowercase keys of `message.body`.

## Snapshots and recovery

[../docs/durability-and-recovery.md](../docs/durability-and-recovery.md) is the reference. It
describes the snapshot format, the periodic job, the outcomes and the failure messages.

| Script | Purpose | Arguments | Environment |
| --- | --- | --- | --- |
| `snapshot-state.ts` | Captures a consistent snapshot of each contract, with the id of the assignment at its slot | `<env> [--out <dir>] [--contract <name>]` | `SNAPSHOT_HOST`, `ARWEAVE_GATEWAY` (`https://arweave.net`), `LOCAL_HOST` (`localhost:8734`) |
| `publish-snapshot.ts` | Publishes snapshots through the `~bundler@1.0` device of the node. A dry run by default | `<snapshotDir> [--confirm] [--wait <s>] [--anchor-wait <s>] [--allow-unanchored] [--force]` | `PUBLISH_JWK`, `BUNDLER` (`http://$SNAPSHOT_HOST`), `GATEWAY` (`https://arweave.net`) |
| `verify-snapshot.ts` | Verifies payload, anchor, chain continuity and message retrieval of a snapshot | `<snapshotDir>`, or `--published <tx-id>`, or `--chain <process-id> [fromSlot]` | `ARWEAVE_GATEWAY` (`https://arweave.net`), `PERTURB` |
| `recover-from-arweave.ts` | Rebuilds state and ordered message history of a process from Arweave | `<process-id> [--out <dir>] [--seed] [--max <n>] [--snapshot <dir>]` | `ARWEAVE_GATEWAY` (`https://arweave.net`) |

`publish-snapshot.ts` reads `GATEWAY`. The other three read `ARWEAVE_GATEWAY`.

### snapshot-state.ts

| Option | Default | Meaning |
| --- | --- | --- |
| `<env>` | Required | `dev`, `stage`, `live` or `local`. Becomes the `env` tag |
| `--out <dir>` | `snapshots/<env>` | Output directory |
| `--contract <name>` | All | Capture one contract only |

Rules:

- The contract ids are read from the `p4-non-chargable-routes` of the node. A contract is
  identified by the shape of its state.
- A view read cannot be pinned to a slot. `compute&slot=<n>/as/dump` evaluates the view against
  the result message of that slot and returns an empty state. `as/dump?slot=<n>` ignores the
  parameter. Neither form reports an error.
- Consistency comes from bracketing: read `slot/current`, read the dump, read `slot/current`
  again, and require the same slot. The capture retries up to 4 times.
- Do not request JSON for a scalar. With `accept: application/json` the node wraps a scalar in
  a commitment envelope.
- `SNAPSHOT_HOST` changes the host that is read. It does not change the `env` tag.
- A host that is `localhost` or an IPv4 literal is read over HTTP. Any other host is read over
  HTTPS.
- A snapshot without an assignment on Arweave is written and marked as unanchored.

### publish-snapshot.ts

| Option | Default | Meaning |
| --- | --- | --- |
| `--confirm` | Off | Post the snapshots |
| `--wait <seconds>` | `900` | Wait for settlement of the posted items |
| `--anchor-wait <seconds>` | `900` | Wait for a missing anchor. `0` does not wait |
| `--allow-unanchored` | Off | Publish a snapshot without an anchor |
| `--force` | Off | Skip the duplicate check |

Rules:

- Pass the snapshot directory as the first argument.
- Run it from the periodic job inside the cluster, not from a workstation.
- Posting spends AR of the node. The signing key in `PUBLISH_JWK` signs the item and pays
  nothing.
- `BUNDLER` must be an address inside the cluster. The edge refuses the bundler route.
- A snapshot that is still unanchored after the wait is skipped. The other snapshots are
  published. The next run publishes the skipped one.
- The duplicate check is by process and slot. A process that did not advance is not published
  again.
- A published snapshot with the same process and slot and another state digest is a conflict.
  The run exits 1. Investigate before using `--force`.
- The bundler accepting an item is not settlement. A run that ends with items pending is
  normal. Confirm later with `verify-snapshot.ts --published <id>`.
- A run in which every snapshot was skipped as unanchored exits 1.

### recover-from-arweave.ts and verify-snapshot.ts

| Option of `recover-from-arweave.ts` | Default | Meaning |
| --- | --- | --- |
| `--out <dir>` | `recovery/<process-id>` | Output directory |
| `--seed` | Off | Also write `seed.json` |
| `--max <n>` | `100000` | Most slots to walk from the snapshot |
| `--snapshot <dir>` | None | Use a local snapshot directory |

Rules:

- The recovery verifies the state digest and the anchor before it uses the snapshot.
- A gap or a broken link in the assignment chain makes the run exit 1. The history is then not
  provably whole.
- The output is a verified state and the ordered messages after it. It is not a process that a
  node can serve. The scheduler of a node resolves assignments from its local index only.
- To bring a contract back, spawn by module id with the recovered state as the seed, then send
  the messages in slot order. The process has a new id.
- `verify-snapshot.ts` reports a check that had nothing to check as `warn`, never as a pass. A
  snapshot at the head slot has no chain after it.
- `PERTURB=1 verify-snapshot.ts` exits 0 when the corrupted expectations were detected.

## Development fixtures

| Script | Purpose | Arguments | Environment |
| --- | --- | --- | --- |
| `dev-dashboard-fixture.ts` | Spawns the three contracts on a local node and fills them with data for one operator address, for testing the dashboard | `<operator address>` | `HB_URL` (`http://localhost:8734`), `DEPLOYER_PRIVATE_KEY` (required) |
| `dev-staking-mirror.ts` | Copies the last staking round of a source node to a local staking process and adds relay counts per operator | None | `HB_URL` (`http://localhost:8734`), `SOURCE_HB` (`https://hb-stage.anyone.tech`), `SOURCE_PID` (a process id in the script), `DEPLOYER_PRIVATE_KEY` (required) |
| `dev-walkthrough.ts` | Operates the contracts end to end on a node: registration, removal, reward rounds, claims, permissions. Writes a report | None | `HB_URL` (`https://hb-dev.anyone.tech`), `MODULE_ID_OPREG`, `MODULE_ID_RELAY`, `MODULE_ID_STAKING`, `WIDTH` (`60`), `REPORT`, `REPORTS_DIR`, `DEPLOYER_PRIVATE_KEY` (required) |

Rules for `dev-dashboard-fixture.ts`:

- Needs `dist/<contract>-native.lua` for the three contracts.
- Use a local node. A node with an allow-list refuses writes from a browser wallet that is not
  on the list. A local node without an allow-list accepts any wallet.
- The script prints the environment variables for the development server of the dashboard.
- Certificates that an admin submits are claimable. A relay becomes verified when the operator
  submits the certificate, which is the write that the dashboard makes.
- The first round on a fresh process pays nothing, because the previous timestamp is 0. The
  fixture settles two rounds so that the second has a period of 900 seconds.
- The relay counts in the fixture disagree with the `Running` score on purpose. A page that
  derives the ratio from the wrong field shows a visibly different value.

Rules for `dev-staking-mirror.ts`:

- Needs `dist/staking-rewards-native.lua`.
- The dashboard reads stakes from the EVM contract and rounds from the node. The mirror gives a
  local process the operators that the EVM contract knows, so the two sources agree.
- The script takes no command line options. Set the source with `SOURCE_HB` and `SOURCE_PID`.
- `Running` in a round is the ratio of running to expected relays. The script recovers a pair
  of counts with that ratio.

Rules for `dev-walkthrough.ts`:

| Mode | Selected by | Spawns | Says something about |
| --- | --- | --- | --- |
| Seeded | `MODULE_ID_*` set | By module id, with the seed | The migrated contracts |
| Fresh | `MODULE_ID_*` unset | From inline source, without a seed | The contracts when empty |

- The two modes cannot be combined. `spawnLuaProcess` refuses a seed together with inline
  source.
- The script spawns its own processes and never writes to a deployed one.
- The report names the mode.
- A refusal by the node never reaches the contract. The report states which layer refused.

## Smoke tests

| Script | Purpose | Arguments | Environment |
| --- | --- | --- | --- |
| `lua-smoke.ts` | Spawns a minimal Lua process with the native client, sends one message and reads `now/count` | None | `HB_URL` (`http://localhost:8734`), `DEPLOYER_PRIVATE_KEY` |
| `spawn-lua.ts` | The same through `aoconnect`, with every node response printed | None | `HB_URL` (`http://localhost:18741`), `DEPLOYER_PRIVATE_KEY` (required) |
| `hyper-aos-smoke.ts` | Spawns a hyper-aos process, evaluates Lua as the owner and reads the result | None | `HB_URL` (`http://localhost:8734`), `SIGNER` (`arweave` or `ethereum`, default `arweave`), `MODULE_FILE`, `MODULE_ID`, `AR_KEYFILE`, `DEPLOYER_PRIVATE_KEY` |
| `faff-probe.ts` | Sends a spawn signed by an allow-listed wallet and one signed by a random wallet, and prints the raw answers of the node | None | `HB_URL` (`https://hb-dev.anyone.tech`), `MODULE`, `DEPLOYER_PRIVATE_KEY` (required) |
| `interact-probe.ts` | Spawns a process, evaluates a handler, sends a message and reads the result through `aoconnect` | None | `HB_URL` (`https://hb-dev.anyone.tech`), `MODULE`, `DEPLOYER_PRIVATE_KEY` (required) |

Notes:

- `MODULE_FILE` and `AR_KEYFILE` of `hyper-aos-smoke.ts` default to absolute paths on one
  workstation. Set both.
- Stock hyper-aos recognizes `rsa-pss-sha512` committers only. With `SIGNER=ethereum` the owner
  is not trusted.
- `aoconnect` hides the response of the node. `faff-probe.ts`, `interact-probe.ts` and
  `spawn-lua.ts` wrap `fetch` to print it.
- `MODULE` defaults to a module id in the script.

## State capture from the legacy network

| Script | Purpose | Arguments | Environment |
| --- | --- | --- | --- |
| `dump-full-state.ts` | Dumps the whole state and the roles of the legacy processes of `live` and `stage` through dry runs against the compute units, and writes a manifest with SHA-256 digests | `[outputDir]` (`state-dumps/<day of the run>`) | None |
| `dump-message-tail.ts` | Saves the last 300 messages of each legacy process from the scheduler log, prints an action timeline and checks the results of the last messages | `[outputDir]` (`state-dumps/<day of the run>`) | None |

Run both with `npx tsx scripts/<name>.ts`.

Notes:

- The `View-State` handlers of the legacy contracts omit parts of the state. The dump evaluates
  `require('json').encode(<StateGlobal>)` in a dry run instead.
- A dry run is unsigned and persists nothing, so it works against a network that is read-only.
- The owner of a legacy process that was spawned with an EVM signature is the checksummed EVM
  address of the deployer key. The script derives it from the public key of the spawn
  transaction.
- The dry runs are posted to the compute unit directly. `aoconnect` removes the `From` field.
- The tail check reports whether the last `Add-Scores` was followed by a `Complete-Round`.

## Utilities

Modules in `scripts/util/`. They are imported, not run.

| Module | Exports | Purpose |
| --- | --- | --- |
| `hb-client.ts` | `spawnLuaProcess`, `sendMessage`, `readState`, `forceFirstCompute`, `fetchNodeAddress`, `moduleIdFor` | Client for a HyperBEAM node. Builds ANS-104 items, signs them with an EVM key and posts them |
| `native-bundle.ts` | `buildBundle`, `buildSeedEnvelope`, `buildSeedBundle`, `seedEnvelopeFor` | The one definition of the native module bundle and of the seed formats |
| `helpers.ts` | `requireDeployerKey`, `reportPath`, `resolveAuthority`, `resolveImportAuthority`, `createEthSigner`, `createEthereumDataItemSigner`, `loadWallet` | Key lookup, report paths, and signers for `aoconnect` |
| `luerl.ts` | `luerl`, `ENGINE`, `IMAGE`, `MOUNT` | Runs the Tier 2 luerl image with `ao/` mounted at `/work` |
| `relay-round.ts` | `buildRelayRound`, `TRACKED_COUNT` | Builds relay rounds of realistic width from the seed |
| `staking-round.ts` | `buildRound` | The one definition of the staking round that the oracle and the node both run |
| `logger.ts` | `logger` | JSON logger with the Nomad fields of the job |
| `eip55-lib.lua` | Lua source | Vendored keccak-256 and EIP-55 checksum that runs under luerl |

| Variable | Read by | Default |
| --- | --- | --- |
| `DEPLOYER_PRIVATE_KEY` | `helpers.ts` | None. `requireDeployerKey` exits 2 without it |
| `REPORTS_DIR` | `helpers.ts` | A directory beside the repository checkout |
| `AUTHORITY` | `helpers.ts` | The import authority of the node, then the address of the node |
| `CONTAINER_ENGINE` | `luerl.ts` | `podman` |
| `LUERL_IMAGE` | `luerl.ts` | `anyone-luerl:1.3.0` |
| `NOMAD_ALLOC_ID`, `NOMAD_JOB_NAME`, `NOMAD_JOB_ID`, `NOMAD_TASK_NAME`, `NOMAD_DC` | `logger.ts` | None |

### hb-client.ts

| Function | Behavior |
| --- | --- |
| `spawnLuaProcess(config, opts)` | Spawns a process on the `lua@5.3a` device. Takes exactly one of `luaSource` and `moduleId`. Returns the process id and the slot |
| `forceFirstCompute(config, pid)` | Reads `now/at-slot` until it answers. 30 attempts, 500 ms apart, by default |
| `sendMessage(config, opts)` | Posts a message to `/<pid>~process@1.0/push`. Returns id, slot and response body |
| `readState(config, pid, key)` | Reads `now/<key>`. Computes to the latest slot first |
| `moduleIdFor(luaSource)` | Id of the module child that an inline spawn embeds. For inspection only |
| `fetchNodeAddress(url)` | The operator address of the node |

Rules of the wire format:

| Rule | Reason |
| --- | --- |
| The body is a signed ANS-104 item, with `Content-Type: application/ans104` and `codec-device: ans104@1.0` | The headers select the codec |
| Tag names are unique and lowercase | A stored message with other tag names can fail signature verification on a later read |
| A spawn carries a unique tag, for example `name` | The process id is the id of the signed item. EVM signing is deterministic, so identical spawn content from one wallet gives the same process id and an existing process |
| `variant` is `ao.N.1` | `ao.TN.1` selects the `genesis-wasm@1.0` execution device |
| Inline source is encoded as a nested `module` map in the bundle format of the node, with the bundle tags first | The node encodes the tags in that order when it verifies the signature again |
| `spawnData` is refused together with `luaSource` | The inline module occupies the data field, so the seed would be discarded |
| The scheduler location is an address of the node | With another address the node redirects to a remote scheduler |

Rules of the first compute:

- A spawn only schedules slot 0. The node computes lazily.
- A process that has never computed answers most reads with 200 and no state.
- `as/<view>` does not compute slot 0. `now/` does.
- `spawnLuaProcess` forces the first compute unless `verify` is `false`.
- A forced compute proves that the process computes. It does not prove that a seed landed. For
  that, read `initialized` in the `status` view.

### native-bundle.ts

| Function | Output | Use |
| --- | --- | --- |
| `buildBundle(contract)` | The module: json, the common libraries, the runtime and the contract | Publishing and inline spawns |
| `buildSeedEnvelope(state, roles)` | The seed as spawn data | Every spawn that migrates state |
| `buildSeedBundle(state, roles, contract)` | The contract with the seed embedded | luerl fixtures, which load a file and have no spawn message |
| `seedEnvelopeFor(contract)` | The built envelope from `dist/`, or `undefined` | Spawn sites |

Rules:

- Every tool builds the module with `buildBundle`. A second preload list would drift from the
  contract. A missing preload does not fail at load time of the spawn: the spawn returns a
  process id, and every read and write of the process fails afterwards.
- Never spawn from a seed bundle. A module is loaded into a fresh VM for every read, so an
  embedded seed is decoded on every read.
- `seedEnvelopeFor` returns `undefined` when no seed was built. A spawn without a seed is a
  valid fresh deploy, so check for a missing seed where a seed is expected.

## Legacy scripts

Tools in `scripts/legacy/` for the legacy contracts on the older network stack. They use
`aoconnect` and send `aos` messages. The native contracts do not use them.

| Script | Action | Environment |
| --- | --- | --- |
| `deploy.ts` | Spawns an `aos` process, evaluates `dist/<contract>.lua`, optionally sends `Init`, and writes the process id to Consul | `CONTRACT_NAME` (required), `DEPLOYER_PRIVATE_KEY`, `SCHEDULER_UNIT_ADDRESS`, `MESSAGING_UNIT_ADDRESS`, `AOS_MODULE_ID`, `CALL_INIT_HANDLER`, `INIT_DATA_PATH`, `IS_MIGRATION_DEPLOYMENT`, `MIGRATION_SOURCE_PROCESS_ID`, `INIT_DELAY_MS` (`30000`), `USE_PROCESS_ID`, `PHASE`, `CONSUL_IP`, `CONSUL_PORT`, `CONSUL_TOKEN`, `CONTRACT_CONSUL_KEY`, `USE_CONSOLE_LOGGER` |
| `spawn.ts` | Spawns a process on a HyperBEAM node with the `genesis-wasm` device and evaluates `dist/<PROCESS_NAME>.lua` | `DEPLOYER_PRIVATE_KEY`, `HB_URL`, `SCHEDULER`, `MODULE`, `PROCESS_NAME` (`default`) |
| `send-aos-message.ts` | Module. `sendAosMessage`, `sendAosDryRun`, `createEthereumDataItemSigner` | `CU_URL` |
| `init-clean.ts` | Sends `Init` with the data in `INIT_CLEAN_DATA` | `ETH_PRIVATE_KEY`, `PROCESS_ID`, `INIT_CLEAN_DATA` |
| `dryrun-view-state.ts` | Dry run of `View-State` | `PROCESS_ID` |
| `dryrun-view-roles.ts` | Dry run of `View-Roles`. `--convert` prints the roles as a grant list | `PROCESS_ID` |
| `acl/update-roles.ts` | Sends `Update-Roles` | `ETH_PRIVATE_KEY`, `PROCESS_ID`, `UPDATE_ROLES_DATA` |
| `operator-registry/add-verified-hardware.ts` | Sends `Add-Verified-Hardware` | `ETH_PRIVATE_KEY`, `PROCESS_ID`, `FINGERPRINTS` |
| `operator-registry/add-worker-acl.ts` | Placeholder without an action | `ETH_PRIVATE_KEY`, `PROCESS_ID` |
| `operator-registry/eval.ts` | Sends `Eval` with code from a variable or a file | `ETH_PRIVATE_KEY`, `PROCESS_ID`, `EVAL_CODE`, `EVAL_CODE_PATH` |
| `operator-registry/get-state-patch.ts` | Reads `View-State` and writes Lua code that sets the same state | `PROCESS_ID`, `PHASE` (`dev`), `PATCH_NAME` |
| `relay-rewards/update-configuration.ts` | Sends `Update-Configuration` | `ETH_PRIVATE_KEY`, `PROCESS_ID`, `UPDATE_CONFIG_DATA` |
| `staking-rewards/update-configuration.ts` | Sends `Update-Configuration` | `ETH_PRIVATE_KEY`, `PROCESS_ID`, `UPDATE_CONFIG_DATA` |
| `staking-rewards/toggle-share-feature.ts` | Sends `Toggle-Feature-Shares` | `ETH_PRIVATE_KEY`, `PROCESS_ID`, `FEATURE_SHARES_ENABLED` |
| `staking-rewards/update-shares-configuration.ts` | Sends `Update-Shares-Configuration` | `ETH_PRIVATE_KEY`, `PROCESS_ID`, `UPDATE_SHARES_CONFIG_DATA` |
| `staking-snapshots/add-staking-snapshot.ts` | Sends `Add-Staking-Snapshot` with the data of a file | `ETH_PRIVATE_KEY`, `PROCESS_ID`, `SNAPSHOT_DATA_PATH` |
| `staking-snapshots/set-history-size.ts` | Sends `Set-History-Size` | `ETH_PRIVATE_KEY`, `PROCESS_ID`, `HISTORY_SIZE` |

Rules:

- Do not use these tools for a native contract. Use `deploy.ts` in `scripts/`.
- `deploy.ts` and `spawn.ts` in this directory have defaults for the key, the module and the
  node. The default key is a public test key and the default node of `spawn.ts` is operated by
  a third party. Set every variable.
- Several files import modules by paths that do not exist in this directory:
  `send-aos-message.ts`, `spawn.ts`, `dryrun-view-state.ts` and `dryrun-view-roles.ts`. The
  other files import `send-aos-message.ts`. Correct the import paths before running a legacy
  script.
