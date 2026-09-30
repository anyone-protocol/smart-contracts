# Node qualification

One reproducible procedure to decide whether a HyperBEAM image may run stage and live.

`scripts/qualify-node.ts` is the driver; `spec/fixtures/node-baseline.json` is what a good result
looks like. Before this existed, every piece of evidence existed and no procedure assembled them:
Tier-2, `run-e2e.ts`, the staking golden, `verify-access-policy.ts` and the nineteen probes each
answered part of the question, and nothing ran them in order. The larger gap was that nothing
*recorded* the answer, so "did this version regress?" was not mechanically answerable — the numbers
that justify the image patches lived in docs and in people's heads.

## Run it

```sh
# bless a version: record what a good result looks like
bun run scripts/qualify-node.ts --image <ref> --record-baseline

# qualify a candidate against that record
bun run scripts/qualify-node.ts --image <ref>

# what can be asked of a deployed node (fewer phases; the rest report SKIP with a reason)
bun run scripts/qualify-node.ts --url https://hb-stage.anyone.tech --env stage

bun run scripts/qualify-node.ts --list             # the phase table
bun run scripts/qualify-node.ts --image <ref> --only toolchain,identity,config   # the fast ones
```

A full image run takes about four minutes on a 24-core workstation, most of it `economics` (55 s)
and `restore` (93 s, of which 70 s is a deliberate idle to force a late snapshot). `--quick` shrinks
the economics samples for a faster pass and consequently refuses to record a baseline.

## What is being qualified is an IMAGE

The primary mode boots a container from the image under test, drives everything against it, and
tears it down. A deployed node conflates the image with its environment — Consul-templated PIDs,
the nginx edge, a funded bundler — so a regression in one reads as a regression in the other.
`--url` mode exists for the checks that can only be made against a real environment.

Pin by **digest, not tag**. The tag `v0.9-FINAL-patched` has been reused, and this workstation
currently holds three different images that have all worn it. The `toolchain` phase records the
upstream commit and a fingerprint of the applied patches, so a mislabelled image is caught rather
than assumed.

## What gates, and what does not

This is the load-bearing distinction, and getting it wrong produces a suite nobody trusts.

**Absolute latency does not gate.** `gc-cost-curve`'s own header says the numbers move with host
load and state size and are not comparable between runs. A baseline recorded on a workstation and
compared on CI would fail for reasons that have nothing to do with the image. Every absolute
millisecond figure is therefore recorded, printed with its delta, and unable to fail a run.

**Shape gates.** Growth ratios, scaling ratios, pass/fail counts, and identity. Those are
host-independent, and they are where the failures we have actually seen would land: the
un-collected luerl snapshot showed up as a growth *curve*, not as a slow message.

The tolerance bands live in `METRICS` in the script rather than in the baseline JSON, so widening
one is a reviewable diff instead of a quiet fixture edit.

| metric | gate |
|---|---|
| `gc.growth` | hard ceiling 1.50x, plus a deliberately loose ±40% and 0.20 allowance against the baseline. The ceiling does the real work: the GC-patched image measures flat, the stock image grew about 5x (554 ms to 2,700 ms over 50 slots). The band is loose because the ratio is noisy — five runs of the *same* image measured 0.77, 0.85, 0.87, 1.03 and 1.08, a 1.4x spread. A ±20% band would have false-failed a 1.08 run against a 0.77 baseline. |
| `trie.hitScaling` | hard ceiling 2.0x, plus ±30%. The write gate rests on a trie point lookup being O(key length): if it starts scaling with the operator set, every chargeable write pays for it. |
| `verticals.passed`, `policy.passed` | may not fall below the baseline — a run that passes fewer checks has lost coverage. |
| `*.failed` | ceiling 0. |
| `toolchain.tier2Pin`, `identity.*`, `restore.identical`, `policy.perturb` | must hold. |
| `toolchain.upstream`, `.patchSha`, `.luerl`, `.erts` | identity: a change is reported prominently and marks the run a cross-version comparison, but does not by itself fail. |

