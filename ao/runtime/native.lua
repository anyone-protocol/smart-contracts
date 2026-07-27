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
--- STATE IS BASE-ADDRESSABLE (the pilot decision, 2026-07-20). Contract state lives at
--- `base.state` — one source of truth, directly addressable at `now/state/<key>`, no
--- patch device and no projection. Writes mutate `base.state`; reads are pure functions
--- of `base.state` served as views (`now/as/<view>`). Atomic revert is a pointer swap
--- of the pre-handler snapshot — no in-place key-clearing, because nothing outside the
--- runtime holds a live reference to `base.state` (handlers receive it per-call as
--- `ctx.state`). Runtime-owned ACL roles live at `base.acl.roles`.
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

--- CONFIRMED on-device (Tier-3, v0.9-FINAL): on the READ path HyperBEAM serves
--- `base.state` with every map committed as a sub-message. `ao-types`/`device` are
--- consumed by dev_lua on internalize, but `commitments` SURVIVES as a real Lua table
--- entry on every map (base.state itself and each nested map). A view that iterates a
--- state map with `pairs` would then count it (status off-by-one), emit it (scoring/roles
--- leak the blob), or — fatally — use its table VALUE as a key (operators: `out[a]=true`
--- with `a` a commitment table → json.encode 500). We strip these HB-reserved keys at
--- every level so contract views iterate ONLY real entries and keep writing plain `pairs`.
--- Read-only: returns a CLEANED COPY; never mutates the persistent base.state.
--- (On the compute/write path state is clean, so this is a harmless deepcopy there and in
--- the busted/luerl harness — views stay pure functions of a metadata-free state.)
local READ_META = {
  commitments = true, device = true, ['ao-types'] = true, hashpath = true, priv = true,
}
local function stripMeta(v)
  if type(v) ~= 'table' then return v end
  local out = {}
  for k, x in pairs(v) do
    if not (type(k) == 'string' and READ_META[k]) then out[k] = stripMeta(x) end
  end
  return out
end
native.stripMeta = stripMeta

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
-- Section ACL — runtime-owned roles at base.acl.roles (AXIS: ACL)
-- ===========================================================================
--
-- Roles are keyed by committer address (EIP-55 verbatim). `owner` is the process Owner.
-- Centralized here so all contracts share one ACL implementation (was duplicated in
-- every contract's Update-Roles/View-Roles handlers — see native.builtins below).
local function hasRole(from, roleList, base)
  for _, role in ipairs(roleList) do
    if role == 'owner' and from == Owner then
      return true
    else
      local r = base.acl and base.acl.roles and base.acl.roles[role]
      if r and r[from] ~= nil then return true end
    end
  end
  return false
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
      base.acl.roles = base.acl.roles or {}
      local roles = base.acl.roles
      if dto.Grant ~= nil then
        for address, rs in pairs(dto.Grant) do
          for _, role in pairs(rs) do
            roles[role] = roles[role] or {}
            roles[role][address] = true
          end
        end
      end
      if dto.Revoke ~= nil then
        for address, rs in pairs(dto.Revoke) do
          for _, role in pairs(rs) do
            roles[role] = roles[role] or {}
            roles[role][address] = nil
          end
        end
      end
      return 'OK'
    end,
  },
}

