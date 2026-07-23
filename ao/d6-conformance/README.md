# D6 — EVM Signature Conformance webapp

Proves that a **real browser wallet** (Rabby, MetaMask, any EIP-1193 provider),
driven through the dashboard's exact signing path, produces an ans104 `ethereum`
signature that a HyperBEAM node recovers to the wallet's EIP-55 address and
accepts — and rejects a tampered one (fail-closed). This is the D6 surface that
can't be tested with a programmatic signer: the injected-wallet signature itself
(D19's `InjectedEthereumSigner` / `window.ethereum` path).

## Why this exists

The Node/`arbundles` `EthereumSigner` path is already proven conformant (every
spawn this session; faff recovers the committer correctly). The **unproven**
variable is the browser wallet: does Rabby/MetaMask, via
`@dha-team/arbundles` `InjectedEthereumSigner`, sign the ans104 deephash as an
EIP-191 `personal_sign` the node recovers correctly? `ao-signer.ts` is a verbatim
mirror of `ator-relay-dashboard/composables/ao-signer.ts` +
`utils/create-ethereum-data-item-signer.ts`, so this tests the real surface.

## How recovery works (pure HTTP — no podman)

Recovery is node-authoritative over plain HTTP, so `HB_URL` can be a local
ephemeral node **or** a remote one (stage/live). Verified against v0.9-FINAL
(`466cf489`):

- The node signature-checks **every** ans104 body at the HTTP door
  (`hb_http:req_to_tabm_singleton` → `ar_bundles:verify_item`); a bad signature
  throws `{invalid_ans104_signature,…}` → HTTP 500. On success it converts to
  `ans104@1.0` form, setting
  `committer = human_id(ar_wallet:to_address(owner, sig_type))`
  (`dev_codec_ans104_from.erl:215-228`) — the EIP-55 `0x` address for `ethereum`.
- `POST /~message@1.0/verify` → `true` (200) or 500 on a bad sig.
- `POST /~message@1.0/committers/1` → the recovered committer (200) or 500.

The server (`/recover`) just proxies those two calls — no container `exec`, no
`Bun.spawn`. NB: a **plain** signed item surfaces the committer; ao
process/message shapes hit `normalize_unsigned` and read back without it (the sig
is still verified at ingest, so `verify=true`). The conformance item is therefore
a plain ans104 item, which isolates exactly what D6 tests — the wallet's ans104
signature and the address the node recovers it to.

## Setup

1. A local ephemeral node reachable at `HB_URL` (or point `HB_URL` at any node):
   ```
   podman run -d --name hb-smoke --network=host -e HB_ALLOW_EPHEMERAL_WALLET=true \
     ghcr.io/memetic-block/hyperbeam-docker:v0.9-FINAL
   ```
2. Start the webapp (from `smart-contracts/ao`):
   ```
   HB_URL=http://localhost:8734 bun run d6-conformance/server.ts
   ```
   Env: `PORT` (default 5173). Only `HB_URL` matters — no container name needed.
3. Open `http://localhost:5173` in a browser with your wallet extension(s). Pick
   the wallet from the **Wallet** dropdown (populated via EIP-6963 — Rabby is
   preselected if present) and click **Run conformance check**. Drive it with
   **Rabby** (the e2e-dev wallet) first; switch the dropdown to MetaMask and any
   others for the matrix.

   Notes:
   - The browser bundle supplies what arbundles expects from Node — the dashboard
     gets these from Nuxt/Vite; a raw Bun bundle must provide them itself:
     - `Buffer`/`process` at runtime via `polyfills.ts` (imported first in
       `app.ts`).
     - `crypto` at bundle time: `server.ts` aliases arbundles' bare
       `import … from "crypto"` to `crypto-shim.ts` (a `createHash` backed by
       `@noble/hashes`, verified byte-identical to Node crypto), and forces
       arbundles' **web** build (the same code the dashboard runs). Proven: the
       web-build + shim signs a byte-identical, node-verifiable ans104 item.
   - A `Cannot redefine property: ethereum` console error is an **extension-level
     collision** between multiple installed wallets, not this app — EIP-6963
     discovery sidesteps it by enumerating each provider explicitly. (Disabling
     the extra wallet extensions also silences it.)

## What it checks (per wallet)

1. plain item — `node sig type` = `ethereum`, `node verify` = `true`,
   `committer === wallet` (recovered EIP-55 address equals the connected wallet)
2. tampered plain item → `verify` = `false` (**fail-closed**)
3. dashboard-shape process-spawn item → accepted (`verify` = `true`); the real
   spawn shape signs and is accepted (committer not surfaced for ao shapes, but
   the sig is verified at ingest)

`CONFORMANT ✓` requires all of the above. The committer is derived by the node
from the owner pubkey and `verify` confirms the signature backs it, so both the
match *and* the verify must hold.

## Status — CLOSED ✓ (2026-07-17)

D6 gate met. The highest-risk migration surface — a real browser wallet's ans104
EVM signature recovering correctly on our node — is proven:

- **In-browser CONFORMANT ✓ with real wallets: Rabby + Phantom.** Both:
  `node sig type=ethereum`, `verify=true`, `committer === wallet` (node-recovered
  EIP-55), malformed → `verify=false`, dashboard-shape spawn accepted. Phantom is
  Solana-first, so its EVM provider is an independent impl → cross-vendor evidence
  for arbitrary-wallet support. Further wallet-specific runs skipped as redundant
  (any EIP-1193 `personal_sign` path exercises the same code).
- Backend also validated with a programmatic EVM signer over the pure-HTTP path
  (plain valid → `{verify:true, committer:0xa9A1…AEcE, sigType:ethereum}`;
  tampered → `{verify:false}`; process-spawn → `{verify:true}`). See
  `../scripts/util/hb-client.ts` for the Node signing path.

### Tails, dispositioned (D6 not held open on them)

- **recovered-bytes ≡ legacynet identity** — DONE. `scripts/validate-address-migration.ts`
  PASSes against real 2026-07-09 state dumps: 1724/1724 addresses byte-preserved
  under EIP-55 normalization, senders cross-match registry operators, malformed
  rejected. Acceptance criterion recorded in `../../docs/hyperbeam-migration/ACCESS-POLICY-private-node.md`.
- **low-s / high-s** — re-homed to `UPSTREAM-ISSUES.md` C3 (node-robustness to
  non-canonical `s`; low risk, no standard wallet emits it).
- **checksummed-vs-lowercase comparison** — removed; EIP-55 enforced everywhere
  (see the EIP-55 decision), one canonical address format.
- **readable signing prompts** (hex/garbled wallet display) — inherent to
  `ethereum`/`personal_sign` (signing a hash); EIP-712 (`typed_ethereum`) would
  fix it but the node can't verify type 7 yet. Filed for later: `UPSTREAM-ISSUES.md` A9.