## What the production image measured

Recorded against `sha256:7e4f2d1e…` — the image stage and live run — on a 24-core Linux
workstation. Four full runs were taken while building this, which is where the variance figures
come from.

| | value | notes |
|---|---|---|
| upstream commit | `466cf489e306…` | shallow checkout of `v0.9-FINAL` |
| applied patches | `src/dev_lua.erl`, `src/hb_util.erl` | fingerprint `152e6bca…`; patch 0004 is **not** in this image |
| luerl / erts | 1.3.0 / 15.2.7.12 | luerl matches `spec/run-tier2.sh`'s pin |
| Tier-2 | 265 passed, 0 failed, 7 scenarios | |
| config surface | 10 opt paths in force, 0 missing | includes the nested p4 write-gate entry |
| verticals | 13 passed, 0 failed, 8 skipped | skips are all `--keep-artifacts` reuse |
| golden | 0 diffs across 95 checks | |
| `gc.growth` | ~1.0x | observed 0.77–1.08 across five runs on this same image |
| `trie.hitScaling` | ~0.9x | observed 0.872–0.919; flat, as the gate design assumes |
| `restore` | 10 passed, 0 failed | state byte-identical across a real restart |

The absolute latencies (`gc.first10ms` ~220, `trie.hitMs` ~130) are recorded for context only. They
are roughly half what stage measures, because this is a local container with no network in the
path — which is exactly why they cannot be allowed to gate anything.

## Phases

| id | modes | what it establishes |
|---|---|---|
| `toolchain` | image | upstream commit, applied-patch fingerprint, luerl and erts versions, and that Tier-2's pinned luerl still matches the image |
| `fingerprint` | both | the build surface a node will admit to over HTTP — see "Validating a DEPLOYED node" |
| `tier2` | both | `spec/run-tier2.sh` — the luerl conformance scenarios |
| `identity` | both | operator address, `~lua@5.3a` and `~process@1.0` load, root is served, no comment-derived opts |
| `config` | image | the production opt *shape* actually takes effect on this image |
| `modules` | image | builds the three native bundles and publishes them into the node's cache |
| `smoke` | both | spawn, compute, write, an erroring message leaves state unchanged, the VM still computes afterwards |
| `verticals` | both | `run-e2e.ts` — the full contract suite |
| `golden` | both | `staking-view-golden.ts --check` |
| `economics` | both | `gc-cost-curve` and `trie-scale`, reduced to gating ratios |
| `restore` | image | `gc-restore-fidelity` — state byte-identical across a real restart |
| `policy` | url | `verify-access-policy.ts <env>`, including its PERTURB self-test |

Every subprocess writes its full output to `dist/qualify-logs/<phase>.log`, whether it passed or
failed, and the directory is wiped at the start of each run. Both halves matter. `run-e2e` logs
only on failure, so after a green run those files are the *previous* run's and look current — that
has cost real diagnosis time. And a phase that passes suspiciously fast is exactly the one you want
to read: `verticals` finishing in 34 seconds looked wrong until its log showed four verticals and
three migration checks genuinely running, with the eight skips all being `--keep-artifacts` reuse.

A phase that cannot run in the current mode reports SKIP **with the reason**, and the summary lists
every skip under "not evidence of anything". `--record-baseline` refuses outright on any failure,
and refuses on any skip unless `--record-partial` is given: a baseline is a claim that an image is
good, and recording one from a run that skipped its way to a small number of green ticks would bake
that hole in permanently.

## The two checks nothing else made

**`toolchain`.** The Dockerfile leaves `/app` as a git working tree with the patches applied but
uncommitted, so `git diff` *is* the patch set and its sha256 is a single handle on which patches an
image carries. The phase also asserts the image's luerl matches the version `spec/run-tier2.sh`
pins via `LUERL_IMAGE`. The whole point of Tier-2 is to run what the node runs, so a VERSION bump
that moves luerl silently turns Tier-2 into a test of a VM we do not ship. That is a hard failure
with an actionable message, not a note.