-- ===========================================================================
-- Section V — views (AXIS: reads): pure functions of base.state at now/as/<name>
-- ===========================================================================
--
-- `roles` is a runtime-served view (reads base.acl); everything else is a contract view
-- over base.state. Views NEVER touch compute and never mutate — read path only.
function native.view(base, name, params)
  -- Strip read-path HB metadata (`commitments` &c.) once, so every view below iterates a
  -- clean, metadata-free copy of state/acl and never sees the committed sub-message keys.
  local acl   = stripMeta(base.acl) or {}
  -- Cross-cutting, runtime-owned views (available to every contract).
  if name == 'roles' then
    return acl.roles or {}
  end
  if name == 'version' then
    local c = native._contract
    return { runtime = native._version, contract = c and c.name or nil }
  end
  local c = native._contract
  local v = c and c.views and c.views[name]
  if not v then return nil, 'unknown view: ' .. tostring(name) end
  local state = stripMeta(base.state) or {}
  local result = v(state, params)
  -- Enrich the operational `status` view with runtime-owned identity/version so one
  -- GET answers "who owns this, what code is live, is it initialized, and its shape".
  if name == 'status' and type(result) == 'table' then
    result.name = c.name
    -- Owner is a compute-path global (initEnv) and is NIL on the read/view path, so resolve
    -- it from the process message (the spawn committer) the same way initEnv does. Falls back
    -- to the global if base.process is unavailable.
    result.owner = resolveCommitter(base.process) or (Owner ~= '' and Owner or nil)
    result.version = native._version
  end
  return result
end

