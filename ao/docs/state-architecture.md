# State architecture for the native contracts

Status: **proposal**, 2026-07-29. Nothing here is implemented. Every number is measured on
`v0.9-FINAL` unless marked otherwise.

This is a from-scratch design, not a migration of the current shape. None of this code is in
production and all of it is ours, so the question is what is *right*, not what is the smallest
diff from D26.

## The one thing that drives cost

`dev_lua.erl:311` runs `hb_cache:ensure_all_loaded(Params, Opts)` — "Resolve all hyperstate
links" — before **every** compute. Everything in process state is fully materialized into the
luerl VM on every message, unconditionally.

So the size of Lua-visible state sets the floor on per-message cost, on snapshot size, and on
write volume. Every expensive thing we measured is downstream of it:

| driver | measured |
|---|---|
| addressable key count | 12,000 keys 3,312 ms vs 256 keys 130 ms, **at constant total bytes** (~25×) |
| luerl snapshot leak | VM blob 400 KB → 20.6 MB by slot 150; fixed by the `luerl:gc/1` patch |
| A16 `stripMeta` over `base.state` | 1.46× (732 vs 1,065 MiB / 20 slots) |
| nesting depth | **refuted** as a driver |

**Design rule: keep large maps out of the Lua VM.**

## Target shape

Lua state holds scalars and bounded working sets only — configuration, round metadata, counters,
ACL, the in-flight round's pending scores. Every large cumulative map lives as a `~trie@1.0` trie,
referenced from state by its content-address id.

| contract | moves to a trie | stays in Lua |
|---|---|---|
| relay-rewards | `TotalFingerprintReward` (9,750), `TotalAddressReward` (763), `Claimed` (530) | `Configuration`, `PreviousRound`, `PendingRounds` |
| staking-rewards | `Rewarded`, `Claimed` (two-level) | `Configuration`, `PreviousRound`, `PendingRounds`, `Shares`, `PendingShareChanges` |
| operator-registry | `verified` (7,932), `claimable` (2,940), `verifiedHardware` (1,088), `registrationCredits` | `registrationCreditsRequired`, counters |

Relay's Lua state drops from ~11k keys to a few dozen.

The id in state **is** the content address of the whole map, so state still commits to every entry
by hash. This is not weaker than holding the data inline — it is the same commitment, deduplicated.

### Measured effect (10k-key synthetic token, 12 messages)

| | stock | GC-patched |
|---|---|---|
| flat map in Lua state | 2,700 ms/msg, growing 1.18× | 2,303 ms/msg, flat 1.01× |
| trie held **by value** in state | 8,801 ms/msg | — |
| trie held **by id** | 1,163 ms/msg, growing 1.65× | **554 ms/msg, flat 0.98×** |

**By value the trie is 3.3× WORSE than a flat map** — it is materialized, marshalled out and
marshalled back on every operation. By id it is 4.9× better than today with the growth gone. The
by-id distinction is the entire design, not a tuning detail.

At the device layer, with no Lua involved: mutating 2 of 10k keys and writing costs **238 ms flat
vs 18 ms trie (13×)**. A flat 10k-key message costs the same ~238 ms whether it is brand new or
has two keys changed — full re-ID every slot, no dedup.

## Read surface

Four access patterns, all one request:

| pattern | request | measured |
|---|---|---|
| point read | `GET /<pid>~process@1.0/now/state/<mapId>/~trie@1.0/<key>` | ~100 ms; misses 404 |
| key list | `GET /<id>~trie@1.0/keys` + `Accept: application/json` | 88 ms / 1,000 keys, 53 KB |
| **full map** | `GET /<id>` + `Accept: application/json` + `accept-bundle: true` | **594 ms / 10k keys, 840 KB, zero links** |
| current id | `GET /<pid>~process@1.0/now/state/<mapId>` | trivial |

Callers never need to know or cache the id — the process hands it over mid-path.

⚠️ Without `accept-bundle: true` a full fetch returns the top of the tree plus **946 `+link`
subtrees** at 10k keys, i.e. ~950 follow-up requests. The header is not optional for full-map
reads.

⚠️ The bundled response is the trie **structure**, with path-compressed edge labels — a 40-char key
is the concatenation of the labels along its path:

```json
{"A5000000000000000000000000000000": {       // 32-char shared prefix
    "0B10CB15": "1000000000000000000",        // 8-char remainder -> A50000…0B10CB15
    "2": { "0714015": "…" }                   // 1-char branch, 7-char remainders
```