**`config`.** Boots a second, short-lived container against `spec/fixtures/node-qualify-policy.json`
— real production structure, placeholder values — and asserts every key reads back from
`~meta@1.0/info`. This is the standing regression test for the trap `verify-access-policy` already
documents: opts read via `hb_opts:get` must be lowercase-**hyphenated**, and a key the node does not
recognise is not an error, it is silently not-found. For `faff-allow-list` that means an empty
allow-list, which means a node that admits nobody. Values are placeholders because the question is
whether the image loads the *shape*; the real values are environment policy and stay in
`verify-access-policy.ts`.

## `--url` mode does not write to a remote node by default

`smoke`, `verticals`, `golden` and `economics` are not observers. Between them they spawn eight
processes, drive real scoring rounds, send 50 writes to a roughly 1 MB seeded registry and seed a
20,000-key trie. Against a container this process just created and will destroy, that is free.
Against stage or live it is permanent state on a production scheduler, at that node's expense.

So a non-loopback `--url` skips those four phases with an explicit reason, and `--allow-remote-writes`
is required to run them there. Loopback is exempt — that is a local node under your control.

`--env stage` on its own is therefore safe: it runs `identity` and `policy`, and the policy suite's
spawn-denial probe is deliberately spawn-*proof* (it signs a DataItem carrying no process tags).

## Device presence has three answers, not two

`/~<device>/info` answers 200 when the device loads and 500 with `device_not_loadable` when it does
not — but on stage and live the request never reaches the node. nginx answers **403**, because D3
makes the edge the sole control for unsigned traffic and `/~lua@5.3a` is not on its whitelist.
Reading that 403 as "the device is missing" failed a perfectly healthy stage node on the first
`--url` run here.

The gate therefore asserts the falsifiable claim — no load-bearing device *reported* itself
unloadable — and an unaskable probe is reported as unproven rather than counted either way. A
separate recorded metric, `identity.devicesProven`, says how many were positively confirmed, so a
run where the edge refused the probe cannot pass itself off as one where it succeeded.

## Validating a DEPLOYED node against a qualified version

This is a weaker question than qualifying an image, and it is worth being precise about how much
weaker, because the tempting answer — "ask the node what version it is" — does not exist. HyperBEAM
exposes no build string anywhere: not in `~meta@1.0/info`, and not in the `~hyperbuddy@1.0/metrics`
scrape, which is 5,206 lines of cowboy, `erlang_vm` and per-process telemetry with no version label
on any of it.

What a node will tell you is the *shape* of the build it is running. Three tiers, in descending
order of what they actually prove.

### Tier 1 — read-only, survives the locked edge

The `fingerprint` phase reads two independent surfaces and hashes each:

* **build-default opt surface** — every key `hb_opts.erl` knows about, read off the info map with
  our own configuration keys subtracted. Changes whenever upstream adds, removes or renames an
  option.
* **preloaded device surface** — every device *name*, enumerated through the `+link` pointers under
  `preloaded-devices`. Changes whenever the device table changes.

Measured 2026-08-26: the qualified image and all three deployed nodes agree exactly, at **67
build-default opts** (`4d2ba896…`) and **61 devices** (`31a35f74…`). Both are reachable through the
nginx whitelist on stage and live, because `/~meta@1.0` is on it.

This proves the node runs the same **upstream version family** as the blessed image. It does not
prove the same image: hb-dev runs `9f6e199b` (v0.9-FINAL plus patch 0004) and stage and live run
`7e4f2d1e` (without it), and they fingerprint *identically* — correctly, since that patch touches
neither opts nor devices.

The subtraction of configuration keys is what makes this a build signal rather than a jobspec
signal. Without it, the local qualification container and stage differ by six keys — stage sets
`node-host`, `faff-allow-list`, `p4-non-chargable-routes` and the rate-limit trio, the local one
sets `relay-allow-commit-request` — and two identical builds look different. The list is
`CONFIG_OWNED` in the phase, and a mismatch is reported **by name**, not as a bare hash, precisely
so the likeliest cause (an environment setting an opt the list does not know about yet) is obvious
rather than mysterious.

