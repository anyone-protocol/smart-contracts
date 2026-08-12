--- native.lua — Anyone Protocol NATIVE-SHAPE runtime for the HyperBEAM `lua@5.3a`
--- device (D26). Contracts declare `{ state, actions, views }`; this runtime owns the
--- entire security core and dispatch, so contracts carry only their domain logic.
---
--- D26 — reshape the shell, freeze the core:
---   * The runtime owns (once, centrally): verified-committer identity (Axis 1),
---     trust/authorities (Axis 2), the Eval gate (Axis 3), Owner set-once (Axis 4),
---     the outbox (Axis 5), atomic revert (Axis 6), ACL roles, and action dispatch.
---   * Contracts own only: their state shape, validation asserts, and — for the reward
---     contracts — the economic math, held byte-identical to the bint golden (Axis 7).
---
--- STATE LIVES IN LUA GLOBALS (D31/D32, 2026-08-09 — supersedes the base-addressable pilot
--- decision of 2026-07-20). Contract state lives at `_G[contract.root]`, e.g.
--- `OperatorRegistry`; runtime-owned ACL roles at the `ACL` global, symmetric with `Owner`.
--- Nothing state-shaped is written to the process message any more.
---
--- WHY (all measured — D31 §1, §5a):
---   * writes  682.8 -> 5.4 ms/slot (127x). Per-key content-addressing of ~18k keys per slot
---     was the entire cost; the process message is now results-only.
---   * reads   371 -> 27.6 ms (13x). State is ALREADY live in the VM when a view runs, so
---     view complexity is nearly free (an O(n) scan of 7,932 entries costs ~5 ms).
---   * A16 and A18 CEASE TO EXIST. Both are `dev_lua:decode` corrupting state on its way
---     through the message; state that never enters the message cannot be corrupted by it.
---     All six `stripMeta` calls are gone with them.
---
--- THE COST THAT REPLACES IT — GC. Live state is now marked on every collect, and luerl's
--- mark phase is O(live tables squared) (`luerl_heap.erl` ordsets). The schema rule:
---   `[a][b] = scalar` costs ONE TABLE PER OUTER KEY; `[a .. '/' .. b] = scalar` costs one
---   table total. Never nest in a way that scales with data volume.
--- Measured: opreg 6 live tables, relay 31, staking 3,336 (staking is the flattening debt).
---
--- READS MUST USE `as/<view>`, NOT `now/~lua@5.3a/<view>`. `now` resolves FIRST and hands the
--- lua device a priv-stripped message, so it re-initialises a FRESH VM from the module: the
--- view function exists but every data global is nil. `as/` applies the execution device to
--- the LOADED process, against the restored VM. This is not optional under globals.
---
--- Writes mutate `_G[root]` (handlers receive it per-call as `ctx.state`); reads are pure
--- functions of it served as views (`as/<view>`). Atomic revert is a pointer swap of the
--- pre-handler snapshot — no in-place key-clearing, because nothing outside the runtime holds
--- a live reference to the root.
---
--- ⚠️ WHAT STAYS ON `base`: `allowlistId` (+ the `allowlistTable` fallback and
--- `allowlistSeeded`). The node-side write gate reads `compute/allowlistId/~trie@1.0/<addr>`
--- WITHOUT entering the contract's compute path — it cannot see a global. Moving it would
--- close the gate's only cheap read.
---
--- Relationship to runtime.lua (the legacynet shim): that runtime runs the unmodified
--- contracts byte-for-byte behind a legacynet `msg` adapter and remains the
--- emergency-deploy fallback (its `dist/*-deploy.lua` bundles are luerl-verified). THIS
--- runtime is the D26 quality target. Same D8 safety axes — owned here, not emulated.
---
--- THE ONE INVARIANT: `ctx.from` is the node-verified committer and cannot be forged.
--- Every ACL check, the owner gate, and the eval gate depend on it. `from-process` is
--- NEVER identity (the A11 forgery).

local native = { _version = '0.1.0-native' }

-- ===========================================================================
-- Section U — utilities
-- ===========================================================================

--- Deep copy for the snapshot/restore atomicity model.
local function deepcopy(v)
  if type(v) ~= 'table' then return v end
  local out = {}
  for k, x in pairs(v) do out[k] = deepcopy(x) end
  return out
end
native.deepcopy = deepcopy

--- Integer coercion for ASSIGNMENT fields (`slot`, `timestamp`), which arrive as strings.
---
--- NOT `tonumber`. Under luerl — the VM the node actually runs — `tonumber('7')` returns the
--- FLOAT 7.0, where Lua 5.3 returns the integer 7. Tier-1 therefore cannot see this at all.
--- A float leaks into anything a contract persists or emits from these fields: `tostring` gives
--- '7.0', so a consumer that builds `compute&slot=7.0` from the `last_round` view gets a 404
--- instead of the round Details, and staking's `RequestedTimestamp` would be stored as a float
--- alongside the integers the migration seed carries.
---
--- Mirrors `utils.parseInt` (A12) rather than requiring it: the runtime deliberately has no
--- contract-side dependencies, and this must work before any contract module is loaded.
--- Returns nil for nil, a non-integral number, or anything that is not all digits.
local function toInt(v)
  if type(v) == 'number' then
    if v % 1 ~= 0 then return nil end
    -- Normalize the SUBTYPE via tostring ('7.0' → 7), not string.format or math.tointeger.
    -- luerl rejects an INTEGER argument to a %f directive outright — `string.format('%.0f', 7)`
    -- throws `badarg` there while working fine on 5.3 — and its math table is partial. tostring
    -- is safe on both. Anything tostring renders in exponent form falls through to `v`, which is
    -- already integral: no throw, worst case an unconverted float from a harness. The node only
    -- ever delivers these fields as strings, so that path is defensive only.
    local digits = tostring(v):match('^(%-?%d+)%.?0*$')
    return digits and toInt(digits) or v
  end
  if type(v) ~= 'string' then return nil end
  local a, neg = v, false
  if a:sub(1, 1) == '-' then neg, a = true, a:sub(2) end
  if #a == 0 then return nil end
  local n = 0                             -- integer accumulator: stays integer under both VMs
  for k = 1, #a do
    local b = a:byte(k)
    if b < 48 or b > 57 then return nil end
    n = n * 10 + (b - 48)
  end
  if neg then n = -n end
  return n
