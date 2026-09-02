# node-qualify.flat

Node config for the FUNCTIONAL phases of `scripts/qualify-node.ts` (smoke, verticals, golden,
economics, restore).

**This file has no comments, and must not gain any.** `.flat` is parsed as `key: value` per line,
with no comment syntax at all — so any `#` line containing a colon is loaded as a real opt named
after the comment text. Measured on the v0.9-FINAL release image, 2026-08-26: a two-comment
version of this file produced two junk opts,

    "# deliberately open"
    "# `scheduler-default-commitment-spec` is here because it is not a policy knob"

both of which read back from `~meta@1.0/info` as though they were configuration. Nothing warns.
The same hazard is already recorded for `config.json` (JSON takes no comments), but the flat file
fails differently and more quietly: JSON refuses to parse, flat happily accepts. `qualify-node.ts`
now asserts no loaded opt key starts with `#`, so a reintroduced comment fails the run.

Everything explanatory therefore lives here instead:

* **Deliberately OPEN** — no faff allow-list, no p4, no rate limit. Those belong to the `config`
  phase, which boots a separate container against `node-qualify-policy.json` and only asks whether
  the opts read back. Mixing the two would mean every throwaway probe signer needs allow-listing,
  and a forgotten entry would read as a contract failure rather than a config one.
* **`scheduler-default-commitment-spec`** is not a policy knob. With the stock `httpsig@1.0`
  default, an aoconnect-shaped ans104 spawn is rejected outright with `process_not_verified`, so a
  node without it cannot run any vertical at all. Same value `config.release.flat` ships and the
  jobspecs set (D21).
* **`bundler-ans104: http://127.0.0.1:1`** is deliberately DEAD. Stock defaults it to
  `https://up.arweave.net:443`, and because the scheduler commitment spec above is `ans104@1.0`,
  the node publishes every assignment it writes. One qualification run made **260** POSTs to
  `up.arweave.net` — throwaway test assignments from an ephemeral container wallet, on the public
  network — and put a live 400-500 ms third-party round trip inside every measured write. With the
  bundler pointed at a closed local port, writes still land, nothing is published, and the node
  logs no retries. Whether assignments really reach Arweave is D21's question and needs a funded
  bundler, so it belongs to a `--url` durability phase, not to a throwaway container.
* **`port: 8734`** is the in-container port; the driver publishes it to the host on `--port`
  (default 8735) so a qualification run never collides with a local dev node on 8734.
