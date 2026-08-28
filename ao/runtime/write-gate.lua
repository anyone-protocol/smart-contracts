--- write-gate.lua — the node-side WRITE GATE for the Anyone Protocol contracts.
---
--- Runs as the `pricing-device` of `p4@1.0` on the `on/request` and `on/response` hooks. It
--- answers one question before a message is scheduled: may this address write to this contract?
--- A refusal here costs 29 ms and NO scheduler slot; the same message rejected by the contract's
--- own ACL costs ~445 ms, a permanent slot, and a full state write. That difference is the whole
--- point — without it any wallet on the internet can grow our processes without bound for free.
---
--- Lives beside runtime/native.lua because it is COUPLED TO ITS ALLOWLIST FORMAT (Section AL):
--- the trie id at `base.allowlistId`, refcounts as integer strings, and the `B<count>` block
--- encoding. If those diverge the gate fails open or shut with nothing to indicate why, so the
--- two files must move together.
---
--- CONFIGURATION — node config. Set on the p4 hook entry:
---   `gated-processes`     list of process ids this gate protects
---   `operator-registry`   the operator-registry id (operators live only there)
---   `deploy-wallets`      our own wallets, admitted for ANY path
--- Anything not named in `gated-processes` is refused, so the node is locked down by
--- construction rather than by remembering to add to a denylist: no free reads or writes for
--- processes we do not run, and no spawning by third parties.
---
--- `deploy-wallets` exists for exactly one reason: SPAWN. A spawn is a bare `POST /push` with no
--- target process, so there is no contract to consult and no Owner to check — the process does
--- not exist yet. A wallet list is the only thing that can authorise it. It is deliberately NOT
--- a general escape hatch for contract writes: those still go through the allowlist, so a
--- compromised deploy wallet cannot quietly gain operator-level write access it would not
--- otherwise have. Keep it to wallets we control.
---
--- ⚠️ Return `math.tointeger(0)` to admit, never `0`. dev_p4's `{ok, 0}` clause matches the
--- Erlang INTEGER; Lua 5.3 distinguishes 0 from 0.0, and a float falls through to the ledger's
--- balance branch — where dev_faff exports no `balance/3` — surfacing as a 500 that looks
--- nothing like a gate decision.
---
--- ⚠️ THREE luerl TRAPS, all of which present identically as HTTP 400 "Could not estimate price
--- of request." — indistinguishable from a legitimate refusal without `HB_PRINT=lua_error,lua`:
---   1. NO `goto`/labels. luerl does not implement them; the module fails to LOAD.
---   2. NO `string.gmatch` with a character class. Raises `badarg` (the A13 family).
---   3. Integer-format every number that becomes a string, or luerl's float arithmetic leaks
---      '1.0' where '1' was meant.
--- Debugging this device without HB_PRINT is guesswork; start there.

local ADMIT = math.tointeger(0)
local REFUSE = 'infinity'

local gate = {}

--- Node-verified committers only. Mirrors native.lua's resolveCommitter: trust the `committer`
--- field on a real signature commitment and nothing self-declared. hmac-sha256 commitments carry
--- no committer and are skipped rather than read as anonymous.
function gate.committersOf(m)
  local out, n = {}, 0
  if type(m) ~= 'table' or type(m.commitments) ~= 'table' then return out, 0 end
  for _, c in pairs(m.commitments) do
    if type(c) == 'table' and c.committer ~= nil then
      local dev = c['commitment-device']
      if dev == 'ans104@1.0' or dev == 'httpsig@1.0' then
        n = n + 1; out[n] = c.committer
      end
    end
  end
  return out, n
end

--- Read the configured id set off the hook message. A list in config.json arrives as a table
--- with integer keys; a single string is accepted too so one-contract nodes need no array.
--- Read a list-valued config key into a set. A list in config.json arrives as a table with
--- integer keys; a bare string is accepted so single-entry config needs no array.
function gate.configuredSet(base, key)
  local out = {}
  local v = base and base[key]
  if type(v) == 'string' then out[v] = true
  elseif type(v) == 'table' then
    for _, id in pairs(v) do if type(id) == 'string' then out[id] = true end end
  end
  return out
end

function gate.configuredIds(base)
  local out = {}
  local v = base and base['gated-processes']
  if type(v) == 'string' then out[v] = true
  elseif type(v) == 'table' then
    for _, id in pairs(v) do if type(id) == 'string' then out[id] = true end end
  end
  return out
end