Alongside it, `identity` and `policy` also run remotely, and `tier2` runs locally against the
pinned luerl — which means something here only because the opt and device surfaces matched.

### Tier 2 — behavioural, needs `--allow-remote-writes`

Our patches change behaviour, not surfaces, so nothing in tier 1 can see them. `economics` against
a deployed node is the only way to observe patch 0002 remotely: an un-collected luerl snapshot
shows up as a growing per-message cost curve, and `gc.growth` is exactly that measurement. This is
what separates "patched" from "vanilla at the same version".

It writes, so it is off by default against a remote host and requires the flag. On stage that is a
reasonable thing to do deliberately; on live it is not.

### Tier 3 — not observable over HTTP at all

The exact image digest. Nothing the node serves depends on it.

It becomes observable if the jobspec declares it. One line in `config.json`, next to the image pin:

```json
"image-digest": "sha256:7e4f2d1ec42acf3f1cf8dc86854a2c780d42855d1aa3929214aa98f3f695cfa7"
```

HyperBEAM reads its config at boot, so what the node reports at `/~meta@1.0/info/image-digest` is
the digest the **running process started with** — which catches the failure this question is
usually really about: the pin was updated and the allocation never cycled, so the new image was
never running. `fingerprint` asserts it against the baseline's digest when present, and says
`NOT DECLARED` when absent rather than implying an identity it did not check.

Two honest caveats. It is self-asserted: it proves the declared pin and the running process agree,
not that the bytes match. And the two literals — `config.image` and the template's `image-digest` —
sit about forty lines apart in the jobspec and are not derived from one another, so they can drift.
Deriving both from a single HCL `variable` would fix that; it is not done here because a top-level
`variable` block changes how the job is submitted and cannot be validated without cluster access.
The mismatch message names drift as a possible cause first, so a false alarm reads as one.

### Verified 2026-08-26

```
$ bun run scripts/qualify-node.ts --url https://hb-stage.anyone.tech --env stage
  PASS  observable build surface — 67 build opts (4d2ba896…) · 61 devices (31a35f74…)
        — same VERSION FAMILY as the baseline; the exact image is NOT proven
  PASS  access policy — 41/41 checks passed on stage, PERTURB self-test detects corruption
  PASS  tier-2 luerl conformance — 265 passed, 0 failed, 7 scenarios
  4 phases passed, 0 failed, 8 skipped
  INCOMPLETE — passed what it ran, but did not run everything
```

Live gives the identical result. Both surfaces match the blessed baseline exactly, and the verdict
is INCOMPLETE rather than QUALIFIED — which is the honest answer, since eight phases did not run
and the summary names every one of them with its reason.

Two details in that run are worth reading rather than skipping. `identity.devicesProven` came back
**0 against stage and 2 against the local image**: the edge refused the device probe, so the check
could not be positively confirmed, and it is a recorded metric precisely so that shows up instead
of being smoothed over. And `fingerprint.configOnly` was **18 against stage, 13 locally** — stage
sets more configuration opts than the qualification container does, which is expected, and is
recorded rather than gated for the same reason.

### What to run

```sh
# safe against any environment: no writes, no spawns
bun run scripts/qualify-node.ts --url https://hb-stage.anyone.tech --env stage

# deliberately exercise the deployed node's behaviour too (stage, not live)
bun run scripts/qualify-node.ts --url https://hb-stage.anyone.tech --env stage --allow-remote-writes
```

## Which key signs

`E2E_PRIVATE_KEY`, else `DEPLOYER_PRIVATE_KEY` from `ao/.env`, else a built-in dev key. The
resolved address is printed before any write.

That order differs from `run-e2e.ts`, which reads only `E2E_PRIVATE_KEY` so an ambient `.env`
cannot silently decide who signs. The difference is deliberate: this driver also runs the staking
golden, and **the golden is signer-bound** — its `status` view reports the process `owner`, so a
capture made with one key diffs against a run made with another. Two views move, nothing is wrong
with the image, and the run reports NOT QUALIFIED. That happened on the first full run here.

