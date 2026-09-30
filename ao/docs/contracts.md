# Contracts

The three native contracts live in `src/contracts/native/`. Each declares state, actions and
views for the runtime described in [runtime.md](runtime.md). The read surface is documented in
[READING-THE-CONTRACTS.md](READING-THE-CONTRACTS.md).

The contracts in `src/contracts/` are the legacy versions.

## Common rules

| Rule | Detail |
| --- | --- |
| Addresses | Stored as EIP-55. Every address that arrives in a message is validated and canonicalized with `eip55.checksum`. A mixed-case address with a wrong checksum is rejected. `ctx.from` is used as delivered |
| Validation | A handler validates its whole input before it changes state. An error reverts the slot |
| Round keys | `PendingRounds` is keyed by the round timestamp as a string |
| Splitting | Comma-separated lists are split with `utils.split` |
| Integers | Integer tags and counts are parsed with `utils.parseInt` |
| Amounts | Token amounts are integer strings, computed with `common/bigint.lua` |
| Initial state | Supplied as a migration seed on the spawn message. There is no `Init` action |
| Roles | Managed by the runtime's `Update-Roles` action |
| Whole state | Exported by the runtime's `dump` view |

A role-gated action accepts the `owner` role, the `admin` role, and a role named after the
action.

## Shared libraries

| Module | Purpose |
| --- | --- |
| `common/bigint.lua` | Integer type with the operators the reward math uses. It wraps a native integer, which is arbitrary precision on the device. String operands are parsed digit by digit, so no value passes through a float |
| `common/eip55.lua` | Keccak-256 and EIP-55 checksum, using fixed-width bitwise operations only. `checksum` follows `ethers.getAddress`: mixed case must be a valid checksum, single case is accepted |
| `common/utils.lua` | `parseInt` and `split`, written for the device VM |
| `common/acl.lua` | Role helpers for the legacy contracts |

Reward amounts are exact on the device, where integers do not overflow. Under stock Lua 5.3
integers are 64-bit, so reward-scale values are validated in the luerl test tier.

## Operator registry

State root: `OperatorRegistry`.

| Field | Content |
| --- | --- |
| `claimable` | fingerprint to operator address, assigned and not yet claimed |
| `verified` | fingerprint to operator address, claimed |
| `blocked` | operator address to `true` |
| `verifiedHardware` | fingerprint to `true` |
| `registrationCredits` | fingerprint to operator address |
| `registrationCreditsRequired` | boolean |

| Action | Access |
| --- | --- |
| `Admin-Submit-Operator-Certificates` | role |
| `Submit-Fingerprint-Certificate` | any operator with a claimable fingerprint |
| `Renounce-Fingerprint-Certificate` | the operator that holds the fingerprint |
| `Remove-Fingerprint-Certificate` | role |
| `Block-Operator-Address`, `Unblock-Operator-Address` | role |
| `Add-Registration-Credit`, `Remove-Registration-Credit` | role |
| `Add-Verified-Hardware`, `Remove-Verified-Hardware` | role |

Notes:

- Claiming a fingerprint does not remove its registration credit.
- Views return sets as `{ [key] = true }`. A bare Lua array does not serialize on the device.
- The `fingerprints` view takes its ids in the `ids` parameter.
- A query with a malformed address returns an empty result.

### Allow-list

A fingerprint is one reason for its operator to be on the allow-list.

| Event | Effect |
| --- | --- |
| A fingerprint is assigned to an operator | Grant |
| A fingerprint is reassigned to another operator | Revoke for the previous holder, grant for the new one |
| A fingerprint moves from claimable to verified | Revoke and grant for the same address |
| A fingerprint is renounced or removed | Revoke for the holder, read before the entry is cleared |
| An address is blocked | Block, which vetoes the address whatever else it holds |

A claimable fingerprint counts as much as a verified one. An operator's first write is
`Submit-Fingerprint-Certificate` against a claimable fingerprint, so the operator must already
be allowed to write.

## Relay rewards

State root: `RelayRewards`.

| Field | Content |
| --- | --- |
| `Claimed` | address to amount claimed |
| `TotalAddressReward` | address to cumulative reward, after delegation |
| `TotalFingerprintReward` | fingerprint to cumulative reward |
| `Configuration` | Reward configuration, including `TokensPerSecond`, modifiers, multipliers and delegates |
| `PreviousRound` | Summary of the last settled round: `Timestamp`, `Period`, `Summary`, `Configuration`, `Slot` |
| `PreviousRound.DetailsJson` | fingerprint to that relay's line of the last round, as an encoded JSON string |
| `PreviousRound.AddressFingerprints` | operator address to its fingerprints, comma-separated |
| `PendingRounds` | round timestamp to staged scores |