end
native.toInt = toInt

-- ===========================================================================
-- Section R — the state root (D31/D32)
-- ===========================================================================
--
-- The contract declares `root = 'OperatorRegistry'`; state lives at that GLOBAL. These two
-- accessors are the ONLY places that name is dereferenced, so `ctx.state` stays the handler
-- API and placement remains a runtime concern (D31 §3 — the seam D26 created).
--
-- There is deliberately no `stripMeta` any more. It existed because state travelled through
-- the process message and `dev_lua:decode` re-injected `commitments`/`ao-types` onto every
-- nested map on each reload (A16/A18). State no longer travels through the message.

--- Name of the global holding contract state. nil until a contract registers.
local ROOT = nil

local function stateRoot()
  return ROOT and _G[ROOT] or nil
end
local function setStateRoot(v)
  if ROOT then _G[ROOT] = v end
end

--- Placement seam. Exported because a TEST HARNESS CANNOT ASSIGN THESE GLOBALS ITSELF.
--- busted runs each spec file under an `_ENV` that PROXIES `_G`: reads fall through, writes
--- stay in the proxy. So `OperatorRegistry = {...}` in a spec is invisible to this module and
--- the runtime keeps seeing nil — silently, with views returning empty rather than erroring.
--- Seed through these instead. (Verified: `_ENV == _G` is false under busted.)
--- The same applies to any consumer that is not this file, including a future restore tool.
native.stateRoot = stateRoot
native.setStateRoot = setStateRoot
function native.acl() return ACL end
function native.setACL(v) ACL = v end

-- ===========================================================================
-- Section 1 — identity: node-verified committer (AXIS 1, basis for 2/3/4/ACL)
-- ===========================================================================
--
-- D8/A1: HyperBEAM's commitment discriminator is `c.type` (NOT `c.alg`, the hyper-aos
-- bug): `rsa-pss-sha512` (RSA) or an ans104 EVM commitment carrying
-- `commitment-device == "ans104@1.0"` + `committer`. D6 proved the node hands us the
-- committer already EIP-55-checksummed. We NEVER treat `from-process` as identity (A11).
--
-- ADDRESS-TYPE-AGNOSTIC: `ctx.from` / role keys are OPAQUE committer strings — this runtime
-- makes no chain assumptions and NEVER canonicalizes them (an Arweave 43-char base64url or
-- Solana base58 committer would be corrupted by an Ethereum checksum). Safe because each type
-- is already canonical here (node → EIP-55 for EVM; base64url/base58 are single-form). Chain-
-- specific validation is a CONTRACT concern (e.g. `.common.eip55` for Ethereum fields). See D26.

local function resolveCommitter(m)
  if type(m) ~= 'table' or type(m.commitments) ~= 'table' then return nil end
  local committer = nil
  for _, c in pairs(m.commitments) do
    -- TODO(verify-live): confirm exact field names on the device (`type`,
    -- `committer`, `commitment-device`) match D6 recovery; add hmac skip.
    if c.type == 'rsa-pss-sha512' then
      committer = c.committer
    elseif c['commitment-device'] == 'ans104@1.0' and c.committer ~= nil then
      committer = c.committer
    end
  end
  return committer
end
native.resolveCommitter = resolveCommitter

-- ===========================================================================
-- Section 2 — trust gate (AXIS 2): explicit authorities, legacynet semantics
-- ===========================================================================
--
-- Legacynet gate (process.lua:383): reject iff From ~= Owner AND not isTrusted, where
-- isTrusted means From or Owner is an explicit authority. A directly-signed message has
-- From == its own Owner (both the message committer), so it passes to ACL. Unauthenticated
-- process pushes (From ~= Owner, not an authority) are rejected. NO from-process trust.

local function includes(list, v)
  if type(list) ~= 'table' then return false end
  for _, x in ipairs(list) do if x == v then return true end end
  return false
end

local function passesGate(from, owner, authorities)
  if from == owner then return true end          -- directly-signed message
  return includes(authorities, from) or includes(authorities, owner)
end

-- ===========================================================================
-- Section 0 — tag folding (title-case KV map the handlers read)
-- ===========================================================================
--
-- CONFIRMED on-device (Tier-3, v0.9-FINAL): the lua device flattens a message's tags
-- into the message body as LOWERCASE keys (e.g. an `Fingerprint-Certificate` tag arrives
-- as `body['fingerprint-certificate']`). Legacynet title-cased tag keys (its `Tab()`), and
-- our contracts read title-case (`msg.Tags['Fingerprint-Certificate']`). So we normalize
-- both shapes — a `body.tags` array (harness / some encoders) AND the flattened lowercase
-- body fields — to Title-Case-With-Hyphens keys, matching what the contracts expect.
local function titleKey(name)
  return (tostring(name):gsub('[^-]+', function(seg)
    return seg:sub(1, 1):upper() .. seg:sub(2)
  end))
end

local function foldTags(body)
  local tags = {}
  -- 1) explicit tags array of {name, value} (busted harness; some device encodings).
  local src = body.tags or body.Tags
  if type(src) == 'table' and src[1] then
    for _, o in ipairs(src) do
      if type(o) == 'table' and o.name then
        local k = titleKey(o.name)
        if tags[k] == nil then tags[k] = o.value end
      end
    end
  end
  -- 2) flattened body fields — the on-device shape (lowercase message keys). Title-case
  --    every string-keyed field; harmless extras (Action/Data/Commitments) never collide
  --    with the specific tag keys the contracts read.
  for k, v in pairs(body) do
    if type(k) == 'string' then
      local tk = titleKey(k)
      if tags[tk] == nil then tags[tk] = v end
    end
  end
  return tags
end

