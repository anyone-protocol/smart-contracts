# Write gate

`runtime/write-gate.lua` decides, before a message is scheduled, whether its signer may write to
a contract. It runs on the node as the `pricing-device` of `p4@1.0`, on the `on/request` and
`on/response` hooks.

A refusal at the gate creates no slot and writes no state. The same message refused by the
contract's own role check would still take a slot and a state write. The gate is a cost filter.
Authority over what a write may do stays with the contract.

The gate depends on the allow-list format of the runtime: the trie id at `allowlistId`, the
reference counts, and the `B<count>` block encoding. Change the two files together. See
[runtime.md](runtime.md#allow-list).

## Configuration

Set on the `p4` hook entry in the node configuration:

| Key | Content |
| --- | --- |
| `gated-processes` | Process ids the gate protects |
| `operator-registry` | Process id of the operator registry |
| `deploy-wallets` | Wallets admitted for any path |

Each key takes a list or a single string.

Anything that targets a process outside `gated-processes` is refused. The node therefore serves
no reads or writes for other processes, and third parties cannot spawn on it.

`deploy-wallets` exists for spawning. A spawn is a `POST /push` with no target process, so there
is no contract and no owner to consult. Keep the list to wallets the protocol controls.

## Decision

For each request, in order:

1. An unsigned request is refused.
2. A request whose every signer is a deploy wallet is admitted.
3. The target contract is found by matching the path prefix `/<process id>~process@1.0`. A
   request with no gated target is refused.
4. Every signer must pass one of:
   - it is the owner of the target process,
   - it is admitted by the target's allow-list,
   - the target is a reward contract and the operator registry's allow-list admits it.
5. A read that fails counts as a refusal.

Details:

- Only committers from real signature commitments count. A commitment without a committer is
  skipped.
- The process id is matched as a prefix and compared with `string.sub`. An id elsewhere in the
  path does not select a contract.
- The owner always passes. It is the spawn committer, which cannot change, so a contract cannot
  be locked by its own allow-list. The owner is derived from the process's spawn commitment,
  because a process has no readable owner field.
- The allow-list is read with `compute`, not `now`. `now` computes to the latest slot first,
  which would make the gate wait behind the target's backlog.
- The allow-list is read as a trie key and not through a view. A trie read does not load the
  process.
- Operators are listed in the operator registry only. `Set-Delegate` on relay rewards and
  `Set-Share` on staking rewards are operator actions, so writes to the reward contracts fall
  through to the registry's list.

An allow-list value admits when it is a non-empty count. An empty string and a value that starts
with `B` refuse.

## Pricing API

| Function | Hook | Returns |
| --- | --- | --- |
| `estimate` | `on/request` | Integer `0` to admit, `infinity` to refuse |
| `price` | `on/response` | Integer `0` |

Return `math.tointeger(0)`, never `0.0`. `p4` matches the integer, and a float is handled as a
charge against a ledger.

## Debugging

| Response | Meaning |
| --- | --- |
| HTTP 400, `Node will not service this request under any circumstances.` | The gate refused the request |
| HTTP 400, `Could not estimate price of request.` | The gate itself failed, for example on a load or runtime error |

Start the node with `HB_PRINT=lua_error,lua` to see the error behind a failure.

The gate runs under luerl. See the device constraints in [runtime.md](runtime.md#device-constraints).
