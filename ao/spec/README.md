# Contract specs — Tier 1 (busted on Lua 5.3, containerized)

Replaces the old WASM test harness. Specs run the **real contracts on the lean
runtime** (`../runtime/runtime.lua`), driven under Lua 5.3 — luerl's language level.

## Run

```sh
# from smart-contracts/ao/
podman build -t anyone-lua-spec:5.3 spec/
podman run --rm -v "$PWD":/work:Z -w /work anyone-lua-spec:5.3 spec/
```

The image is just the toolchain (Lua 5.3 + busted); specs and sources are mounted
at run time, so editing a spec needs no rebuild.

## Test tiers (see docs/hyperbeam-migration/D8-port-safety-checklist.md)

- **Tier 1 (here): busted on Lua 5.3.** Fast, broad behavioral specs — the
  day-to-day harness. Proves runtime + contract *logic*: adapter/dispatch,
  identity (`msg.From` = verified committer), trust/A11 (forged `from-process`
  cannot impersonate the Owner), atomicity (mid-handler failure reverts managed
  contract globals), unsigned rejection. Does **not** exercise luerl's quirks.
- **Tier 2: containerized luerl** (`luerl/`, luerl **1.3.0** on OTP 27 — the exact
  luerl HyperBEAM v0.9-FINAL vendors, from its `rebar.lock`). Runs our runtime +
  contract through the actual device Lua VM via an escript that loads the modules
  into a luerl state and calls `compute(base, assignment)`. Catches integer
  semantics, the `string.gmatch` gap, and cross-message persistence — no node.

  ```sh
  # from smart-contracts/ao/
  podman build -t anyone-luerl:1.3.0 spec/luerl/
  podman run --rm -v "$PWD":/work:Z -w /work anyone-luerl:1.3.0 \
    run /work /work/spec/luerl/scenarios/operator-registry.lua
  #  → 9 passed, 0 failed
  ```

  operator-registry: **9/9 green** under real luerl. relay-rewards is blocked here
  until the `bint`→native-int port — `require('.bint')(256)` HANGS under luerl
  (A10); that's exactly what the native-int swap fixes, and what unblocks running
  the reward math through this tier.
- **Tier 3: live v0.9-FINAL node.** Only for shape-dependent `verify-live` items:
  exact commitment fields, tag shapes, patch@1.0 read path, real scheduled-slot
  persistence.

## Notes

- Each `it()` reloads a fresh runtime + contract (`freshEnv`) so state — which
  lives in contract globals — is isolated between tests.
- Lua 5.3, not LuaJIT: LuaJIT is 5.1 and would diverge from luerl's 5.3 semantics
  (integers, `//`, `math.type`).

## Native shape (D26) — `runtime/native.lua`

The **native runtime** (`../runtime/native.lua`) is the D26 target: contracts declare
`{ state, actions, views }` and the runtime owns identity/trust/ACL/owner-set-once/
eval/atomicity/dispatch/views. State is base-addressable (`base.state`), so writes land
on `base` and reads are pure `views` (no patch device, no `*-Response` sends). The
legacynet-shim runtime (`../runtime/runtime.lua`) + its `dist/*-deploy.lua` bundles
remain the emergency-deploy fallback.

Pilot = **operator-registry** (`../src/contracts/native/operator-registry.lua`). The specs
have **full behavioral parity** with the legacynet WASM harness
(`../test/spec/contracts/operator-registry.spec.ts`) plus D8 runtime-safety cases. Run from
`smart-contracts/ao/` (use an absolute `-v` source path if your shell's `$PWD` is elsewhere):

```sh
# Tier-1 (busted / Lua 5.3)
podman run --rm -v "$PWD":/work:Z -w /work anyone-lua-spec:5.3 spec/native/
#  → 75 successes / 0 failures

# Tier-2 (luerl 1.3.0) — note the `native` runner mode (the `run` mode is shim-shaped)
podman build -t anyone-luerl:1.3.0 spec/luerl/   # rebuild only if luerl_runner.erl changed
podman run --rm -v "$PWD":/work:Z -w /work anyone-luerl:1.3.0 \
  native /work /work/src/contracts/native/operator-registry.lua \
  /work/spec/luerl/scenarios/native-operator-registry.lua
#  → 124 passed, 0 failed
```

Tier-2 caught **A13** here: luerl 1.3.0's `string.gmatch` throws `bad argument`, so
comma-splitting must use `AnyoneUtils.split` (device-safe) — see docs UPSTREAM-ISSUES.md.
