# Durability and recovery (D21 / D22)

How a contract's state and history survive the loss of the node that hosts them, what is
actually guaranteed, and the exact procedure to recover.

## The two halves

**D21 - history reaches Arweave.** The scheduler publishes an assignment per slot, binding a
process and a slot to a message. Assignments are hash-chained: each carries
`base-hashpath = <accumulated hashpath>/<id of the previous slot's assignment>`. A dropped
message does not merely leave a hole in the slot integers, it breaks the linkage, so published
history is ordered, attributable and tamper-evident.

**D22 - state is anchored.** A snapshot carries the state, the slot, and the id of the
assignment at that slot. That last field is what makes it work: without it the published chain
dangles from a predecessor that does not exist on Arweave.

Either half alone is insufficient. Assignments without a snapshot give a chain with no root.
A snapshot without assignments gives a state with no verifiable history after it.

## What a published message actually contains

A message on Arweave carries only:

```
type = Message | data-protocol = ao | variant = ao.N.1
require-codec = application/json | action = <handler> | round-timestamp = <ms>
```

No `process`, no `target`, no `slot`. Those are **not** required for HyperBEAM to validate a
message: the routing target is the URL path (`/<pid>~process@1.0/push`), and item validation is
self-contained ANS-104 signature verification. Binding a message to a process and a slot is the
assignment's entire job, which is why losing assignments loses everything - the messages remain
on chain but become unattributable.

## The pre-fix gap

Every slot written before `scheduler-default-commitment-spec: ans104@1.0` was deployed
(2026-08-25) has **no assignment on Arweave**. Snapshots anchor history from their own slot
forward. They do not recover what was never published, and nothing can.

This is why the tooling refuses to publish an unanchored snapshot: paying to store one buys a
false sense of durability.

## What is guaranteed, and what is not

**Guaranteed.** Anyone with a process id and a gateway can obtain a state whose digest they can
verify, an anchor proving that state's slot was attested by our node, and every message from
that slot to the head in provable, gap-checked order.

**Not guaranteed.** A stock HyperBEAM node cannot cold-boot our process from Arweave. Verified
in the node source at `v0.9-FINAL` (the tag our image is built from) and at current HEAD:

- `dev_scheduler_cache:read/3` resolves `~scheduler@1.0/assignments/<process-id>/<slot>`, a
  local symlink, and returns `not_found` on a miss. No id-based or gateway fallback.
- `hb_store_gateway` reads by transaction id; its `resolve/3` returns the key unchanged, so it
  cannot satisfy that path.
- Only three call sites create those symlinks: `dev_scheduler_server` (when that node IS the
  scheduler) and `dev_scheduler:cache_remote_schedule` (fed over HTTP from a remote scheduler).
- `~copycat@1.0/graphql?tag=process&value=<pid>` is the near miss - it fetches and indexes
  exactly these transactions, but calls plain `hb_cache:write`, not
  `dev_scheduler_cache:write`, so the bytes land and the scheduler index never learns about
  them. It does not exist at all in `v0.9-FINAL`.

That is a gap in the node, not in our data, and no amount of publishing on our side changes it.
The upstream fix is small (a copycat mode that routes assignments through
`dev_scheduler_cache:write`, or a scheduler-cache fallback that resolves by process tag) and is
worth filing, but nothing here depends on it landing.

The live path is unaffected: a third-party node given a process id resolves `scheduler-location`
from the spawn, is redirected to our node, fetches the schedule over HTTP, and caches it. That
works today and needs no Arweave. It just depends on our node being reachable, which is exactly
the dependency D22 exists to remove.

## Tools

| script | what it does |
|---|---|
| `scripts/snapshot-state.ts <env>` | capture a consistent, anchored snapshot per contract |
| `scripts/publish-snapshot.ts <dir>` | publish snapshots as direct L1 transactions (dry run by default) |
| `scripts/verify-snapshot.ts <dir>` | verify payload, anchor, chain continuity and message retrievability |
| `scripts/recover-from-arweave.ts <pid>` | reconstruct state + ordered history from Arweave alone |

### Capturing

```bash
bun run scripts/snapshot-state.ts live --out snapshots/live
```

There is no way to pin a view read to a slot, and **both plausible spellings fail silently**
rather than erroring (measured on stage 2026-08-25):

- `compute&slot=N/as/dump` returns ~891 B of empty state - it evaluates the view against that
  slot's result message, not the accumulated state.
- `as/dump?slot=N` and `as/dump&slot=N` ignore the parameter and return latest.

So consistency comes from bracketing: read `slot/current`, dump, read `slot/current` again, and
require they match. Live rounds are hourly and a dump takes 1.6-3.4 s, so this converges
immediately.

### Publishing

Snapshots publish from a **separate periodic batch job**, once a day:

```
operations/ao/publish-snapshot-stage.hcl
operations/ao/publish-snapshot-live.hcl
```

Separate rather than a sidecar inside the hyperbeam group, on purpose. A sidecar would share the
node's lifecycle, so every change to this tooling or its image would redeploy hyperbeam and
restart the node. Snapshot tooling should never be a reason to restart a node holding live
protocol state.

