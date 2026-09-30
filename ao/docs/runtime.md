# Native runtime

`runtime/native.lua` runs the protocol contracts on the HyperBEAM `lua@5.3a` device. A contract
declares its state, actions and views. The runtime owns identity, trust, access control,
atomicity, dispatch and the read surface, so a contract carries only its domain logic.

`runtime/runtime.lua` is the older runtime. It runs the legacy contracts unmodified behind a
message adapter.

## Contract shape

```lua
return {
  name    = 'operator-registry',
  root    = 'OperatorRegistry',
  state   = { ... },
  actions = { ['Some-Action'] = handler, ['Other'] = { roles = { 'admin' }, handler = fn } },
  views   = { status = fn, ... },
}
```

| Field | Meaning |
| --- | --- |
| `name` | Contract name, reported by the `status` and `version` views |
| `root` | Name of the Lua global that holds the state. Declared, never derived from `name` |
| `state` | Initial state shape |
| `actions` | Action name to handler, or to `{ roles, handler }` for a role-gated action |
| `views` | View name to a pure function of state |
| `writers` | Optional function `writers(state, { allow, block })`. Reports the addresses that state implies may write |

`native.register(contract)` rejects at load time:

- a `root` that names a global the runtime owns, such as `compute`,
- a view name listed in `native.RESERVED`, or one the runtime serves itself,
- a view named after the state root.

`native.RESERVED` lists the process message keys that a view name would collide with. `as/<name>`
resolves the name against the process message first, so a view that shares a name with a message
key is never called. The failure is a load error and not a wrong answer at read time.

## State

State lives in the Lua global named by `root`, for example `OperatorRegistry`. The access control
roles live in the `ACL` global, and the process owner in `Owner`. None of it is written to the
process message.

- Handlers receive the state as `ctx.state` and mutate it.
- Views receive it as their first argument and must not mutate it.
- Code outside the runtime reads and replaces the root through `native.stateRoot()` and
  `native.setStateRoot(value)`, and the roles through `native.acl()` and `native.setACL(value)`.

### Schema rule

Every live Lua table is visited on each garbage collection, and the cost grows faster than the
table count. Do not nest tables in a way that scales with data volume.

| Shape | Tables |
| --- | --- |
| `map[a][b] = scalar` | One per outer key |
| `map[a .. '/' .. b] = scalar` | One in total |

### What stays on the process message

`allowlistId`, with its fallback `allowlistTable` and the `allowlistSeeded` flag. The write gate
reads the allow-list without running contract code, so it cannot see a Lua global. See
[write-gate.md](write-gate.md).

Do not put state on the process message. State that travels through the message is re-decoded
on every reload, which drops keys added to a string-valued map after the first slot and adds
metadata keys to nested maps.

## Identity and trust

`ctx.from` is the committer that the node verified. Every role check, the owner check and the
`Eval` check depend on it.

- The committer is read from a signature commitment: an RSA commitment, or an ANS-104 EVM
  commitment that carries `commitment-device` and `committer`.
- `from-process` is never identity. A sender can set it freely.
- The runtime treats committer strings as opaque and does not canonicalize them. The node
  delivers EVM committers EIP-55 checksummed. Validating an address of a specific chain is the
  contract's job, for example with `common/eip55.lua`.
- A message whose sender is not its own owner is accepted only when the sender or the owner is
  an explicit authority of the process. A directly signed message passes to the role check.

The owner is the committer of the spawn message. It is set once and never changes.

## Roles

`ACL.roles` maps a role name to a set of addresses. `owner` is an implicit role held by the
process owner. An action declared with `roles` runs only for a sender that holds one of them.

Built-in actions, available on every contract:

| Action | Roles | Data |
| --- | --- | --- |
| `Update-Roles` | `owner`, `admin`, `Update-Roles` | JSON `{ Grant = { [address] = { role, ... } }, Revoke = { ... } }` |
| `Eval` | owner only | Lua source |

## Handler context

| Field | Content |
| --- | --- |
| `ctx.from` | Verified committer |
| `ctx.owner` | Process owner |
| `ctx.action` | Action name |
| `ctx.tags` | Message tags, keyed Title-Case-With-Hyphens |
| `ctx.data` | Raw message data |
| `ctx.timestamp` | Assignment time in milliseconds, or `nil` outside a scheduled message |
| `ctx.slot` | Slot of this message, or `nil` outside a scheduled message |
| `ctx.state` | The state root |
| `ctx.send(message)` | Queues a message to another process |
| `ctx.allow(address)`, `ctx.disallow(address)` | Adds or removes one reason for the address to be on the allow-list |
| `ctx.block(address)`, `ctx.unblock(address)` | Vetoes the address on the allow-list, or lifts the veto |

A handler returns its output, and optionally a second value with extra keys for its output
message, such as `content-type`.

### Tags

The device delivers a message's tags as lowercase keys on the message body. The runtime folds
them to title case, so a `round-timestamp` tag is read as `ctx.tags['Round-Timestamp']`. Senders
use lowercase tag names.

### Timestamps

`ctx.timestamp` is the `timestamp` field of the assignment: the scheduler's wall clock in
milliseconds at assignment time.

| Property | Detail |
| --- | --- |
| Deterministic | It is inside the signed assignment, so every replay sees the same value |
| Not forgeable by the sender | An ANS-104 item carries no timestamp |
| Not monotonic | The scheduler's clock can be stepped backwards, and the scheduler does not validate order |

For logic that needs a monotonic clock, use the round timestamp, which the reward contracts
require to be strictly increasing.

Do not use `block-timestamp`. It is Arweave block time in seconds, and it is `0` on a node that
runs in debug mode.

