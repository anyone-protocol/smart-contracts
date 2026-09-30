# AO operations

Nomad job specs for the AO contracts.

## Jobs

| Job spec | Purpose | Image |
| --- | --- | --- |
| `publish-modules-<env>.hcl` | Publishes contract modules and the write gate to Arweave | mainnet |
| `<contract>/deploy-<contract>-<env>.hcl` | Spawns a contract and records its process id | mainnet |
| `publish-snapshot-<env>.hcl` | Captures and publishes a state snapshot of each contract, daily | mainnet |
| `<contract>/controllers-*`, `init-clean-*`, `*-admin-*`, `eval-*`, `*-golive*`, `operator-registry-*-stage.hcl` | Jobs for the legacy contracts | legacy |

The mainnet image is `ghcr.io/anyone-protocol/smart-contracts-ao-mainnet`, built from
`Dockerfile-Mainnet`. The legacy image is `ghcr.io/anyone-protocol/smart-contracts-ao`.

## Image

`ao-build-and-publish-image.yml` builds the mainnet image and tags it by commit SHA. It runs on
changes to the files the image is built from, and it can be started by hand for any branch.

Job specs pin the image as `<tag>@sha256:<digest>`. Move the tag and the digest together.

Rules for the image:

| Rule | Reason |
| --- | --- |
| Every file is copied by name. No directory is copied | The container runs with a signing key mounted, so its content is reviewed line by line |
| `Dockerfile-Mainnet.dockerignore` denies the whole context and admits the same files | A file that is not listed cannot enter the build context. A missing entry fails the build |
| The contract bundles are built into the image | The bytes that get signed are fixed by the image digest |
| Only `dist/` is writable at run time | `deploy.ts` rebuilds the bundle and the seed there. The source tree stays read-only |
| The image has no default command | Every use is a one-shot job that names its entry point |

The workflow pushes with `buildx`, with `--provenance=false`, `--sbom=false` and
`oci-mediatypes=false`. With these the pushed manifest is a plain Docker v2 image manifest, so
the digest a job spec pins is the image digest that a pull reports.

Adding a contract or a script to the image means adding it to both `Dockerfile-Mainnet` and
`Dockerfile-Mainnet.dockerignore`.

## Publishing modules

```bash
nomad job run publish-modules-stage.hcl
nomad alloc logs <alloc id>
```

The job runs `scripts/publish-module.ts` on the files named in `args` and prints one id per
file. Edit `args` to name what to publish:

| File | Module |
| --- | --- |
| `runtime/write-gate.lua` | Write gate |
| `dist/operator-registry-native.lua` | Operator registry |
| `dist/relay-rewards-native.lua` | Relay rewards |
| `dist/staking-rewards-native.lua` | Staking rewards |

Rules:

- A module id is the id of the signed item. It depends on the signing wallet as well as on the
  bytes, so the same source published with another wallet gets another id.
- Publish a module once, from one job, and pin that id in every environment. There is one job
  per environment because Vault scopes a secret to `kv/<namespace>/<job id>`.
- Republish a module only when its bytes changed. A contract bundle includes
  `runtime/native.lua`. The write gate does not.
- The seed is not part of a module, so one published id serves every environment.
- `--wait` blocks until the Arweave GraphQL index confirms the item. A 200 from the bundler is
  a queue receipt, and a gateway can serve an item from cache before it has settled.
- `BUNDLER` has no default.
- Pin the image to the commit that holds the source being published.

Where an id is pinned:

| Module | Pinned in |
| --- | --- |
| Write gate | The `module` key of the HyperBEAM job specs |
| Contract | `MODULE_ID` in that contract's deploy job |

The job name and namespace select the Vault path, so renaming a job changes the secret it can
read.

### Publishing into a node's cache

`ao/scripts/publish-modules.sh [dev|stage|live] [--gate-only]` publishes the modules into one
node's own cache and prints the ids. Run it from `ao/` on a host with Nomad access, after
building `dist/`.

- A module published this way resolves on that node without Arweave. Its id exists on that node
  only.
- `--gate-only` publishes the write gate alone.
- The gate fails closed. Publish the gate module before a node configuration refers to it.

## Deploying a contract

```bash
nomad job run relay-rewards/deploy-relay-rewards-stage.hcl
```