| Action | Access |
| --- | --- |
| `Update-Configuration` | role |
| `Add-Scores` | role |
| `Complete-Round` | role |
| `Cancel-Round` | role |
| `Set-Delegate` | any operator, for its own rewards |
| `Claim-Rewards` | role. The beneficiary is passed as a tag |

A round is staged with one or more `Add-Scores` messages and settled with `Complete-Round`.

### Round details

The per-relay details of a round are reporting data. No contract logic reads them.

- They are stored as one encoded JSON string per fingerprint, so state holds one table of
  strings and a read returns the stored string without encoding.
- `AddressFingerprints` is an index into `DetailsJson`. It lets one read return every relay of
  an operator without storing the details twice.
- `Complete-Round` also returns the whole round, details included, as its output. The output
  declares `content-type: application/json`.
- `PreviousRound.Slot` records the slot of that `Complete-Round`. `0` means no round has
  settled. Check `Timestamp > 0` before following it, because slot 0 is the spawn.

### Address validation in `Add-Scores`

`eip55.checksum` is a keccak and dominates the cost of `Add-Scores`. A round has far fewer
distinct addresses than relays, so two shortcuts apply, in order:

1. An address that is already a key of `TotalAddressReward` is canonical and skips the checksum.
2. Other addresses are checksummed once per distinct string within the call.

An address that is not a string always goes to `eip55.checksum`, which raises the validation
error.

### `last_snapshot`

| Request | Answer |
| --- | --- |
| `as/last_snapshot` | `{ Slot, Timestamp, Period, Path }` |
| `as/last_snapshot?redirect=true` | `302` to the output of the settle slot |
| `as/last_snapshot?redirect=true` before any round has settled | `404` |

- The `Location` is relative, because a view does not know its process id.
- The target is `results/output`, which serves the declared content type.
- The redirect carries the pointer as its body.

## Staking rewards

State root: `StakingRewards`.

| Field | Content |
| --- | --- |
| `Rewarded` | `hodler/operator` to cumulative reward. The operator's own cut is at `operator/operator` |
| `Claimed` | `hodler/operator` to the amount at the last claim |
| `Shares` | operator to share, for operators that set one |
| `PendingShareChanges` | operator to `{ Share, RequestedTimestamp }` |
| `Configuration` | Reward and share configuration |
| `PreviousRound` | The last settled round, including `Details` and `Network` |
| `PendingRounds` | round timestamp to staged scores |

| Action | Access |
| --- | --- |
| `Update-Configuration` | role |
| `Update-Shares-Configuration` | role |
| `Toggle-Feature-Shares` | role |
| `Set-Share` | any operator, when shares are enabled |
| `Add-Scores` | role |
| `Complete-Round` | role |
| `Cancel-Round` | role |
| `Claim-Rewards` | role. The beneficiary is passed as a tag |

### Pair keys

Every reward map is logically keyed by a hodler and an operator. Storage uses one flat map per
field, keyed `hodler .. '/' .. operator`, which keeps the number of live tables fixed. See the
schema rule in [runtime.md](runtime.md#schema-rule).

- Both halves of a key are EIP-55 addresses, which cannot contain `/`.
- `PreviousRound.Details` is stored as parallel maps, one per field, each keyed by the pair.
  Values keep their Lua types.
- Views rebuild the nested `[hodler][operator]` shape, so the read payloads are unchanged by the
  storage layout. `spec/fixtures/staking-view-golden.json` pins them.
- A helper that returns one hodler's entries returns `nil` when there are none.
- `status.counts` counts hodlers, not pairs.
- A hodler with no pairs has no entry. `Claim-Rewards` for such an address fails with
  `No rewards for <address>`.
- Settlement iterates the flat maps, so iteration order differs from the nested form. Every
  accumulation in settlement is exact integer addition, which is order-independent.

### Network counts

`Add-Scores` accepts an optional `Network` map of relay counts per operator:
`{ [operator] = { Expected, Running, Found } }`.

- It is keyed by operator, so it covers operators that have no stake.
- A round without it settles with empty counts.
- The last submission per operator wins.
- Counts are parsed with `parseInt`, because the device decodes a JSON integer as a float.

### Shares

- An operator's share is taken at scoring time: its own share when it set one and shares are
  enabled, otherwise the configured default.
- `Update-Shares-Configuration` validates `Min <= Default <= Max` and clamps every share that
  was already set into the new bounds.
- `Set-Share` queues a change. It takes effect at the first `Complete-Round` after
  `ChangeDelaySeconds` has passed.
- `ChangeDelaySeconds` is in seconds and both timestamps are in milliseconds. The delay is
  converted before the comparison.

The delay compares the request time, which comes from the scheduler's clock, with the round
timestamp, which comes from the controller's clock. The two clocks are independent, so skew
between the hosts shifts the effective delay. Review this before enabling shares.