-- ===========================================================================
-- Section 4 — env / Owner set-once (AXIS 4)
-- ===========================================================================
--
-- Legacynet (process.lua:305): Owner set ONCE from the spawn committer, immutable
-- thereafter. Owner is process identity (not part of the atomic contract state).
local function initEnv(base)
  ao = ao or {}
  ao.env = ao.env or {}
  ao.env.Process = ao.env.Process or {}
  if not ao.id then ao.id = base.process and base.process.id or '' end
  if not ao.authorities then
    -- TODO(verify-live): confirm authorities source (base.process.authority string
    -- vs list). Parse comma-separated → list.
    ao.authorities = {}
  end
  if not Owner or Owner == '' then
    Owner = resolveCommitter(base.process) or ''
    -- TODO(verify-live): bind to slot==1 (Process.Id == msg.Id) once slot is readable.
  end
  ao.env.Process.Owner = Owner
  ao.env.Process.Id = ao.id
end

-- ===========================================================================
-- Section ACL — runtime-owned roles at the `ACL` global (AXIS: ACL)
-- ===========================================================================
--
-- Roles are keyed by committer address (EIP-55 verbatim). `owner` is the process Owner.
-- Centralized here so all contracts share one ACL implementation (was duplicated in
-- every contract's Update-Roles/View-Roles handlers — see native.builtins below).
--
-- `ACL` is a global for the same reason state is (D31), and is symmetric with `Owner`, which
-- has been a global since D26. It rides the same snapshot/revert as state.
local function hasRole(from, roleList)
  for _, role in ipairs(roleList) do
    if role == 'owner' and from == Owner then
      return true
    else
      local r = ACL and ACL.roles and ACL.roles[role]
      if r and r[from] ~= nil then return true end
    end
  end
  return false
end

-- ===========================================================================
-- Section AL — allowlist: who may WRITE to this contract (AXIS: ACL)
-- ===========================================================================
--
-- The node-side write gate (`p4@1.0` pricing device) asks ONE question before a message is
-- scheduled: may this address write here? Answering it from contract state is what stops a
-- third party creating unbounded free slots — a rejection at the hook costs no slot and no
-- state write, versus ~445ms and a full slot for an in-contract ACL denial.
--
-- Held as a `~trie@1.0` trie ADDRESSED BY ID, with the id at `base.allowlistId`, so the gate
-- reads `compute/allowlistId/~trie@1.0/<addr>` in ONE request (~22ms measured, vs ~458ms for
-- any view). A trie read never enters the contract's compute path at all — no process load, no
-- VM restore, no Lua.
--
-- ⚠️ `allowlistId` MUST STAY A `base` KEY (D32). Under globals everything else moved off the
-- message, but the gate reads the trie id WITHOUT executing contract code, so it cannot see a
-- Lua global. A global here would leave the gate no cheap read and reopen the DoS hole.
--
-- ⚠️ REFCOUNTS, NOT BOOLEANS. An address can be listed for several independent reasons at once
-- — an ACL role, AND an operator fingerprint, AND being the owner. "Remove when it loses a role"
-- would delist someone who is still an operator and silently lock them out of the contract.
-- Only real transitions count: re-granting a role an address already holds must not increment.
--
-- ⚠️ ONE TRIE WRITE PER SLOT. `dev_trie:do_set/3` deep-commits the WHOLE trie on every `set`, so
-- a handler touching N addresses must not write N times (715ms for a single key at 16k keys;
-- batched amortizes to ~1.1ms/key). Deltas accumulate here during the slot and are flushed once,
-- after the handler succeeds — which also makes the flush atomic with the slot's revert.
native.allowlist = {}

-- Deltas for the slot in flight. nil outside compute so a stray grant() cannot silently
-- accumulate into the next message.
local alPending = nil

-- PURE — the refcount arithmetic, split from persistence on purpose. This is the part with the
-- interesting failure mode, and it must be testable in Tier-1/Tier-2 where there is no node and
-- no `ao.resolve`. Persistence is the `store` seam below.
--- @param current table  addr -> existing count (nil/absent = not listed)
--- @param deltas  table  addr -> signed delta
--- @return table         addr -> new count, or false meaning DELETE
--- @param blocks  table  addr -> true (block) | false (unblock)
function native.allowlist.apply(current, deltas, blocks)
  local out = {}
  -- Existing value parses as `[B]<count>`; the B prefix is the block flag and survives
  -- grant/revoke so unblocking restores the true reason count.
  -- ⚠️ INTEGER-FORMAT every count. Under luerl (the VM the node runs) `tonumber('2')` yields a
  -- FLOAT, so a stored count read back and decremented formats as '1.0', and a block as
  -- 'B2.0'. The gate treats any non-empty value as allowed, so those are not merely ugly: a
  -- count that has gone float can never be brought back to the empty/absent state the delete
  -- path produces. Tier-1 (stock Lua 5.3) cannot see this; Tier-2 caught it.
  local function int(n) return string.format('%d', math.floor(tonumber(n) or 0)) end
  local function parse(v)
    local s = tostring(v or '')
    local blocked = s:sub(1, 1) == 'B'
    return blocked, math.floor(tonumber(blocked and s:sub(2) or s) or 0)
  end
  local touched = {}
  for addr in pairs(deltas or {}) do touched[addr] = true end
  for addr in pairs(blocks or {}) do touched[addr] = true end

  for addr in pairs(touched) do
    local wasBlocked, n = parse(current and current[addr])
    local d = (deltas and deltas[addr]) or 0
    n = n + d
    -- Clamp at zero. A double-revoke is a contract bug, not a reason to carry a negative that
    -- would then need two grants to become visible again.
    if n < 0 then n = 0 end

    local blocked = wasBlocked
    if blocks and blocks[addr] ~= nil then blocked = blocks[addr] end

    if blocked then
      -- Keep the count even at zero: an address can be blocked before it has any reason, and
      -- the flag must survive so a later grant does not silently un-block it.
      out[addr] = 'B' .. int(n)
    elseif n < 1 then
      out[addr] = false
    elseif d ~= 0 or wasBlocked then
      out[addr] = int(n)
    end
  end
  return out
end

-- Persistence seam. The trie store needs `ao.resolve`, which exists only on a real node
-- (Tier-3); Tier-1 clears the `ao` global outright. Rather than let the tested path differ from
-- the running one, both tiers drive the SAME apply() above and differ only here.
local function alIdOf(t)
  if type(t) == 'table' and type(t.commitments) == 'table' then
    for k in pairs(t.commitments) do return k end
  end
end

native.allowlist.store = {
  get = function(base, addr)
    if type(base.allowlistId) ~= 'string' or ao == nil or ao.resolve == nil then
      local tbl = base.allowlistTable
      return tbl and tbl[addr] or nil
    end
    local ok, _st, v = pcall(function()
      return ao.resolve({ 'as', 'trie@1.0', base.allowlistId }, { path = 'get', key = addr })
    end)
    if not ok then return nil end
    return v
  end,
  -- `changes`: addr -> count, or false to delete. ONE resolve for the whole batch.
  setMany = function(base, changes)
    if next(changes) == nil then return end
    -- ⚠️ Written as explicit `if`s, NOT the `cond and x or y` idiom. That idiom silently breaks
    -- when the middle value is nil or false: `(v == false) and nil or tostring(v)` evaluates to
    -- the STRING 'false' on the delete path, and the gate reads any non-empty value as allowed
    -- — so a revoked address would stay allowed. Tier-1 catches it; do not "tidy" this back.
    if ao == nil or ao.resolve == nil then
      base.allowlistTable = base.allowlistTable or {}
      for addr, v in pairs(changes) do
        if v == false then base.allowlistTable[addr] = nil
        else base.allowlistTable[addr] = tostring(v) end
      end
      return
    end
    local req = { path = 'set' }
    for addr, v in pairs(changes) do
      -- Trie values are strings. A deleted key is written as the empty string rather than
      -- removed: `dev_trie` has no delete, and the gate treats '' as absent.
      if v == false then req[addr] = '' else req[addr] = tostring(v) end
    end
    local base2 = (type(base.allowlistId) == 'string')
      and { 'as', 'trie@1.0', base.allowlistId } or { device = 'trie@1.0' }
    local ok, _st, res = pcall(function() return ao.resolve(base2, req) end)
    if ok and type(res) == 'table' then base.allowlistId = alIdOf(res) or base.allowlistId end
  end,
}

-- BLOCKED is a VETO, not a delta. A blocked address may still hold several live reasons to be
-- listed (a role, fingerprints), so decrementing by one would leave it allowed — the exact
-- lockout-in-reverse the refcount exists to prevent, pointed the wrong way. Instead the count is
-- preserved and the value is prefixed 'B', so:
--   * the gate denies on sight, with NO extra read — it already parses this value
--   * unblocking restores the exact prior count, with no need to recount reasons
-- Encoded in the value rather than checked as a separate `state/blocked/<addr>` read so blocking
-- cannot be applied to the allowlist and forgotten in the gate, or vice versa.
local alBlocks = nil    -- addr -> true (block) | false (unblock), for the slot in flight

--- Deny `addr` regardless of how many reasons it holds.
function native.allowlist.block(addr)
  if type(addr) ~= 'string' or addr == '' or alBlocks == nil then return end
  alBlocks[addr] = true
end

--- Lift a block, restoring the address's existing reason count.
function native.allowlist.unblock(addr)
  if type(addr) ~= 'string' or addr == '' or alBlocks == nil then return end
  alBlocks[addr] = false
end

--- Record that `addr` gained one reason to be allowed. Safe to call repeatedly in a slot.
function native.allowlist.grant(addr)
  if type(addr) ~= 'string' or addr == '' or alPending == nil then return end
  alPending[addr] = (alPending[addr] or 0) + 1
end

--- Record that `addr` lost one reason to be allowed.
function native.allowlist.revoke(addr)
  if type(addr) ~= 'string' or addr == '' or alPending == nil then return end
  alPending[addr] = (alPending[addr] or 0) - 1
end

--- Build the initial allowlist from migrated state. Runs once, on the first slot, so a
--- migrated contract is immediately writable by the people who were already entitled to write
--- to it — otherwise every operator is locked out until they happen to trigger a grant.
--- Uses the ordinary delta path, so the whole seed persists in ONE trie write.
function native.allowlist.seed(base)
  if base.allowlistSeeded then return end
  base.allowlistSeeded = true
  -- The process Owner. A compute-path global here, but on the read path the gate derives the
  -- same address from the spawn commitment.
  local owner = resolveCommitter(base.process)
  if owner then native.allowlist.grant(owner) end
  -- Every ACL role holder — our controller/admin wallets.
  for _, holders in pairs((ACL and ACL.roles) or {}) do
    if type(holders) == 'table' then
      for addr in pairs(holders) do native.allowlist.grant(addr) end
    end
  end
  -- Contract-declared writers implied by STATE. Optional: a contract with no state-derived
  -- writers (the reward contracts) simply omits it.
  local c = native._contract
  if c and type(c.writers) == 'function' then
    pcall(c.writers, stateRoot() or {}, {
      allow = native.allowlist.grant,
      block = native.allowlist.block,
    })
  end
end

--- Persist the slot's accumulated deltas. Called once, after the handler succeeds.
function native.allowlist.flush(base)
  if alPending == nil then return end
  if next(alPending) == nil and next(alBlocks or {}) == nil then return end
  local current = {}
  -- Skip the read-back entirely when there is nothing to read. This is not a micro-optimization:
  -- the MIGRATION SEED touches ~830 distinct operator addresses in a single slot, and a
  -- per-address round trip would be ~830 resolves (~16s) to learn that every one of them is
  -- absent. With an empty trie they provably are.
  local empty = (base.allowlistId == nil) and (base.allowlistTable == nil)
  if not empty then
    for addr in pairs(alPending) do current[addr] = native.allowlist.store.get(base, addr) end
    for addr in pairs(alBlocks or {}) do
      if current[addr] == nil then current[addr] = native.allowlist.store.get(base, addr) end
    end
  end
  native.allowlist.store.setMany(
    base, native.allowlist.apply(current, alPending, alBlocks))
end

-- ===========================================================================
-- Section 5 — outbox (AXIS 5): inter-contract sends only
-- ===========================================================================
--
-- Native reads are views (no messages) and native writes reply via the compute output
-- (no `*-Response` messages). The outbox exists only for genuine inter-contract sends
-- (`ctx.send` — used by the reward contracts). Discarded wholesale on handler error.
local function clearOutbox()
  ao.outbox = { Messages = {} }
end

local function writeResults(base, output)
  local outbox = {}
  local msgs = ao.outbox and ao.outbox.Messages or {}
  for i, m in ipairs(msgs) do outbox[tostring(i)] = m end
  base.results = { outbox = outbox, output = output or { data = '' } }
end

-- ===========================================================================
-- Section B — runtime built-ins (centralized security actions)
-- ===========================================================================
--
-- Actions every contract shares, owned once by the runtime. Dispatched before contract
-- actions. Update-Roles was byte-identical across all three contracts; it now lives here.
native.builtins = {
  ['Update-Roles'] = {
    roles = { 'owner', 'admin', 'Update-Roles' },
    handler = function(ctx, base)
      local dto = require('json').decode(ctx.data)
      ACL.roles = ACL.roles or {}
      local roles = ACL.roles
      -- Allowlist refcounts track ACTUAL transitions only. Granting a role the address already
      -- holds must not increment, or the matching revoke leaves a phantom count behind and the
      -- address stays allowed forever.
      if dto.Grant ~= nil then
        for address, rs in pairs(dto.Grant) do
          for _, role in pairs(rs) do
            roles[role] = roles[role] or {}
            if roles[role][address] == nil then
              roles[role][address] = true
              native.allowlist.grant(address)
            end
          end
        end
      end
      if dto.Revoke ~= nil then
        for address, rs in pairs(dto.Revoke) do
          for _, role in pairs(rs) do
            roles[role] = roles[role] or {}
            if roles[role][address] ~= nil then
              roles[role][address] = nil
              native.allowlist.revoke(address)
            end
          end
        end
      end
      return 'OK'
    end,
  },
}

-- ===========================================================================
-- Section V — views (AXIS: reads): pure functions of the state root at as/<name>
-- ===========================================================================
--
-- `roles` and `dump` are runtime-served views; everything else is a contract view over the
-- state root. Views NEVER touch compute and never mutate — read path only.
--
-- ⚠️ RETURN LITTLE. Path segments (`as/<view>/<k>/<k2>`) select AFTER the view is
-- materialized, so addressing into a whole-state view is a trap: measured on the registry
-- seed, `as/one` (targeted) 29.5 ms vs `as/dump/verified/<fp>` 674 ms vs `as/dump` 1,574 ms.
-- Read cost tracks what the view RETURNS, not what the response contains. Doing an O(n) scan
-- inside Lua and returning one row costs ~5 ms; returning the tree costs seconds.
--- State as a view should see it. Falls back to the contract's DECLARED shape while the root
--- is still nil, which is a real state a live process passes through: HyperBEAM computes
--- LAZILY, so a freshly spawned process has run no slot and holds no state until something
--- forces one (a message, or any `now/` read — `as/` alone does NOT drive slot 0).
---
--- Without this fallback the shape of that window is a 500, because a contract view indexes
--- `s.claimable` on nil. That is the worst possible answer: `status` is the liveness probe and
--- the thing deploy tooling polls, so the one moment it is asked "are you alive yet" it would
--- crash instead of saying "yes, empty". Read-only — no view may mutate, so no copy is taken.
local function viewState()
  local root = stateRoot()
  if root ~= nil then return root end
  return (native._contract and native._contract.state) or {}
end

function native.view(base, name, params)
  -- Cross-cutting, runtime-owned views (available to every contract).
  if name == 'roles' then
    return (ACL and ACL.roles) or {}
  end
  if name == 'version' then
    local c = native._contract
    return { runtime = native._version, contract = c and c.name or nil,
             root = ROOT }
  end
  -- RUNTIME-OWNED (D31 §4, D32 §1). Under globals, state is an opaque blob in `priv` with no
  -- HTTP path of its own, so extraction depends on the process's own Lua working. Owning
  -- `dump` here means the admin/seed-diff escape hatch exists regardless of what a contract
  -- declares — a bad deploy that breaks a contract view cannot strand state.
  if name == 'dump' then
    return viewState()
  end
  local c = native._contract
  local v = c and c.views and c.views[name]
  if not v then return nil, 'unknown view: ' .. tostring(name) end
  -- A view MAY return a second value: a response message it wants to control (content-type,
  -- status, any header). Forwarded verbatim to installViews — the runtime's JSON default is a
  -- default, not a mandate. Views that return one value are unaffected.
  local result, response = v(viewState(), params)
  -- Enrich the operational `status` view with runtime-owned identity/version so one
  -- GET answers "who owns this, what code is live, is it initialized, and its shape".
  if name == 'status' and type(result) == 'table' then
    result.name = c.name
    -- Owner is a compute-path global (initEnv) and is NIL on the read/view path, so resolve
    -- it from the process message (the spawn committer) the same way initEnv does. Falls back
    -- to the global if base.process is unavailable.
    result.owner = resolveCommitter(base.process) or (Owner ~= '' and Owner or nil)
    result.version = native._version
    -- Has any slot actually run? Under globals this is NOT inferable from the counts: a
    -- correctly seeded contract and one that has never computed both answer through
    -- viewState(), so an all-zero `counts` is ambiguous. Deploy tooling needs the difference
    -- — it polls this view to know when a spawn has materialized before diffing the seed.
    result.initialized = stateRoot() ~= nil
  end
  return result, response
end

-- ===========================================================================
-- Section C — compute: infallible trampoline + atomic revert (AXES 3/6)
-- ===========================================================================
--
-- From smoke.lua (verified v0.9-FINAL): any error escaping compute() fails the slot at
-- the node level and PERMANENTLY WEDGES the process. So compute() is nothing but pcalls.
-- Snapshot the state root + ACL before dispatch; on any error, swap them back (a failed
-- slot never mutates state — the native replacement for legacynet's CU revert).

-- HyperBEAM process/base message keys that a view name would SHADOW on the read path:
-- `as/<name>` resolves `<name>` against the process message FIRST, so if a base key by that
-- name exists it is returned verbatim and the view global is never invoked (the `state` view
-- hit this — it returned the state HTML explorer, not the view). Enumerated from a live `now`
-- message (v0.9-FINAL) plus the standard ao/message envelope keys. The collision is SILENT
-- on-device and invisible to Tier-1/2 (no path resolution there), so we reject a colliding
-- view name at register() time — loud at load/spawn, not shadowed in prod.
native.RESERVED = {
  -- observed top-level keys of a live `now` message (v0.9-FINAL)
  acl = true, ['at-slot'] = true, authority = true, ['data-protocol'] = true,
  device = true, ['execution-device'] = true, initialized = true, ['input-prefix'] = true,
  module = true, name = true, process = true, ['push-device'] = true, results = true,
  ['scheduler-device'] = true, ['scheduler-location'] = true, state = true, type = true,
  variant = true,
  -- standard ao / message envelope keys (defensive — same read-path shadow risk)
  body = true, data = true, id = true, owner = true, commitments = true, priv = true,
  hashpath = true, snapshot = true, now = true, compute = true, ['ao-types'] = true,
  target = true, anchor = true, slot = true, keyid = true, signature = true,
  committed = true, ['from-process'] = true,
}

-- Globals the RUNTIME itself owns. A contract root named any of these would clobber the
-- runtime the moment state was seeded — `compute` especially, which is the device entrypoint
-- and would take down the process on the first slot. Rejected at register(), not at 3am.
local RUNTIME_GLOBALS = {
  ACL = true, Owner = true, Send = true, ao = true, compute = true, native = true,
  json = true, require = true, _G = true, arg = true,
}

native._contract = nil
function native.register(contract)
  assert(type(contract) == 'table', 'register: contract table required')
  assert(type(contract.state) == 'table', 'register: contract.state table required')
  -- The state root (D31/D32). Declared, never derived from `name`: a silent PascalCase
  -- transform is exactly the kind of guess that lands the wrong global in production.
  assert(type(contract.root) == 'string' and contract.root:match('^%a[%w_]*$'),
    'register: contract.root must be a Lua identifier naming the state global '
    .. "(e.g. 'OperatorRegistry')")
  assert(not RUNTIME_GLOBALS[contract.root],
    "register: contract.root '" .. contract.root .. "' is a runtime-owned global")
  -- Fail loud on a view name that would be shadowed on the read path (see native.RESERVED)
  -- or that collides with a runtime-owned view. Better a dead process at spawn than a view
  -- that silently returns the wrong thing in production.
  if type(contract.views) == 'table' then
    for name in pairs(contract.views) do
      assert(type(name) == 'string', 'register: view name must be a string')
      assert(not native.RESERVED[name],
        "register: view name '" .. name .. "' collides with a reserved HyperBEAM key "
        .. "(shadowed on the read path) — rename the view")
      assert(name ~= 'roles' and name ~= 'version' and name ~= 'dump',
        "register: view name '" .. name .. "' is a runtime-owned view — rename the view")
      -- installViews writes `_G[name]`, so a view named after the root would REPLACE the
      -- state with a function on register.
      assert(name ~= contract.root,
        "register: view name '" .. name .. "' is the state root global — rename the view")
    end
  end
  native._contract = contract
  ROOT = contract.root
  native.installViews()
  return contract
end

--- TEST SEAM ONLY. Clears the state root + ACL so a harness can run each case against a fresh
--- contract. NEVER call this from module scope or from compute: on the read path `as/` restores
--- a VM that already holds live state, and clearing it there would silently empty the process.
function native.reset()
  setStateRoot(nil)
  ACL = nil
end

--- Expose each view as a GLOBAL function `fn(base, req)` so the lua device can serve it at
--- the read path `as/<view>?<params>` (the on-device computed-view mechanism: a global taking
--- the process message `base` + the request `req`). State no longer travels in `base` — the
--- view reads the root global — but the device still passes `base`, and `base.process` is
--- where `status` gets the spawn committer.
---
--- ⚠️ A FUNCTION IS THE ONLY THING `as/` CAN REACH (measured 2026-08-09). `as/<name>` CALLS a
--- Lua global of that name: a global holding a table or a scalar 500s. So a view wrapper is
--- not a serialization convenience under globals, it is the entire read surface — state is
--- unreachable except through one of these.
---
--- The wrapper returns a MESSAGE `{ body = <json string>, ['content-type'] = ... }`, not a
--- Lua table of the data itself. Two reasons:
---   1) The body is a pre-`json.encode`d STRING. If the view returned the raw Lua table,
---      dev_lua content-addresses every nested map into a separate `+link` sub-message, so a
---      consumer GETs `{verified+link, claimable+link, ...}` and must fetch each link — one
---      request no longer bundles the data (it also trips the `is_ordered_list` map-decode).
---      Encoding gives the consumer one fully-inlined blob in a single request.
---   2) A device function's return value IS the response message, so scalar fields become
---      HTTP response headers — CONFIRMED live (Tier-3): `['content-type'] = 'application/json'`
---      makes the node emit `Content-Type: application/json` (and fold it into the response
---      signature). So consumers GET the view BARE (`now/~lua@5.3a/<view>`) — do NOT append
---      `serialize~json@1.0`; the body is already JSON and re-serializing a string 500s.
--- The underlying `native.view` still returns tables, so the spec harness is unaffected.
function native.installViews()
  local names = { 'roles', 'version', 'dump' }   -- runtime cross-cutting views
  local c = native._contract
  if c and c.views then for name in pairs(c.views) do names[#names + 1] = name end end
  for _, name in ipairs(names) do
    _G[name] = function(base, req)
      local v, response = native.view(base, name, req)
      -- The response message the view asked for, if any. A view returning a second value owns
      -- the response: content-type, HTTP status (`status = 302` IS honoured — hb_http reads it
      -- off this message and defaults to 200), Location, any header. Everything below is a
      -- DEFAULT applied only where the view stayed silent.
      local res = type(response) == 'table' and response or {}
      if type(v) == 'string' then
        -- Already encoded by the view — pass through verbatim. This is what lets a contract
        -- hold a large read-only block as ONE pre-encoded JSON string instead of a live Lua
        -- table: nothing to walk on write, nothing to encode on read. Re-encoding here would
        -- turn it into a quoted string literal.
        res.body = v
      elseif res.body == nil then
        res.body = require('json').encode(v or {})
      end
      -- 🚨 Only declare a content-type when there is a body to describe. An EMPTY body carrying
      -- an explicit content-type answers 500 through the nginx edge — and HEAD still returns the
      -- intended status, so it reads as working until a browser GETs it. Verified on hb-dev
      -- 2026-08-12 against a real edge; a direct-to-node request does not reproduce it, which is
      -- why the local Tier-3 check passed. Relevant to any view that answers a bare redirect or
      -- a no-content status.
      if res['content-type'] == nil and res.body ~= nil and res.body ~= '' then
        res['content-type'] = 'application/json'
      end
      return res
    end
  end
end

-- The allowlist rides the same atomic revert as state and acl. `allowlistId` is a top-level
-- base field, so without this a failed slot would leave the allowlist mutated while the state
-- change that justified it was rolled back — an address allowed to write to a contract that has
-- no record of why. `allowlistTable` is the no-node fallback store and reverts with it.
local function snapshotState(base)
  return {
    state = deepcopy(stateRoot()),
    acl = deepcopy(ACL),
    allowlistId = base.allowlistId,
    allowlistTable = deepcopy(base.allowlistTable),
    allowlistSeeded = base.allowlistSeeded,
  }
end
local function restoreState(base, snap)
  setStateRoot(snap.state)
  ACL = snap.acl
  base.allowlistId = snap.allowlistId
  base.allowlistTable = snap.allowlistTable
  base.allowlistSeeded = snap.allowlistSeeded
end

--- Everything fallible for a slot runs here, under the caller's pcall.
local function protectedCompute(base, req)
  initEnv(base)                                  -- AXIS 4 (+ env)
  clearOutbox()

  local body = req.body or {}
  local from = resolveCommitter(body)            -- AXIS 1: verified committer only
  if from == nil then
    return { data = 'error: unsigned or unresolved committer' }
  end
  local owner = from                             -- direct message: Owner == From
  if not passesGate(from, owner, ao.authorities) then   -- AXIS 2
    return { data = 'Message is not trusted.' }
  end

  local tags = foldTags(body)
  local action = body.action or tags['Action']

  -- MESSAGE TIME (ms). The scheduler stamps the ASSIGNMENT (req level, NOT req.body) with
  -- `timestamp` = erlang:system_time(millisecond) — the exact unit legacynet `msg.Timestamp`
  -- used, so contracts that recorded message time port over unchanged (staking-rewards
  -- `Set-Share` → `RequestedTimestamp`).
  --
  -- NEVER source this from `block-timestamp`: that is Arweave block time (unix SECONDS, 1000x
  -- off) and it is literally 0 whenever the node runs `mode: debug` — verified on hb-tier3
  -- (`scripts/probe/timestamp-probe.lua`: timestamp=1784989059945, block-timestamp=0). A 0 here
  -- would permanently satisfy any `requested + delay <= now` gate. hyper-aos maps `os.time` to
  -- `block-timestamp`; we deliberately do not. See D8 "os.time / message time — RESOLVED".
  --
  -- ⚠ PROVENANCE / ORDERING — read before using this for temporal logic. This is the SCHEDULER'S
  -- LOCAL WALL CLOCK ("Note: Local time on the SU, not Arweave" — dev_scheduler_server.erl:231).
  -- It is NOT the data item's timestamp (ANS-104 items carry none, so a sender cannot forge it),
  -- and NOT Arweave block time.
  --   * SAFE: it is committed into the SIGNED assignment, so it is fixed at assignment time and
  --     identical for every CU replaying the schedule → execution stays DETERMINISTIC.
  --   * UNSAFE: it is NOT MONOTONIC. `erlang:system_time` follows the OS clock and an NTP
  --     correction can step it BACKWARDS, and the scheduler performs no ordering validation on
  --     it whatsoever. Two messages' timestamps therefore do not reliably order those messages.
  -- For contract logic that needs a monotonic clock, prefer the round timestamp
  -- (`Tags['Round-Timestamp']`), which the reward contracts enforce strictly increasing via their
  -- backdating assert. Comparing this wall clock against a round timestamp mixes two independent
  -- clocks (SU host vs controller host), so host skew shifts the result — accepted deliberately in
  -- staking-rewards to keep that port faithful to legacynet; see its header.
  -- toInt, not tonumber: see Section U. `or tonumber(...)` keeps the previous behaviour for any
  -- value that is not a plain integer string, so this can only tighten the type, never drop a
  -- timestamp the contracts used to receive.
  local timestamp = toInt(req['timestamp']) or tonumber(req['timestamp'])

  local ctx = {
    from   = from,
    owner  = Owner,
    action = action,
    tags   = tags,
    data   = body.data,
    timestamp = timestamp,                       -- ms, or nil if unassigned (read path/harness)
    -- THIS SLOT's number, for a contract that needs to record where its own output landed
    -- (relay-rewards `Complete-Round` → `PreviousRound.Slot`, so a consumer can fetch the full
    -- round breakdown from `compute&slot=<n>/results/output/data` without Details ever entering
    -- state). Same provenance class as `timestamp`: present on the assignment and INSIDE the
    -- signed commitment (D29 §2), so it is deterministic across replay and not sender-forgeable.
    -- nil off the write path (Tier-1/2 harness), exactly like `timestamp`.
    slot   = toInt(req['slot']),
    state  = stateRoot(),                        -- the mutable contract state tree (_G[root])
    send   = function(m) table.insert(ao.outbox.Messages, m); return m end,
    -- Contract-side allowlist maintenance, for writers implied by STATE rather than by an ACL
    -- role (an operator gaining a verified fingerprint, say). Deltas are batched and flushed
    -- once per slot, so calling these per address inside a loop is cheap and correct.
    allow  = function(addr) native.allowlist.grant(addr) end,
    disallow = function(addr) native.allowlist.revoke(addr) end,
    -- Blocking VETOES regardless of how many reasons the address holds; unblocking restores
    -- the exact prior count. Not a revoke — see native.allowlist.block.
    block  = function(addr) native.allowlist.block(addr) end,
    unblock = function(addr) native.allowlist.unblock(addr) end,
  }

  -- AXIS 3 — Eval built-in: Owner-only, non-empty-identity guard.
  if action == 'Eval' then
    if not (Owner ~= nil and Owner ~= '' and from == Owner) then
      return { data = 'error: Eval is only available to the Owner' }
    end
    local fn, loadErr = load(ctx.data or '', 'eval', 't', _G)
    if not fn then error('eval load error: ' .. tostring(loadErr)) end
    local res = fn()                             -- errors → caller pcall → revert
    return { data = res ~= nil and tostring(res) or '' }
  end

  -- Runtime built-ins (centralized ACL) before contract actions.
  local b = native.builtins[action]
  if b then
    if b.roles and not hasRole(from, b.roles) then error('Permission Denied') end
    return { data = b.handler(ctx, base) or '' }
  end

  -- Contract actions: `action → fn` (or `{ roles, handler }`). No matchspec machinery.
  local c = native._contract
  local a = c and c.actions and c.actions[action]
  if a == nil then
    return { data = 'error: unknown action: ' .. tostring(action) }
  end
  local spec = (type(a) == 'table') and a or { handler = a }
  if spec.roles and not hasRole(from, spec.roles) then          -- ACL
    error('Permission Denied')
  end
  local res = spec.handler(ctx)                  -- mutates ctx.state; may throw → revert
  return { data = res ~= nil and res or '' }
end

--- The trampoline. TRIVIALLY INFALLIBLE by construction.
function native.compute(base, req)
  req = req or {}

  -- Initialize base sub-trees once (idempotent; persists across slots). Done BEFORE the
  -- snapshot so a first-message handler error reverts to the initialized baseline.
  pcall(function()
    if stateRoot() == nil then
      -- MIGRATION SEED, supplied as the SPAWN MESSAGE data so the published module stays
      -- PURE SOURCE. It used to be embedded in the module itself, which meant a json.decode
      -- of the entire dump on EVERY READ -- the module is reloaded into a fresh luerl VM per
      -- read, and `contract.state` is consumed only here, at slot 0, then discarded forever.
      -- Measured on the real registry (~1MB dump): 2.60s/read embedded vs 0.43s seeded at
      -- spawn, with byte-identical resulting state.
      --
      -- Envelope: { ["ao-migration-seed"] = 1, state = {...}, acl = { roles = {...} } }.
      -- Marker-gated so ordinary spawn data is never mistaken for a seed. A MARKED but
      -- malformed seed yields an EMPTY state rather than a half-initialized one; deploy
      -- tooling diffs the spawned state against <contract>-seed.expected.json, so that
      -- fails loudly at deploy instead of going live wrong.
      local seed
      if type(base.data) == 'string' and #base.data > 0 then
        local ok, env = pcall(function() return require('json').decode(base.data) end)
        if ok and type(env) == 'table' and env['ao-migration-seed'] ~= nil then
          seed = (type(env.state) == 'table') and env or { state = {} }
        end
      end
      setStateRoot((seed and seed.state)
        or (native._contract and deepcopy(native._contract.state) or {}))
      -- ACL roles are migration state too, so they ride the same envelope.
      if seed and type(seed.acl) == 'table' then ACL = seed.acl end
    end
    -- ACL roles are migration state too: seed them from a module-declared `acl` at spawn,
    -- symmetric with `state` above (migrate-on-spawn -- no runtime bulk-load step). The
    -- luerl-only fixtures (Tier-2/Tier-3 oracles) still use embedded-seed bundles built by
    -- native-bundle.ts buildSeedBundle, which declare `acl` on the contract; the base
    -- contract omits `acl`, so a normal deploy still defaults to an empty role set. See D26.
    if ACL == nil then
      ACL = (native._contract and native._contract.acl and deepcopy(native._contract.acl))
        or { roles = {} }
    end
    ACL.roles = ACL.roles or {}
  end)

  local snapok, snapshot = pcall(snapshotState, base)
  if not snapok then
    base.results = { outbox = {}, output = { data = 'error: snapshot failed: ' .. tostring(snapshot) } }
    return base
  end

  -- Open a fresh delta set for this slot. Scoped here rather than globally so a grant recorded
  -- by a handler that then throws cannot leak into the next message.
  alPending = {}
  alBlocks = {}
  -- Seed before dispatch so the very first message already sees a populated list, and so the
  -- seed shares that message's single trie write.
  pcall(native.allowlist.seed, base)

  local ok, output = pcall(protectedCompute, base, req)
  if ok then
    -- Persist the slot's allowlist deltas — ONE trie write, after the handler succeeded. A
    -- failure to flush must not fail the slot (the trampoline is infallible by construction),
    -- but it does mean the gate can lag the contract until the next write touches the address.
    local flushed = pcall(native.allowlist.flush, base)
    if not flushed then
      pcall(restoreState, base, snapshot)
      output = { data = 'error: allowlist flush failed' }
      pcall(clearOutbox)
    end
  else
    pcall(restoreState, base, snapshot)          -- AXIS 6: revert state + acl + allowlist
    output = { data = 'error: ' .. tostring(output) }
    pcall(clearOutbox)                           -- discard partial outbox
  end
  alPending = nil
  alBlocks = nil

  pcall(writeResults, base, output)              -- AXIS 5

  -- The A16/A18 `stripMeta` passes that used to sit here are GONE, and not because they were
  -- overhead. Both bugs are `dev_lua:decode` running `normalize_commitments(…, verify)` over
  -- state on its way through the process message: A16 silently dropped keys added to a
  -- string-valued map after slot 1 (the committed key set stayed pinned to slot-1's keys);
  -- A18 re-injected `ao-types`/`commitments` onto every nested map on reload. State no longer
  -- enters the message, so neither mechanism has anything to act on. Do NOT reintroduce a
  -- state key on `base` without bringing them back with it. See UPSTREAM-ISSUES A16/A18.
  return base
end

-- ===========================================================================
-- Section L — install
-- ===========================================================================
--
-- Expose the global surface: `compute` (device entrypoint), `ao`, `Send`. Owner /
-- ao.env.Process are populated on first compute via initEnv.
function native.install()
  compute = native.compute
  ao = ao or {}
  ao.send = function(m) table.insert((ao.outbox or { Messages = {} }).Messages, m); return m end
  Send = Send or ao.send
end

native.install()

return native