The job runs `scripts/deploy.ts <contract> --seed <source>`.

| Setting | Meaning |
| --- | --- |
| `--seed <live\|stage\|current\|none>` | Selects the seed sent on the spawn message. `live` and `stage` build it from that environment's state dump. `current` uses an envelope built by `build-respawn-seed.ts` |
| `--previous-round <keep\|now\|0\|ms>` | Relay rewards only. Sets the timestamp the first round is measured from. See below |
| `MODULE_ID` | Id of the published module |
| `CONTRACT_CONSUL_KEY` | Consul key that receives the new process id |
| `HB_URL` | Node address, rendered from the `hyperbeam-<env>-node` Consul service |

What `deploy.ts` does:

1. It refuses a module id unless the module is indexed on Arweave, its bundle is mined and at
   least 50 confirmations deep, and its bytes match the bundle the image builds. A module that
   exists in one node's cache cannot be computed anywhere else.
2. It spawns the process with the seed.
3. It writes the process id to Consul, waits for the node to pick it up, and then verifies the
   spawned state against the seed and checks the write gate.
4. It restores the previous Consul value if verification fails.

Rules:

- The reward of a round is `TokensPerSecond` times the time since the previous round, so the
  previous round timestamp in the seed decides what the first round pays:

  | Value | First round covers |
  | --- | --- |
  | `keep` (default) | The time since the last round in the source state |
  | `now` | The time since the deploy |
  | `0` | Nothing. The first round pays no reward |
  | epoch milliseconds | The time since that moment |
- `HB_URL` is rendered in a `template` block. An `env` block is not processed by
  consul-template, so a service lookup there reaches the process as literal text.
- The node serves unsigned reads only for process ids on its list of free routes, and that
  list is rendered from the same Consul keys. A process id must be in Consul before it can be
  read.
- Use an image built from a commit that contains the current `deploy.ts`.

## Snapshots

`publish-snapshot-<env>.hcl` is a periodic batch job that runs once a day:

```bash
bun run scripts/snapshot-state.ts <env> --out /tmp/snap && \
  bun run scripts/publish-snapshot.ts /tmp/snap --confirm --wait 900
```

| Property | Detail |
| --- | --- |
| Separate job | It does not share the node's lifecycle, so changing it does not restart the node |
| Reads | `slot/current` and `as/dump`, both free routes. The job never writes to a process |
| Upload | Through the node's `~bundler@1.0`, addressed in-cluster as `BUNDLER` |
| Payment | The node's wallet pays for the bundle. Keep that wallet funded |
| Signing | `PUBLISH_JWK` signs the data item and needs no balance. It is a key of its own, separate from the node's key |
| Idempotent | A contract that has not advanced since its last published snapshot is skipped |
| Overlap | `prohibit_overlap` keeps a slow run from running beside the next one |
| Anchoring | A snapshot without an anchor assignment is skipped. The next run picks it up once the assignment is indexed |

- A run can end with items accepted and not yet indexed. It exits 0 in that case.
- A snapshot anchors history from its own slot forward.
- The two commands are chained with `&&`, so a failed capture never reaches the publisher.
- The JWK is stored in Vault as base64 and decoded into a file. `PUBLISH_JWK` holds the path.
- `BUNDLER` and the JWK are rendered in `template` blocks, and the job declares `consul {}` so
  the service lookup can render.

Verify a published snapshot:

```bash
bun run scripts/verify-snapshot.ts --published <transaction id>
```

See [../../ao/docs/durability-and-recovery.md](../../ao/docs/durability-and-recovery.md).

## Tests in CI

`ao-test.yml` runs the contract test tiers as separate jobs.

| Setting | Detail |
| --- | --- |
| Triggers | Pull requests, pushes to `main`, and manual runs |
| Concurrency | A new commit on the same branch cancels the run in flight |
| Permissions | `contents: read` |
| Fork pull requests | Every job is skipped for a pull request from another repository |
| Lua | Stock Lua 5.3 for the first tier, and the luerl version that HyperBEAM pins for the second |
| End to end | Runs against a HyperBEAM container, and builds the luerl image in its own job because the image is local |

The legacy mocha suite under `ao/test/` is not run in CI. It documents what the legacy suite
asserted.
