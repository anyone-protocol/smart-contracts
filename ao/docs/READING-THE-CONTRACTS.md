# Reading the protocol processes

How to query the Anyone Protocol processes running on HyperBEAM. Written for integrators: what the
endpoints are, what they take, what comes back, and the handful of behaviours that are easy to get
wrong.

The three processes are `operator-registry`, `relay-rewards` and `staking-rewards`. Each one is an
AO process running the native Lua device. Reads are plain HTTP GETs and need no signature, no SDK
and no wallet.

## The one URL shape

```
https://<node>/<process-id>~process@1.0/as/<view>?<params>
```

For example, against stage:

```
curl 'https://hb-stage.anyone.tech/2p2aXwksN1kLc_mbl2jWrfdmKw9tHD_PYR5-ZHWEPyc~process@1.0/as/status'
```

Everything a consumer needs is under `as/`. Three things to know about it:

* **Use `as/`, not `now/`.** `now/` means "compute forward to the latest message before answering",
  so it pays for any outstanding work and gets slower as the process grows. `as/` serves a named
  view over current state and is the supported read path.
* **Views are named and fixed.** You cannot pass arbitrary Lua or ask for arbitrary state paths.
  The full list is below.
* **Responses are JSON** and carry `content-type: application/json`. They are also signed by the
  node, which is what lets you verify a response came from the process rather than a proxy.

### Process ids

Process ids are not stable across redeploys: deploying spawns a fresh process and publishes its new
id. Take the current ids from whoever runs the deployment rather than hardcoding them, and expect
them to change at a migration or redeploy. A stale id does not silently serve old data, it stops
being reachable, because the public edge only routes the current ids.

## operator-registry

| view | params | returns |
| --- | --- | --- |
| `status` | none | counts, owner, version, whether registration credits are required |
| `operator` | `address` | one operator: verified and claimable fingerprints, hardware, credits, blocked |
| `operators` | none | every operator address with its fingerprint counts |
| `fingerprints` | `ids` (comma separated) | per fingerprint, whether it is hardware verified |
| `scoring` | none | the scoring configuration |

```
as/operator?address=0x03d3A2b237106b228f2d6307fF33c6b2F3448E38
as/fingerprints?ids=ABC...,DEF...
```

## relay-rewards

| view | params | returns |
| --- | --- | --- |
| `status` | none | counts, owner, `tokensPerSecond`, `lastRoundTimestamp` |
| `rewards` | `fingerprint` or `address` | total accrued reward for that relay or operator |
| `claimed` | `address` | what that operator has already claimed |
| `delegate` | `address` | the configured delegate, if any |
| `last_round` | none | summary of the most recently settled round |
| `last_round_details` | `fingerprint` or `address` | that relay's or operator's line from the last round |
| `last_snapshot` | `redirect` (optional) | pointer to the full round, see below |

## staking-rewards

| view | params | returns |
| --- | --- | --- |
| `status` | none | counts, owner, `runningRequirement`, `lastRoundTimestamp` |
| `rewards` | `address` | accrued staking reward |
| `claimed` | `address` | what has already been claimed |
| `shares` | `address` (optional) | configured shares |
| `last_round` | none | summary of the most recently settled round |
| `last_round_data` | `address` | that hodler's line from the last round |
| `last_snapshot` | none | the full round, including per operator relay counts |

## Runtime views, available on all three

| view | returns |
| --- | --- |
| `roles` | the ACL: which address holds which role |
| `version` | contract name, state root, runtime version |
| `dump` | the entire state |

`as/dump` is genuinely the whole state and can be megabytes. It is useful for debugging and a poor
choice for anything on a request path.

## Addresses: the one trap worth reading twice

Address parameters are canonicalised to EIP-55 for you, so **lowercase and uppercase both work**:

```
as/operator?address=0x03d3a2b237106b228f2d6307ff33c6b2f3448e38   works
as/operator?address=0X03D3A2B237106B228F2D6307FF33C6B2F3448E38   works
```

But a **mixed case address whose checksum is invalid returns HTTP 200 with an empty result**, not an
error:

```
as/operator?address=0x03D3a2B237106b228f2d6307fF33c6b2F3448E38   ->  200  []
```

That reads exactly like "this operator has no data", which is why it is worth calling out. If you
are assembling addresses by hand or concatenating them from mixed sources, send them lowercase. If
you are passing through a checksummed address from a wallet or an explorer, pass it unmodified.
Never upper or lower case only part of an address.

## Fetching a whole round

`last_snapshot` on relay-rewards returns a small pointer rather than the full round:

```json
{"Path":"compute&slot=1010/results/output","Period":900,"Slot":1010,"Timestamp":1787063169030}
```

Follow `Path` relative to the process to get the round itself. Or let the node do it by asking for a
redirect:

```
curl -L 'https://<node>/<pid>~process@1.0/as/last_snapshot?redirect=true'
```

That answers `302` with a `Location` pointing at the settled slot, and following it returns the full
round. The pointer exists because a whole round is large (tens of kilobytes on stage, megabytes at
live relay counts), so most consumers should use `last_round_details?address=` or `?fingerprint=` and
fetch only the line they need.

## What is free, and what is not

**All reads described here are free and unauthenticated.** No wallet, no signature, no rate plan.

**Writes are gated.** Requests to `push` and `schedule` are checked against an on chain allow list
before they are scheduled, and a request from an address that is not permitted is refused before it
consumes any resources. This protects the processes from having their state grown by third parties.
Reads are deliberately outside that gate.

If you are writing rather than reading, you need a signed message from an address the process
recognises, which for operators means being registered in `operator-registry`. Use the
`@anyone-protocol/ao-client` package rather than assembling messages by hand.

## Response notes

* An empty result serialises as `[]`, not `{}` or `null`. Iterating it is safe and yields nothing.
* Sets serialise as objects keyed by member, not as arrays.
* Numbers that represent token amounts are strings, because they exceed what a JSON number can hold
  exactly. Parse them as big integers, never as floats.
* Views answer from current state. Two views fetched in separate requests can straddle a settled
  round, so if you need a consistent pair, prefer a single view that returns both.

## Verifying independently

Every message and assignment these processes handle is published to Arweave, so the full history is
public and any round can be recomputed without our node. You can browse a process at:

```
https://lunar.arweave.net/#/explorer/<process-id>/info
```

That resolves history from Arweave directly and needs no access to our infrastructure.
