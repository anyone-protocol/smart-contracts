--- Holding a large map as a `~trie@1.0` trie ADDRESSED BY ID, from a lua@5.3a process.
---
--- WHY THIS SHAPE. A big flat map in process state is expensive to persist: HyperBEAM re-IDs
--- every key on every slot, so a 10k-key map costs the same ~238ms to write whether it is brand
--- new or has two keys changed. A trie fixes that at the device layer (~18ms for the same
--- 2-key update, ~13x) because only the root-to-leaf path gets a new content address.
---
--- The catch, and the entire point of this file: HOW you hold the trie decides whether you win
--- or lose. `dev_lua.erl` resolves all hyperstate links (`hb_cache:ensure_all_loaded`) before
--- every compute, so anything sitting in process state is fully materialized into the Lua VM on
--- every single message. Keep the trie itself in `process.balances` and you pay three full
--- traversals per message (load in, marshal out, marshal back) — measured 3.3x SLOWER than the
--- plain flat map it was meant to replace. Keep only the trie's 43-character id and you pay one
--- traversal per write and none per read.
---
--- Measured on v0.9-FINAL, 10k holders, 12 messages, per message:
---   flat map                       2,700 ms   (2,303 ms on a GC-patched node)
---   trie held BY VALUE             8,801 ms   <- worse than doing nothing
---   trie held BY ID                1,163 ms   (554 ms on a GC-patched node)
--- The GC patch referred to is the separate `luerl:gc/1` fix in dev_lua:snapshot/3; the two are
--- orthogonal — the patch flattens growth across slots, the trie lowers the per-message constant.
---
--- NB: `process.balanceId` is a CONTENT ADDRESS of the whole balance set, so state still commits
--- to every balance by hash. Moving the data out of state does not cost verifiability.
---
--- Spawn it inline (no module publish needed):
---   scripts/spawn-lua.ts, or any harness that passes this file as `luaSource`.
---
--- VERIFIED 2026-07-29 against a local v0.9-FINAL node by spawning this file verbatim:
---   seed 1000 holders -> balanceId vez2gvZ_JcwLilkmYBExvLqy1PTd_RMHU4yqF5i6ygE
---   Balance A1  -> 1000000000000000000
---   Transfer A1=42 A2=77 -> ok, balanceId changes to pcNYHZa-FieLBf6_nVx71VgaeHA7OIkbELon7F18OxQ
---   Balance A1  -> 42        Balance A2 -> 77
--- The seed id is reproducible across independent spawns (content addressing is deterministic),
--- which is also what lets another node reconstruct the same trie nodes by replaying.
---
--- HTTP READ SURFACE (all verified 200 against the run above). Callers do NOT need to know the
--- trie id — the process hands it over mid-path, so a point read stays ONE request:
---
---   today      GET /<pid>~process@1.0/now/state/<map>/<key>
---   by-id trie GET /<pid>~process@1.0/now/balanceId/~trie@1.0/<key>
---
--- A missing key 404s, exactly as a base-addressed miss does today. These also work when the id
--- is already known: `/<id>~trie@1.0/<key>`, `/<id>~trie@1.0/get?key=<key>`, and even
--- `/<id>/get?key=<key>` (the device is inferred from the stored message). `keys` answers too,
--- but renders via hyperbuddy — send an Accept header if you want it machine-readable.

local INIT_HOLDERS = 1000     -- seeded on first compute so the example runs standalone
local BUILD_BATCH  = 500      -- batch inserts: 10k one-at-a-time is 46s, batched is 244ms

-- ---------------------------------------------------------------------------
-- trie helpers
-- ---------------------------------------------------------------------------

--- The id of a message resolved back from the device.
--- It has to be read off `commitments` rather than resolved: `dev_trie:info/0` declares
--- `default => fun get/4`, so asking a trie for `id` is treated as "look up a key named `id`
--- INSIDE the trie" and comes back not_found. This read is the one remaining reason the write
--- path still materializes the trie at all.
local function idOf(msg)
  if type(msg) ~= 'table' or type(msg.commitments) ~= 'table' then return nil end
  for id in pairs(msg.commitments) do return id end
  return nil