Consumers that pull a whole map must reassemble keys during the walk. That belongs in `ao-client`
as one shared helper, not repeated per consumer.

## Iteration audit

Checked every `pairs()` in all three contracts. **Compute and settlement never iterate a large
cumulative map** — settlement walks `PendingRounds[ts]` (bounded by the round) and updates the
cumulative maps *point-wise*. The hot path is safe.

Four views do iterate, and two are real consumer reads:

| view | today | under this design |
|---|---|---|
| `status` | `count()` over every map | **maintained scalar counters** — strictly better, O(1) |
| `scoring` | returns `verified` + `verifiedHardware` wholesale to the reward runners each round | full-map bundle fetch (one request) |
| `operators` | scans all `verified` to build the active address set | maintained address set; 763 entries stays inline |
| `operator` | scans `verified` + `claimable` (10,872 entries) to find one address's fingerprints | **needs a reverse-index trie** keyed by address |

The `operator` view is the only one requiring a new structure: an address → fingerprint-set trie
maintained on write. That is not a workaround for the trie design — an O(n) scan per lookup is a
defect today that the current shape happens to hide.

`dump` can go. Full state is `state` (small, one read) plus one bundled fetch per trie. If we keep
it, it should be a thin wrapper over exactly that rather than a Lua-side materialization.

## What this deletes

- **The persist-side A16 `stripMeta` (~line 546) — deletable TODAY, no tries required.**
  ✅ **Measured 2026-07-29** on the real operator-registry with the real seed and real
  `Admin-Submit-Operator-Certificates` writes, checked warm and after a cold reload:

  | `native.lua` | result |
  |---|---|
  | both strips present (today) | no loss |
  | **A16 persist-side strip removed** | **no loss** |
  | A16 + A18 both removed | **all 8 certs lost** — claimable stuck at 2,940 |

  The **A18 pre-handler strip (~line 519) is what actually prevents the write-loss**; the
  persist-side one is redundant. The third arm doubles as detector validation — it fires when
  protection is fully removed.

  ⚠️ **The saving is smaller than earlier drafts of this note claimed.** Order is: A18 strips
  `base.state` → handler mutates → A16 strips again. The handler adds no commitments, so the second
  strip runs on already-clean state — a no-op deepcopy. Deleting it saves one full copy of state per
  message (not nothing at 11k keys) but **does not recover the 1.46×**; that figure was
  stripped-vs-not-stripped-at-all, and A18 keeps us permanently in the stripped case.

  ⚠️ Proven for the opreg/`claimable` shape with 8 writes; test relay/staking shapes before shipping.

  Consequence for this design: A16 is **not** an argument for tries. It is an independent cleanup.
  A18 stays regardless, because handlers still iterate small persisted maps (`PendingRounds`,
  `Configuration.Modifiers.Uptime.Tiers`).

- **`projectPatches` — already gone.** It lives in `runtime/runtime.lua` (the legacy runtime);
  `native-bundle.ts` bundles only `runtime/native.lua`, which has no projection step. Noted because
  earlier analysis wrongly blamed it for the ~12k writes/slot; those come from `base.state` being a
  large nested message that HyperBEAM content-addresses per key.
- **`native.RESERVED`.** See below.

## Views must be namespaced, not blocklisted

`native.RESERVED` is a hand-maintained list of ~40 HyperBEAM keys that a view name must not
collide with, enumerated from a live `now` message at one version. It rots: `dev_lua` exports
`init`, `functions`, `normalize`, `encode`, `decode` and **none of the five are in the list**, so a
view with any of those names would today be answered by the device instead of the view — silently,
which is the exact failure the list exists to prevent.

The list is the footgun, not the fix. State is already namespaced under one owned key and is
therefore collision-proof by construction with no list at all. Views should work the same way:

```
now/~lua@5.3a/status   ->   now/~lua@5.3a/view/status
```

One global `view` dispatching on the remainder. Exactly one name has to be collision-free instead
of N, and adding a view can never shadow anything regardless of what upstream adds. `native.RESERVED`
is then deleted rather than extended.

The same reasoning says keep `base.state`: two owned top-level keys (`state`, `acl`) plus
HyperBEAM's own `results` is near-minimal, and flattening would move 11k keys *into* the contested
namespace. Note this cuts against an earlier instinct to flatten — nesting is what makes the
`timestamp`-style envelope collisions impossible.

## Unverified — must be settled before committing