The built-in fallback is a last resort and the run warns about it out loud: `0xa9A1BdfA75…` is the
key whose private half is hardcoded in committed scripts in this public repo. It was removed from
every node's faff allow-list on 2026-07-30 and must not go back, so a run that lands on it will be
refused by any real node — and, locally, will diff the golden on `owner` for exactly this reason.

## The qualification node does not publish to Arweave

`spec/fixtures/node-qualify.flat` sets `bundler-ans104: http://127.0.0.1:1`, deliberately dead.

Stock HyperBEAM defaults that opt to `https://up.arweave.net:443`, and with
`scheduler-default-commitment-spec: ans104@1.0` — which the node needs, or aoconnect-shaped spawns
are rejected outright — the scheduler publishes every assignment it writes. A single qualification
run made **260** POSTs to `up.arweave.net` before this was noticed: throwaway test assignments,
signed by an ephemeral container wallet, going to the public network.

It also corrupted the measurements. Each write carried a live 400-500 ms round trip to a third-party
service, inside the numbers the `economics` phase exists to record. Pointing the bundler at a dead
local port stops both: writes still land, nothing is published, and the logs show no retry storm.

Whether assignments *do* reach Arweave is a real question — it is D21, it needs a funded bundler
and a real gateway, and it belongs to a `durability` phase in `--url` mode. It is not something a
throwaway local container should be answering by actually doing it.

## Reading opts back is not `accept: application/json`

Use `/~meta@1.0/info/<key>/serialize~json@1.0`. Under the `accept` header, list-valued opts come
back as `+link` **pointers** whose hashes are not the content, so `faff-allow-list` and
`p4-non-chargable-routes` read as `undefined` — and a perfectly healthy node looks like it silently
dropped its entire access policy. That false positive is what this driver reported on its own first
run. The shapes:

* **scalars** exist only as keys of the top-level info message; `/info/<key>` on its own 500s
* **lists** serialize as `{"1": "0xAbC…"}` for scalar entries and `{"1+link": "<hash>"}` for message
  entries, which have to be fetched per index
* **`serialize~json@1.0` overwrites `device`** with its own name on everything it renders, so the
  p4 entry in `on/request` cannot be found by `device` — it is identified by `pricing-device`

`verify-access-policy.ts` is the only other reader of this surface, and the two are kept in step.

## A trap this found immediately

`.flat` config is parsed as `key: value` per line with **no comment syntax at all**. A `#` line that
happens to contain a colon is loaded as a real opt named after the comment text, and nothing warns.
The first version of `spec/fixtures/node-qualify.flat` carried explanatory comments and the node
duly loaded two junk opts:

```
"# deliberately open"
"# `scheduler-default-commitment-spec` is here because it is not a policy knob"
```

Both read back from `~meta@1.0/info` as though they were configuration. The related hazard for
`config.json` is already known — JSON takes no comments — but that one fails loudly, because JSON
refuses to parse. The flat file accepts silently. `identity` now asserts no loaded opt key begins
with `#`, and the fixture's explanation lives in `node-qualify.flat.md` instead.

## What this does not cover

* **Tier-1** is not driven from here: it is pure Lua and version-insensitive. Tier-2 *is* a phase,
  though it executes in the pinned luerl container rather than in the node — which only means
  anything because `toolchain` asserts that pin equals the luerl the image ships. Run the two
  together or neither.
* **The nginx edge** is environment infrastructure, not image behaviour. It stays in
  `verify-access-policy.ts`.
* **Durability** — whether a bundle actually lands on Arweave — needs a funded bundler and a real
  gateway, so it belongs to a deployed node. When it is added, the probe must be
  `GET arweave.net/raw/<txid>`: `/tx/<id>/offset` and `/tx/<id>/status` look healthy for *failed*
  bundles, because they only reflect header indexing.
* **Cold-boot from Arweave** is not a property of any image we can ship today; see
  `durability-and-recovery.md`.