end

--- Insert/overwrite a batch of key/values, returning the id of the NEW trie.
--- `id == nil` is the very first call, when there is no trie to address yet, so the request is
--- merged into a bare device message instead of being resolved against a base.
---
--- ⚠️ The third element of the `as` triple MUST be the id STRING. Passing the trie TABLE there
--- hard-crashes the compute with an empty stacktrace, and `pcall` does NOT catch it.
local function trieSet(id, kvs)
  local ok, status, result
  if id == nil then
    local base = { device = 'trie@1.0', path = 'set' }
    for k, v in pairs(kvs) do base[k] = v end
    ok, status, result = pcall(function() return ao.resolve(base) end)
  else
    local req = { path = 'set' }
    for k, v in pairs(kvs) do req[k] = v end
    ok, status, result = pcall(function()
      return ao.resolve({ 'as', 'trie@1.0', id }, req)
    end)
  end
  if not ok then return nil, 'pcall:' .. tostring(status) end
  local newId = idOf(result)
  if newId == nil then return nil, 'no id in result (status=' .. tostring(status) .. ')' end
  return newId, tostring(status)
end

--- Point read. The base is a 43-char string, so the trie is never materialized into Lua.
local function trieGet(id, key)
  local ok, status, value = pcall(function()
    return ao.resolve({ 'as', 'trie@1.0', id }, { path = 'get', key = key })
  end)
  if not ok then return nil, 'pcall:' .. tostring(status) end
  if tostring(status) ~= 'ok' then return nil, tostring(status) end
  return value, 'ok'
end

-- ---------------------------------------------------------------------------
-- contract
-- ---------------------------------------------------------------------------

local function addrOf(i)
  return string.format('%02X', i % 256)
    .. string.sub(string.format('%038X', (i * 2654435761) % 0x100000000), 1, 38)
end

--- One-time seed. Batched, because insert cost is dominated by per-call overhead.
local function seed()
  local id, i = nil, 1
  while i <= INIT_HOLDERS do
    local kvs = {}
    local last = math.min(i + BUILD_BATCH - 1, INIT_HOLDERS)
    for j = i, last do kvs[addrOf(j)] = '1000000000000000000' end
    local newId, err = trieSet(id, kvs)
    if newId == nil then return nil, 'seed batch ' .. i .. ': ' .. tostring(err) end
    id = newId
    i = last + 1
  end
  return id
end

function compute(process, message, opts)
  -- STATE IS ONE STRING. No balance map ever lives here, which is what keeps
  -- ensure_all_loaded from rebuilding the whole structure in the VM each compute.
  if not process.balanceId then
    local id, err = seed()
    if id == nil then
      process.error = err
      process.results = { output = { body = 'SEED FAILED: ' .. tostring(err) } }
      return process
    end
    process.balanceId = id
  end

  -- What arrives here is the ASSIGNMENT (type=Assignment, slot, timestamp, ...); the sender's
  -- message — and therefore its tags — is nested under `body`. Reading `message.action`
  -- directly silently yields nil and every action falls through to noop.
  local tags = message.body or message
  local action = tags.action or ''
  local out = 'noop'

  if action == 'Transfer' then
    -- A real token would read both balances, check funds and do bigint arithmetic. Kept literal
    -- here so the example stays about the trie access pattern rather than token semantics.
    local from = tags.from or addrOf(1)
    local to = tags.to or addrOf(2)
    local newId, err = trieSet(process.balanceId, {
      [from] = tags['from-balance'] or '999999999999999999',
      [to]   = tags['to-balance']   or '1000000000000000001',
    })
    if newId == nil then
      process.error = err
      out = 'TRANSFER FAILED: ' .. tostring(err)
    else
      process.balanceId = newId          -- the only state mutation
      out = 'ok'
    end

  elseif action == 'Balance' then
    local value, err = trieGet(process.balanceId, tags.address or addrOf(1))
    out = (value ~= nil) and tostring(value) or ('not_found:' .. tostring(err))
  end

  process.count = tostring((tonumber(process.count) or 0) + 1)
  process.results = { output = { body = out } }
  return process
end