1. ~~**Snapshot portability.**~~ **SETTLED 2026-07-29 — trie nodes are NODE-LOCAL. See below.**
2. **`native.lua` integration.** Every measurement above uses bare inline contracts. `projectPatches`
   and `stripMeta` are bypassed entirely. The real runtime is untested against tries.
3. **Two-level maps.** Staking's `Rewarded`/`Claimed` are `hodler -> operator -> amount`. Whether
   that is one trie with composite keys or a trie of tries is undecided and unmeasured.
4. **Write batching.** Batched `set` is 244 ms for 10k keys; the same inserts one at a time are
   **46 s** (188×). Any bulk path — migration seeding especially — must batch.
5. Single sample per cell throughout.

## SETTLED: trie nodes are node-local and must be published (2026-07-29)

**The trie does not travel with the process.** Bundling the process (`accept-bundle: true`) proves
it:

| | bundled `now` |
|---|---|
| flat map in state | 1,061 KB, **11,318 balance values** — data travels with the process |
| trie by id | 9 KB, **zero trie content** |

The id is a plain string, so nothing links the process message to the trie nodes. Verified
end-to-end: a **fresh node with an empty store returns 500** for a trie id that resolves fine on
the node that built it — and that is *with* `hb_store_gateway`/`hb_store_arweave` in the default
store stack (`hb_opts.erl:467-493`), because the nodes were never published to Arweave.

| scenario | works? |
|---|---|
| same-node restart / restore from snapshot | ✅ verified (`999999999999999999/ok` before and after) |
| replay from slot 0 on another node | ✅ mechanically — content addressing regenerates identical nodes (untested) |
| restore from a snapshot on **another** node | ❌ has the id, not the data |
| any reader pointed at a node that never computed the process | ❌ |

That last row is the significant one: today any node holding the process can serve reads; with
by-id tries only nodes that computed it (or fetched the nodes) can.

**Storing the id as a link instead of a string is a dead end** — a link is exactly what
`ensure_all_loaded` expands, so it would travel with the process *and* be materialized into the VM
every compute, which is the cost the whole design exists to avoid.

### ⚠️ CONTROL TEST — the above is NOT a regression versus what we have today

A fresh node returns **500 for the flat process too**. Neither shape is portable to a node that
never computed the process, because **nothing publishes state at all**:

- **Local persistence**: `hb_cache:write` → `hb_store_lmdb`, identically for flat state and trie
  nodes. No prune, no GC.
- **Off-node**: the ONLY automatic upload is `dev_scheduler_server.erl:267-268` — each **message**
  and **assignment**. Process state and cache content are never uploaded, for any state shape.
- **Retrieval elsewhere**: `hb_store_gateway` + `hb_store_arweave` are in the default store stack,
  so fetch-by-id works *if* content was published.
- **Recovery model**: replay the assignment log and recompute. Shape-agnostic.

**Under replay, tries are equivalent to flat state** — `dev_trie:set` re-runs and regenerates
identical nodes. Determinism evidence: the example contract's seed id was byte-identical
(`vez2gv…`) across two independent spawns.

The real difference is narrower: the bundled *process message* carries a flat map's data but not a
trie's. **Tries are only worse if recovery TRANSFERS state instead of replaying** — i.e. pulling a
snapshot from another node. That is the WS-6 D21/D22 design question, not a defect. If we choose
snapshot-transfer recovery, trie nodes must be published alongside; if we rely on replay, nothing
changes.

⚠️ If publishing is needed, it should be *cheaper* than the alternative: only the root-to-leaf path
changes per write (a handful of nodes at radix-256) versus a whole ~700 KB process message. Reasoned,
not measured.

## Working Lua call shapes

Verified; see `examples/trie-by-id.lua` for a runnable contract.

- `ao` exposes exactly four functions: `event`, `get`, `resolve`, `set`.
- ✅ `ao.resolve({'as','trie@1.0', ID_STRING}, {path='get', key=K})`
- ❌ `ao.resolve({'as','trie@1.0', TABLE}, …)` — **hard-crashes the compute; `pcall` does not
  catch it.** The `as` form is fine, a table base is not.
- ❌ Resolving `id` on a trie returns `not_found`: `dev_trie:info/0` is `default => fun get/4`, so
  every unknown key becomes a trie lookup. The new id must be read from the returned message's
  `commitments`, which is why writes still cost one materialization. Worth asking Forward Research
  whether a set can return just the id.
- ⚠️ The message Lua receives is the **Assignment**; the sender's tags are under `message.body`.
  Reading `message.action` yields nil and every action silently no-ops.