-- ===========================================================================
-- Section C — compute: infallible trampoline + atomic revert (AXES 3/6)
-- ===========================================================================
--
-- From smoke.lua (verified v0.9-FINAL): any error escaping compute() fails the slot at
-- the node level and PERMANENTLY WEDGES the process. So compute() is nothing but pcalls.
-- Snapshot base.state + base.acl before dispatch; on any error, swap them back (a failed
-- slot never mutates state — the native replacement for legacynet's CU revert).

-- HyperBEAM process/base message keys that a view name would SHADOW on the read path:
-- `now/~lua@5.3a/<name>` resolves `<name>` against the process message FIRST, so if a base
-- key by that name exists it is returned verbatim and the view global is never invoked (the
-- `state` view hit this — it returned the base.state HTML explorer, not the view). Enumerated
-- from a live `now` message (v0.9-FINAL) plus the standard ao/message envelope keys. The
-- collision is SILENT on-device and invisible to Tier-1/2 (no path resolution there), so we
-- reject a colliding view name at register() time — loud at load/spawn, not shadowed in prod.
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

native._contract = nil
function native.register(contract)
  assert(type(contract) == 'table', 'register: contract table required')
  assert(type(contract.state) == 'table', 'register: contract.state table required')
  -- Fail loud on a view name that would be shadowed on the read path (see native.RESERVED)
  -- or that collides with a runtime-owned view. Better a dead process at spawn than a view
  -- that silently returns the wrong thing in production.
  if type(contract.views) == 'table' then
    for name in pairs(contract.views) do
      assert(type(name) == 'string', 'register: view name must be a string')
      assert(not native.RESERVED[name],
        "register: view name '" .. name .. "' collides with a reserved HyperBEAM key "
        .. "(shadowed on the read path) — rename the view")
      assert(name ~= 'roles' and name ~= 'version',
        "register: view name '" .. name .. "' is a runtime-owned view — rename the view")
    end
  end
  native._contract = contract
  native.installViews()
  return contract
end

--- Expose each view as a GLOBAL function `fn(base, req)` so the lua device can serve it at
--- the read path `now/~lua@5.3a/<view>?<params>` (the on-device computed-view mechanism: a
--- global taking the process state `base` + the request `req`). `base` is the whole process
--- state (base.state / base.acl live under it); `req` carries the query params.
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
  local names = { 'roles', 'version' }        -- runtime cross-cutting views
  local c = native._contract
  if c and c.views then for name in pairs(c.views) do names[#names + 1] = name end end
  for _, name in ipairs(names) do
    _G[name] = function(base, req)
      return { body = require('json').encode(native.view(base, name, req) or {}),
               ['content-type'] = 'application/json' }
    end
  end
end

local function snapshotState(base)
  return { state = deepcopy(base.state), acl = deepcopy(base.acl) }
end
local function restoreState(base, snap)
  base.state = snap.state
  base.acl = snap.acl
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
  local timestamp = tonumber(req['timestamp'])

  local ctx = {
    from   = from,
    owner  = Owner,
    action = action,
    tags   = tags,
    data   = body.data,
    timestamp = timestamp,                       -- ms, or nil if unassigned (read path/harness)
    state  = base.state,                         -- the mutable contract state tree
    send   = function(m) table.insert(ao.outbox.Messages, m); return m end,
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
    if b.roles and not hasRole(from, b.roles, base) then error('Permission Denied') end
    return { data = b.handler(ctx, base) or '' }
  end

  -- Contract actions: `action → fn` (or `{ roles, handler }`). No matchspec machinery.
  local c = native._contract
  local a = c and c.actions and c.actions[action]
  if a == nil then
    return { data = 'error: unknown action: ' .. tostring(action) }
  end
  local spec = (type(a) == 'table') and a or { handler = a }
  if spec.roles and not hasRole(from, spec.roles, base) then    -- ACL
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
    if base.state == nil then
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
      base.state = (seed and seed.state)
        or (native._contract and deepcopy(native._contract.state) or {})
      -- ACL roles are migration state too, so they ride the same envelope.
      if seed and type(seed.acl) == 'table' then base.acl = seed.acl end
    end
    -- ACL roles are migration state too: seed them from a module-declared `acl` at spawn,
    -- symmetric with `state` above (migrate-on-spawn -- no runtime bulk-load step). The
    -- luerl-only fixtures (Tier-2/Tier-3 oracles) still use embedded-seed bundles built by
    -- native-bundle.ts buildSeedBundle, which declare `acl` on the contract; the base
    -- contract omits `acl`, so a normal deploy still defaults to an empty role set. See D26.
    if base.acl == nil then
      base.acl = (native._contract and native._contract.acl and deepcopy(native._contract.acl))
        or { roles = {} }
    end
    base.acl.roles = base.acl.roles or {}
  end)

  -- Hand handlers a metadata-CLEAN state, symmetric with the view read path. On every reload
  -- HyperBEAM re-injects `ao-types`/`commitments` onto each nested map; a handler that POINT-reads
  -- (operator-registry) is unaffected, but one that ITERATES a persisted map (relay-rewards
  -- Complete-Round over `Configuration.Modifiers.Uptime.Tiers` / `PendingRounds`) would hit those
  -- metadata keys as data. Strip in place so ctx.state stays the tree we mutate + persist. Done
  -- BEFORE the snapshot so revert restores clean state too. See UPSTREAM-ISSUES A18.
  pcall(function()
    base.state = stripMeta(base.state)
    base.acl   = stripMeta(base.acl)
  end)

  local snapok, snapshot = pcall(snapshotState, base)
  if not snapok then
    base.results = { outbox = {}, output = { data = 'error: snapshot failed: ' .. tostring(snapshot) } }
    return base
  end

  local ok, output = pcall(protectedCompute, base, req)
  if not ok then
    pcall(restoreState, base, snapshot)          -- AXIS 6: revert state + acl
    output = { data = 'error: ' .. tostring(output) }
    pcall(clearOutbox)                           -- discard partial outbox
  end

  pcall(writeResults, base, output)              -- AXIS 5

  -- A16 (CONFIRMED live, v0.9-FINAL): strip the per-slot HB commitment/metadata off the
  -- persisted state maps so the device re-commits the FULL current key set next slot.
  -- Without this, STRING-valued maps (claimable/verified/registrationCredits) silently
  -- drop keys added after the first slot — the map's `commitments.committed` list stays
  -- pinned to slot-1's keys, so every later slot's new key is dropped on persist while the
  -- handler still returns OK (a silent write-loss). Boolean-valued maps (blocked/
  -- verifiedHardware/acl.roles) carry `ao-types` and re-commit fully, so they were immune —
  -- which is why it hid until a string map was grown across slots. See UPSTREAM-ISSUES A16.
  pcall(function()
    base.state = stripMeta(base.state)
    base.acl   = stripMeta(base.acl)
  end)
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
