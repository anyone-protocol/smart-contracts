--- runtime.lua — Anyone Protocol lean AO runtime for the HyperBEAM `lua@5.3a` device.
---
--- STATUS: SKELETON / DESIGN (2026-07-18). NOT tested end-to-end. Safety-critical
--- sections (identity, trust, atomicity, the msg adapter) are written for real;
--- shape-dependent sections carry TODO(verify-live) / TODO(conformance) markers.
---
--- WHY THIS EXISTS (D7 posture refinement + D8 safety diff):
---   We do NOT fork hyper-aos. We own a minimal runtime written straight to the
---   native device, providing ONLY the AO semantics our contracts depend on — the
---   four axes below, done correctly — and expose the legacynet `msg` shape via a
---   thin adapter so the ~166-assert contracts run byte-for-byte and audited.
---
--- PROVENANCE (two proven references, bracketing what we build):
---   * Bottom — device trampoline + atomicity: ao-test/lua/smoke.lua, verified
---     against hyperbeam v0.9-FINAL. compute(base, assignment, opts); the returned
---     `base` IS process state (path-addressable over HTTP, no patch device needed).
---   * Top — the msg interface (INTERFACE reference only, NOT device-proven):
---     hyperengine/src/lua/runtime.lua (targeted legacynet aos) and our three
---     contracts, all written to legacynet shape: msg.From / msg.Tags[...] /
---     msg.Data / Send{Target=msg.From} / Handlers.utils.hasMatchingTag /
---     ao.env.Process.Owner / ACL by msg.From. This runtime is the substrate that
---     lets such modules run on the Lua device — it is generic + contract-agnostic
---     by design, so the same layer can host both our contracts and a future
---     device-updated hyperengine (a candidate OSS lib).
---
--- THE ONE INVARIANT THE PORT MUST REPRODUCE EXACTLY:
---   `msg.From` is the node-verified committer address and cannot be forged.
---   Every ACL check, the owner gate, and every reply target depends on it.
---   Corollary (EIP-55-everywhere): From and ao.env.Process.Owner MUST be the same
---   representation (both the node's committer verbatim) so `==` comparisons hold.
---
--- AXES (see docs/hyperbeam-migration/D8-port-safety-checklist.md):
---   0 shape/identity injection · 1 From/Owner derivation · 2 trust/authorities
---   3 eval gating · 4 owner set-once · 5 outbox/send · 6 atomicity · 7 native ints

local runtime = { _version = "0.0.1-skeleton" }

-- ===========================================================================
-- Section U — small utilities (own; vendor json/stringify as pinned leaf deps)
-- ===========================================================================

--- Deep copy for the snapshot/restore atomicity model (from smoke.lua).
local function deepcopy(v)
  if type(v) ~= 'table' then return v end
  local out = {}
  for k, x in pairs(v) do out[k] = deepcopy(x) end
  return out
end

--- AXIS 6 — managed state roots. Contracts keep state in globals / module tables
--- (e.g. `OperatorRegistry`, `ACLUtils.State`), NOT in base.state. Legacynet
--- reverted the whole process memory image on error (the CU discarded it); we
--- replicate that faithfully by snapshotting each registered state root and, on
--- failure, restoring it **in place** — same table object, since contract code
--- and closures hold live references to it.
--- TODO(port): decide the registration convention (contract declares its roots,
--- or a module self-registers via runtime.manage on load).
--- TODO(verify-live): confirm luerl persists globals AND require()'d module state
--- across computes — the whole model assumes state survives between messages.
runtime._stateRoots = {}
function runtime.manage(t)
  assert(type(t) == 'table', 'manage: table required')
  runtime._stateRoots[#runtime._stateRoots + 1] = t
  return t
end
local function snapshotState(base)
  local snap = { base_state = deepcopy(base.state), roots = {} }
  for i, t in ipairs(runtime._stateRoots) do snap.roots[i] = deepcopy(t) end
  return snap
end
local function restoreState(base, snap)
  base.state = snap.base_state
  for i, t in ipairs(runtime._stateRoots) do
    for k in pairs(t) do t[k] = nil end
    for k, v in pairs(snap.roots[i]) do t[k] = v end
  end
end

--- AXIS 7 — exact string→integer parse. `tonumber("<big decimal>")` returns a
--- lossy float under luerl; digit-fold is bit-exact for native luerl integers.
--- Serialize the inverse with tostring (exact for integers). Contracts parse
--- string token amounts, so every such parse routes through here.
local function strToInt(s)
  assert(type(s) == 'string' and #s > 0, 'strToInt: non-empty string required')
  local neg, i = false, 1
  if s:byte(1) == 45 then neg, i = true, 2 end -- '-'
  local n = 0
  for j = i, #s do
    local b = s:byte(j)
    assert(b >= 48 and b <= 57, 'strToInt: non-digit in "' .. s .. '"')
    n = n * 10 + (b - 48)
  end
  if neg then n = -n end
  return n
end
runtime.strToInt = strToInt

-- json/stringify: pinned leaf deps (vendored), NOT forked from aos. Required
-- lazily at call sites so runtime load order is independent of dep load order.

-- ===========================================================================
-- Section 1 — identity: node-verified committer (AXES 1, and basis for 2/3/4)
-- ===========================================================================
--
-- D8/A1: HyperBEAM's commitment discriminator is `c.type` (NOT `c.alg`, which is
-- the hyper-aos bug), values `rsa-pss-sha512` (RSA) or an ans104 EVM commitment
-- carrying `commitment-device == "ans104@1.0"` + `committer`. D6 proved the node
-- hands us the committer already EIP-55-checksummed. We NEVER treat an
-- unauthenticated `from-process` field as identity (that is the A11 forgery).

--- Resolve the single verified committer address of a message/process table.
--- @param m table  a message body or process table with a `commitments` map
--- @return string|nil  committer address (EIP-55 EVM or RSA), or nil if unsigned
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
runtime.resolveCommitter = resolveCommitter

-- ===========================================================================
-- Section 2 — trust gate (AXIS 2): explicit authorities, legacynet semantics
-- ===========================================================================
--
-- Legacynet ao.isTrusted (process/ao.lua:422): trusted iff From or Owner is in
-- the explicit authorities list. Gate (process/process.lua:383):
--   if msg.From ~= msg.Owner and not isTrusted then reject.
-- Direct signed user messages (From==Owner) pass to handler-level ACL;
-- unauthenticated process pushes are rejected. NO from-process trust.

local function includes(list, v)
  if type(list) ~= 'table' then return false end
  for _, x in ipairs(list) do if x == v then return true end end
  return false
end

--- @return boolean trusted
local function isTrusted(from, owner, authorities)
  return includes(authorities, from) or includes(authorities, owner)
end

--- The top-level gate. Returns true if the message may reach handlers.
local function passesGate(from, owner, authorities)
  if from == owner then return true end          -- direct signed message
  return isTrusted(from, owner, authorities)      -- else must be an authority
end

-- ===========================================================================
-- Section 3 — env / owner set-once (AXIS 4)
-- ===========================================================================
--
-- Legacynet (process/process.lua:305): Owner set ONCE, only on the spawn message
-- (Process.Id == msg.Id), only if unset; immutable thereafter. hyper-aos left the
-- spawn/slot guard as a commented TODO — we implement it.

local function initEnv(base)
  -- Persist across slots via lowercase globals (device convention).
  ao = ao or {}
  ao.env = ao.env or {}
  ao.env.Process = ao.env.Process or {}

  if not ao.id then ao.id = base.process and base.process.id or '' end
  if not ao.authorities then
    -- TODO(verify-live): confirm authorities source on the device
    -- (base.process.authority string vs list). Parse comma-separated → list.
    ao.authorities = {}
  end

  -- Owner: set once from the process's own signed committer.
  if not Owner or Owner == '' then
    Owner = resolveCommitter(base.process) or ''
    -- TODO(verify-live): bind to first message / slot==1 (Process.Id == msg.Id)
    -- as the legacynet guard does, once we confirm slot is readable here.
  end
  ao.env.Process.Owner = Owner
  ao.env.Process.Id = ao.id
end

-- ===========================================================================
-- Section 0 — the msg adapter (AXIS 0): (base, assignment) → legacynet msg
-- ===========================================================================
--
-- The load-bearing shim. Hands each handler EXACTLY the flat surface the
-- contracts consume: From, Owner, Id, Action, Tags (title-case KV), Data, plus
-- reply/forward. From/Owner are the node-verified committer (Section 1), never
-- from-process. Keeping this ~one function is the whole point of not forking.

--- Fold the device's tag representation into a title-case key→value table.
--- TODO(verify-live): confirm the on-device tag shape (array of {name,value}
--- vs a lowercased map). This mirrors legacynet Tab() (process.lua:146) + the
--- title-case normalize; pin exact behavior in the conformance suite.
local function foldTags(body)
  local tags = {}
  local src = body.tags or body.Tags
  if type(src) == 'table' then
    for _, o in ipairs(src) do
      if o.name and tags[o.name] == nil then tags[o.name] = o.value end
    end
    -- also accept an already-mapped form
    if not src[1] then
      for k, v in pairs(src) do if tags[k] == nil then tags[k] = v end end
    end
  end
  return tags
end

--- Build the flat, node-authenticated msg the handlers were written against.
local function buildMsg(base, assignment)
  local json = require('json')
  local body = assignment.body or {}
  local from = resolveCommitter(body)          -- AXIS 1: verified committer only
  local owner = from                            -- direct message: Owner == From
  local tags = foldTags(body)

  local msg = {
    From    = from,
    Owner   = owner,
    Id      = body.id,
    Tags    = tags,
    Action  = body.action or tags['Action'],
    -- Content-Type application/json magic-table decode (legacynet parity).
    -- TODO(conformance): pin against process.lua:360-362.
    Data    = (tags['Content-Type'] == 'application/json')
                and (function() local ok, d = pcall(json.decode, body.data or '{}'); return ok and d or body.data end)()
                or body.data,
    Timestamp = body['block-timestamp'] and strToInt(tostring(body['block-timestamp'])) or nil,
  }

  -- reply/forward: contracts use Send{Target=msg.From,...}; reply is convenience.
  -- TODO(conformance): pin reply/forward + X-Reference/X-Origin vs process.lua:421-450.
  msg.reply = function(out)
    out.Target = out.Target or msg.From
    out['X-Reference'] = msg.Tags and msg.Tags['Reference'] or nil
    return runtime.send(out)
  end

  return msg
end

-- ===========================================================================
-- Section H — handlers (lean; legacynet dispatch semantics)
-- ===========================================================================
--
-- Reproduce ONLY what our contracts use: add + hasMatchingTag(Action) matchspec
-- + ordered evaluate + a default. The D7 gap audit cleared receive/assign/chance
-- etc. as zero-usage — we do not implement them.

local function newHandlers()
  local H = { list = {} }

  H.utils = {
    hasMatchingTag = function(name, value)
      return function(msg) return msg.Tags[name] == value end
    end,
  }

  function H.add(name, pattern, handle)
    -- pattern may be a matcher fn or an action string
    local matcher = (type(pattern) == 'function') and pattern
      or function(msg) return msg.Action == pattern end
    for _, h in ipairs(H.list) do
      if h.name == name then h.matcher, h.handle = matcher, handle; return end
    end
    table.insert(H.list, { name = name, matcher = matcher, handle = handle })
  end

  --- Ordered dispatch. First matching handler wins (contracts are exclusive by
  --- Action). Returns true if a handler ran. Errors propagate to the caller's
  --- pcall (the atomicity boundary) — do NOT swallow here.
  function H.evaluate(msg, env)
    for _, h in ipairs(H.list) do
      if h.name ~= '_default' and h.matcher(msg) then
        h.handle(msg, env)
        return true
      end
    end
    for _, h in ipairs(H.list) do
      if h.name == '_default' then h.handle(msg, env); return true end
    end
    return false
  end

  return H
end

-- ===========================================================================
-- Section 5 — ao / Send / outbox (AXIS 5)
-- ===========================================================================
--
-- TODO(conformance): the outbound envelope (Data-Protocol/Variant/Type/Reference,
-- Anchor, Target casing) MUST match what HyperBEAM routing + our peer contracts
-- accept — pin against legacynet ao.send (process/ao.lua:183). Our three contracts
-- message each other, so this is load-bearing, not cosmetic.

function runtime.clearOutbox()
  ao.outbox = { Messages = {}, Spawns = {}, Patches = {}, Output = {} }
end

function runtime.send(out)
  assert(type(out) == 'table', 'Send: table required')
  -- Contracts use ao.send for BOTH outbound messages and state projection via
  -- patch@1.0. Route them apart; both are discarded together on handler error.
  -- TODO(conformance/verify-live): confirm patch@1.0 write shape on the device
  -- and how it surfaces on the read path (D4).
  if out.device == 'patch@1.0' then
    table.insert(ao.outbox.Patches, out)
    return out
  end
  ao.reference = (ao.reference or 0) + 1
  out.reference = tostring(ao.reference)
  table.insert(ao.outbox.Messages, out)   -- TODO(conformance): full tag envelope
  return out
end
Send = Send or runtime.send

--- Serialize outbox into the device result shape (smoke.lua:176 + hyper main.lua:14):
--- base.results.outbox is a string-keyed map "1","2",... ; output carries data.
local function writeResults(base, output)
  local outbox = {}
  for i, m in ipairs(ao.outbox.Messages) do outbox[tostring(i)] = m end
  base.results = { outbox = outbox, output = output or { data = '' } }
end

--- NO PATCH DEVICE. The contracts' `ao.send({device='patch@1.0', <k>=<v>})` calls
--- are reinterpreted as writes onto `base` — the native device's state-on-base read
--- path (D4: now/<key>; smoke.lua). Contracts stay byte-for-byte; we never call an
--- external patch device. Runs only on the success path (patches discarded on error).
--- TODO(verify-live): confirm the exact base path the device exposes at now/<key>.
local function projectPatches(base)
  for _, p in ipairs(ao.outbox.Patches) do
    for k, v in pairs(p) do
      if k ~= 'device' then base[k] = v end
    end
  end
end

-- ===========================================================================
-- Section 3e — eval gate (AXIS 3): Owner only, non-empty guard
-- ===========================================================================
--
-- Legacynet (process.lua:401): Action=="Eval" and Owner==msg.From. We add the
-- explicit non-empty guard so an unresolved identity can NEVER yield "" == "".
-- Contracts do not rely on Eval in production; the gate exists for admin use.
local function evalGate(msg)
  return msg.Action == 'Eval'
     and Owner ~= nil and Owner ~= ''
     and msg.From == Owner
end
runtime.evalGate = evalGate  -- wire an eval handler only if we decide to expose it

-- ===========================================================================
-- Section C — compute entrypoint: the INFALLIBLE trampoline + atomicity (AXIS 6)
-- ===========================================================================
--
-- From smoke.lua (verified v0.9-FINAL): any error escaping compute() fails the
-- slot at the node level and PERMANENTLY WEDGES the process (/now 500s, no later
-- message computes). So this function is nothing but pcalls + plain tables.
-- Snapshot managed state before dispatch; restore on any error → a failed slot
-- never mutates state (the module-owned replacement for legacynet's CU revert).

--- Everything fallible for a slot runs here, under the caller's pcall.
local function protectedCompute(base, assignment)
  initEnv(base)                                  -- AXIS 4 (+ env)
  runtime.clearOutbox()

  local msg = buildMsg(base, assignment)         -- AXIS 0/1

  -- AXIS 2 gate
  if msg.From == nil then
    return { data = 'error: unsigned or unresolved committer' }
  end
  if not passesGate(msg.From, msg.Owner, ao.authorities) then
    return { data = 'Message is not trusted.' }
  end

  -- Dispatch registered contract handlers (they mutate `base.state`, call Send).
  runtime.Handlers = runtime.Handlers or newHandlers()
  runtime.Handlers.evaluate(msg, ao.env)

  return { data = '', prompt = 'aos> ' }
end

--- The trampoline. TRIVIALLY INFALLIBLE by construction.
function compute(base, assignment, opts)
  assignment = assignment or {}

  -- Snapshot first; if snapshotting itself fails, bail without touching state.
  local snapok, snapshot = pcall(snapshotState, base)
  if not snapok then
    base.results = { outbox = {}, output = { data = 'error: snapshot failed: ' .. tostring(snapshot) } }
    return base
  end

  local ok, output = pcall(protectedCompute, base, assignment)
  if not ok then
    pcall(restoreState, base, snapshot)          -- AXIS 6: revert managed state
    output = { data = 'error: ' .. tostring(output) }
    -- outbox is discarded on error (never emit half a handler's messages)
    pcall(runtime.clearOutbox)
  else
    pcall(projectPatches, base)                   -- AXIS 5/D4: state-on-base, no patch device
  end

  pcall(writeResults, base, output)              -- AXIS 5, belt-and-braces
  return base
end

-- ===========================================================================
-- Section L — contract load hook
-- ===========================================================================
--
-- Contracts are authored as `Handlers.add(...)` registrations at load time
-- (operator-registry.lua etc.). The runtime installs the global surface they
-- expect, then loads the contract ONCE so its handlers populate the list.
--
-- TODO(port): decide bundling — runtime as the process module that requires the
-- contract, vs contract entry that requires the runtime. Current bundler
-- (scripts/bundle.ts) treats each contract as the entry, so likely: prepend the
-- runtime, expose globals (Handlers, Send, ao, Owner), let the contract register.
function runtime.install()
  runtime.Handlers = runtime.Handlers or newHandlers()
  Handlers = runtime.Handlers
  ao = ao or {}
  ao.send = runtime.send
  -- Owner / ao.env.Process are populated on first compute via initEnv.
end

-- Self-install on load. When contracts are bundled, every module is preloaded before
-- the entry runs, so a contract's module-level init() (which registers handlers) fires
-- before the entry could call install(). Installing here guarantees Handlers/ao/Send
-- exist by then. Idempotent — explicit runtime.install() (used by the specs) still works.
runtime.install()

return runtime