The job needs nothing from the node but two reads. It resolves the node through the in-cluster
`hyperbeam-<env>-node` Consul service - which exists for exactly this, and is how deploy and
verify jobs already address it - so it never goes through the public edge. `slot/current` and
`as/dump` are both on p4's non-chargable routes, so the signer needs **no faff allow-list entry**
and the snapshot never touches the write path.

`periodic { cron = "@daily", prohibit_overlap = true }`. Overlap prohibition plus the
(process, slot) dedupe below means a double-post is unreachable even if a run wedges.

Snapshots go to Arweave as **direct L1 transactions**, not through a bundler - including not
through our own `~bundler@1.0`. Three reasons, in order of weight:

1. **Our `~bundler@1.0` is broken.** It signs, prices and mines the bundle transaction, then
   every chunk POST returns `400 data_root_not_found`: `building_proofs` computes a `data_size`
   that does not match the bundle it just posted a header for, so the merkle root describes a
   payload that does not exist. Structural in the `SignedTX -> structured@1.0 -> tx@1.0` round
   trip between `post_tx` and `build_proofs`, not payload-specific - snapshots would fail the
   same way while still being paid for.
2. **A bundled item is only queryable by tag if a gateway chooses to unbundle it.** A direct L1
   transaction is indexed natively with its tags. Recovery finds snapshots by
   `tag process=<pid>, type=state-snapshot`, so bundling would make durability depend on gateway
   policy for no benefit.
3. **The saving is 0.348%.** Measured 2026-08-25: three separate transactions cost 0.0205867 AR,
   one bundle of the same bytes 0.0205150 AR. Arweave prices per byte; bundling amortises many
   small items, and three ~1 MiB blobs are the opposite shape.

If `~bundler@1.0` is fixed, revisit (2) before (3) - the unbundling dependency is the real
objection, not the fee.

Measured 2026-08-25:

| contract | state | gzipped | L1 cost |
|---|---|---|---|
| operator-registry | 0.99 MiB | 0.36 MiB | 0.0059 AR |
| relay-rewards | 4.02 MiB | 0.96 MiB | 0.0117 AR |
| staking-rewards | 0.70 MiB | 0.22 MiB | 0.0030 AR |
| **all three** | 5.71 MiB | 1.54 MiB | **0.0206 AR** |

**Publishing is idempotent on (process, slot).** A snapshot's value is moving the anchor
forward, so if a process has not advanced a slot since its last published snapshot, the
publisher skips it rather than paying for a byte-identical copy. This is not an edge case: live
operator-registry sits at slot 8 for long stretches, and a daily cadence would otherwise re-post
the same state every day. It also makes a retried or re-run job safe: it re-posts nothing that
is already on chain.

If a published snapshot exists for the same (process, slot) but its `state-sha256` **differs**,
that is not a duplicate - one slot produced two different states, which is a correctness problem.
The publisher reports it and exits non-zero rather than skipping silently. `--force` overrides.

`PUBLISH_JWK` is an **Arweave JWK** that signs and pays. It is not the EVM key used by
`publish-module.ts`, which signs ANS-104 items for a bundler and holds no AR.

### Verifying

```bash
bun run scripts/verify-snapshot.ts snapshots/live            # local artifacts
bun run scripts/verify-snapshot.ts --published <tx-id>       # a published snapshot
bun run scripts/verify-snapshot.ts --chain <process-id>      # just walk the chain
PERTURB=1 bun run scripts/verify-snapshot.ts snapshots/live  # self-test
```

A snapshot taken at the head slot has nothing after it, so the linkage assertion is **vacuous**
at capture time and is reported as `warn`, never as a pass. `PERTURB=1` corrupts the
expectations and asserts the checks actually fire, so an assertion that has quietly gone
vacuous cannot masquerade as one that is holding.

### Recovering

```bash
bun run scripts/recover-from-arweave.ts <process-id> --out recovery/ --seed
```

Produces:

- `state.json` - verified state at the snapshot slot
- `messages/` - every message body from that slot to the head, slot-ordered
- `recovery.json` - provenance and an explicit `provablyComplete` verdict

It exits non-zero if the history is not provably complete, rather than emitting a bundle that
looks whole.

To bring a contract back up from that output, respawn it with `state.json` as the seed (a seed
requires a module-id spawn - it rides the spawn message) and replay `messages/` in slot order.
The respawned contract has a **new process id**; recovering the original id in place needs the
node-side ingestion described above, which does not exist yet.

## Operational notes

- Snapshot cadence is a cost/exposure tradeoff, not a technical constraint. At 0.0205 AR per
  full round, daily is ~7.5 AR/year. The exposure a snapshot bounds is how many slots a
  recovery must replay, not how much state is at risk - state is on RAID1 with working local
  restore, and the snapshot is the offsite copy.
- Time restarts of the node between rounds. Both reward contracts derive their period from
  `timestamp - PreviousRound.Timestamp`, so a delayed round covers a longer period and pays
  proportionally; the assertion that would reject is a *backdated* timestamp, which a delay
  cannot produce. Restarts belong between a contract deploy and the first consumer.