### Integers

Under luerl, the VM the node runs, `tonumber('7')` returns the float `7.0`. A float that is
stored or printed renders as `7.0`.

- Parse integer strings with `native.toInt` in the runtime and `utils.parseInt` in contracts.
- Format every number that becomes a string as an integer.
- Stock Lua 5.3 returns an integer here, so only the luerl test tier sees this.

## Atomicity

`compute` runs the handler inside a protected call.

1. The runtime snapshots the state root, the roles and the allow-list fields.
2. The handler runs.
3. On an error, the snapshot is restored, the outbox is discarded, and the slot's output is
   `error: <reason>`.

A failed slot leaves no change. An error that escapes `compute` would stop the process from
computing any further slot, so nothing in `compute` runs outside a protected call.

## Migration seed

A contract's initial state and roles can be supplied as the data of the spawn message:

```lua
{ ['ao-migration-seed'] = 1, state = { ... }, acl = { roles = { ... } } }
```

- The runtime consumes the seed on the first slot only.
- The marker is required, so other spawn data is not read as a seed.
- A marked seed that is malformed yields an empty state. Deploy tooling compares the spawned
  state with the expected seed and fails on a mismatch.
- Carrying the seed on the spawn keeps the published module pure source. A module is loaded
  into a fresh VM for reads, so a seed inside the module would be decoded on every read.

A seeded spawn must reference the module by id, because an inline module occupies the spawn's
data field.

## Views

A view is a pure function `view(state, params)`. The runtime installs each view as a global
function, which the device serves at:

```
/<process id>~process@1.0/as/<view>?<params>
```

- Read through `as/`. A read through `now/~lua@5.3a/` initializes a fresh VM from the module,
  where the state is empty.
- `as/` does not compute slot 0. A process that has never computed answers views from the
  contract's declared state shape. Any `now/` read forces the first compute.
- A parameter must not share its view's name.

### Runtime views

| View | Returns |
| --- | --- |
| `roles` | The role map |
| `version` | Runtime version, contract name and state root |
| `dump` | The whole state |

The runtime owns `dump`, so the whole state can be exported even when a contract's own views
fail. A contract cannot declare a view with that name.

The runtime adds `name`, `owner`, `version` and `initialized` to a contract's `status` view.
`initialized` is false for a process that has never computed. The counts cannot show that,
because an empty contract and a process that never computed both report zero.

### Responses

- The response body is the view's result encoded as JSON, with `content-type: application/json`.
- A view that returns a string has it passed through unchanged. A contract can store a
  pre-encoded JSON string and serve it without encoding on read.
- A view can return a second value, a response message, to set the status, `content-type`,
  `Location` or any other header. A `status` of `302` is honored.
- A content type is declared only when the body is non-empty. An empty body with a content type
  fails at the HTTP edge.
- An empty table encodes as `[]`.

### Cost

The cost of a read follows what the view returns. Path segments after the view name select from
the result after the whole view has been built, so addressing into `dump` costs as much as
`dump`. Scan inside the view and return the rows that were asked for.

## Handler output

The output of a slot is readable at `compute&slot=<n>/results/output`.

- Keys from a handler's second return value, such as `content-type`, apply to
  `results/output`.
- `results/output/data` returns the same bytes without the declared content type.

## Allow-list

The allow-list records who may write to a contract. It is a trie addressed by id, with the id
at `allowlistId` on the process message.

| Rule | Reason |
| --- | --- |
| Values are reference counts | An address can be listed for several reasons at once: a role, a fingerprint, being the owner. Removing one reason must not remove the others |
| Only real transitions count | Granting a role the address already holds does not increment |
| One trie write per slot | A trie write commits the whole trie. Changes accumulate during the slot and are flushed once, after the handler succeeds |
| The flush is part of the slot | A failed slot reverts the allow-list with the state |
| A failed trie write does not fail the slot | The gate can lag the contract until the next write touches the address |

Value format:

| Value | Meaning |
| --- | --- |
| `<count>` | Allowed, with that many reasons |
| `B<count>` | Blocked. The count is kept, so lifting the block restores it |
| empty string | Not listed. The trie has no delete |

A block is a veto and not a decrement. A blocked address can still hold several reasons, so
decrementing would leave it allowed.

On the first slot the runtime seeds the allow-list from the owner, every role holder, and the
contract's `writers` function. A migrated contract is then writable at once by everyone its
state entitles to write.

`native.allowlist.apply(current, deltas, blocks)` is the pure reference count arithmetic.
`native.allowlist.store` is the persistence layer. It needs `ao.resolve`, which exists on a
node only, and falls back to a plain table elsewhere.

## Testing hooks

| Function | Use |
| --- | --- |
| `native.setStateRoot(value)`, `native.setACL(value)` | Seed state in a test. A spec cannot assign the globals itself, because busted runs each file in an environment that proxies `_G` |
| `native.reset()` | Clears the state root and roles between cases. Never call it from module scope or from `compute` |

## Device constraints

The device VM is luerl. It differs from stock Lua 5.3 in ways that only the luerl test tier and
a live node can show:

| Constraint | Practice |
| --- | --- |
| `tonumber` returns a float for an integer string | Use `toInt` or `parseInt` |
| `string.gmatch` with a character class raises an error | Split with plain `string.find`. See `utils.split` |
| `string.format('%.0f', integer)` raises an error | Normalize through `tostring` |
| `goto` and labels are not implemented | Do not use them |
| A large positive integer as a table key is treated as an array index | Key by the string form, for example `tostring(timestamp)` |
| Integers are arbitrary precision | Token-scale integer math is exact. Under stock Lua 5.3 it overflows at 64 bits |