--- Which gated contract is this request writing to?
---
--- Matched as a PREFIX (`/<id>~process@1.0`), not a substring: an id appearing anywhere else in
--- the path — a query parameter, a nested path segment — must not select a contract, or a
--- crafted path could aim the gate at the wrong allowlist. Compared with `string.sub`, so no
--- pattern engine is involved at all (see trap 2 in the header).
function gate.targetOf(path, ids)
  if type(path) ~= 'string' then return nil end
  for id in pairs(ids) do
    local want = '/' .. id .. '~process@1.0'
    if string.sub(path, 1, #want) == want then return id end
    -- Some callers present the path without its leading slash.
    if string.sub(path, 1, #want - 1) == string.sub(want, 2) then return id end
  end
  return nil
end

--- Is this allowlist value an admission?
--- Refcounts are integer strings. A deleted entry is the EMPTY STRING (dev_trie has no delete),
--- and a blocked address is `B<count>` — the count is preserved so unblocking restores it
--- exactly, and the `B` must read as DENIED however many reasons the address still holds.
function gate.admits(v)
  if type(v) ~= 'string' or v == '' then return false end
  if string.sub(v, 1, 1) == 'B' then return false end
  local n = tonumber(v)
  return n ~= nil and n >= 1
end

--- A resolve that can never take the node down: any failure is a refusal input, not an error.
local function read(path)
  local ok, status, value = pcall(function() return ao.resolve(path) end)
  if not ok then return nil end
  if status ~= 'ok' and status ~= true then return nil end
  return value
end

--- The Owner ALWAYS writes. It is the spawn committer, set once and immutable (native.lua
--- AXIS 4), so it is an INVARIANT OF THE PROCESS — not a list entry that can be revoked, drift,
--- or be lost with an allowlist. That is the whole justification; it does not depend on any
--- deployment sequencing.
---
--- It also makes the gate self-recovering. A contract's allowlist is built on its first compute,
--- so a process that has never computed has none — and more generally, if an allowlist is ever
--- wrong or lost, the gate is the thing standing between us and repairing it. The Owner can
--- always write, so a contract can never be permanently locked by its own gate. (In practice a
--- contract is spawned and exercised long before its id reaches `gated-processes`, so this is a
--- backstop rather than a path we expect to take.)
---
--- `Owner` is not a readable field — `compute/owner` returns 508 "Request creates infinite
--- recursion" and `now/owner` 404s — but a process's ans104 commitment id IS the process id, so
--- the spawn committer needs nothing we do not already have. ~21 ms.
local function isOwner(pid, addr)
  return read(pid .. '~process@1.0/compute/process/commitments/' .. pid .. '/committer') == addr
end

--- One resolve straight into the contract's allowlist trie (~36 ms; a miss costs the same, so
--- there is no timing asymmetry to enumerate the set with).
---
--- `compute`, NEVER `now`. `now` means compute-to-latest, so the gate would block behind the
--- target's own backlog — 14,122 ms with 8 queued writes versus 123 ms — and the attacker
--- controls that backlog, making the gate the bottleneck it exists to prevent. A pinned slot is
--- also rejected: it means interpolating a number into a resolve path, and a malformed path
--- raises an Erlang badarg that pcall cannot catch.
---
--- Not a view: any view on operator-registry costs ~400 ms whatever it returns, because
--- `native.view` materialises all of state before the view body runs (the tiny `roles` view cost
--- 405 ms against 458 ms for `operators` iterating 7,932 entries). A trie read never enters the
--- compute path.
local function listed(pid, addr)
  return gate.admits(read(pid .. '~process@1.0/compute/allowlistId/~trie@1.0/' .. addr))
end

--- p4 pricing API. `infinity` refuses outright and the ledger is never consulted.
function estimate(base, req, opts)
  local request = type(req) == 'table' and req.request or nil
  local signers, n = gate.committersOf(request)

  -- Deny-by-default on unsigned. Deliberately stricter than dev_faff, whose `lists:all` over an
  -- empty signer list is vacuously true — stock faff ADMITS unsigned requests.
  if n == 0 then return 'ok', REFUSE end

  -- Our own wallets pass anywhere, including a spawn, which has no target to check.
  local deploy = gate.configuredSet(base, 'deploy-wallets')
  local allDeploy = true
  for i = 1, n do if not deploy[signers[i]] then allDeploy = false end end
  if allDeploy then return 'ok', ADMIT end

  local ids = gate.configuredIds(base)
  local pid = gate.targetOf(request and (request.path or request['request-path']), ids)
  if not pid then return 'ok', REFUSE end

  local opreg = base and base['operator-registry']
  if type(opreg) ~= 'string' then opreg = nil end

  -- Every signer must pass, matching dev_faff:is_admissible's `lists:all`.
  --
  -- FAIL-CLOSED, and it is not a trade-off: a failed read means the target is unreachable, so
  -- there is nothing to write to anyway. The failure mode to MONITOR rather than design around
  -- is a by-id trie node missing from THIS node's cache while the contract is healthy — a
  -- node-locality issue whose recovery is replay, not opening the gate.
  for i = 1, n do
    local a = signers[i]
    local ok = isOwner(pid, a) or listed(pid, a)
    -- The operator set lives ONLY in operator-registry, but `Set-Delegate` (relay-rewards) and
    -- `Set-Share` (staking-rewards) are operator actions, so writes to the reward contracts fall
    -- through to it. No fallthrough when opreg IS the target — its own list already has them.
    -- Deriving operators from the reward contracts' own state does NOT work: both handlers write
    -- `ctx.from`'s entry with no precondition, so a real operator who has never set a share has
    -- nothing to derive from and would be locked out at first use.
    if not ok and opreg and pid ~= opreg then ok = listed(opreg, a) end
    if not ok then return 'ok', REFUSE end
  end
  return 'ok', ADMIT
end

--- p4 pricing API, `on/response`. Integer 0 short-circuits before the charge, so the ledger is
--- never consulted on the way out either. Without this key dev_p4 falls back to re-running
--- `estimate`, repeating every contract read for nothing.
function price(base, req, opts)
  return 'ok', ADMIT
end

return gate
