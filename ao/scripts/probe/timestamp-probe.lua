--- timestamp-probe.lua — a BARE compute (no runtime, no deps) that answers one question
--- empirically: WHAT time fields does the `lua@5.3a` device actually hand a contract, and in
--- WHAT UNITS?
---
--- WHY: staking-rewards' `Set-Share` stores `RequestedTimestamp = msg.Timestamp` (legacynet AO =
--- milliseconds) and `Complete-Round` gates on `RequestedTimestamp + ChangeDelaySeconds`. Porting
--- that needs a native time source with KNOWN units. HyperBEAM's scheduler puts TWO different
--- stamps on an assignment (dev_scheduler_server.erl:214-232):
---   * `timestamp`        = scheduler_time() = erlang:system_time(millisecond)  → MILLISECONDS
---   * `block-timestamp`  = ar_timestamp:get() = Arweave /block/current.timestamp → UNIX SECONDS
---                          (and literally 0 when the node runs in `debug` mode)
--- hyper-aos maps `os.time` to `block-timestamp` (the SECONDS one) — so a naive mapping silently
--- changes units by 1000x, or yields 0. This probe reads the real values off a live node so the
--- native mapping is chosen from evidence, not from source-reading.
---
--- Output: `results.output.data` = a `key=value | key=value` string, including a dump of every
--- top-level req key, so nothing is assumed. Infallible by construction (everything in pcall).

local function tostr(v)
  local t = type(v)
  if t == 'nil' then return '<nil>' end
  if t == 'table' then return '<table>' end
  return tostring(v)
end

function compute(base, req)
  local out = 'probe-error'
  pcall(function()
    req = req or {}
    local parts = {}
    local function add(k, v) parts[#parts + 1] = k .. '=' .. tostr(v) end

    -- the two candidate time sources, at assignment level
    add('req.timestamp', req['timestamp'])
    add('req.block-timestamp', req['block-timestamp'])
    add('req.block-height', req['block-height'])
    add('req.slot', req['slot'])

    -- and at body (message) level, in case the device folds them down
    local b = req.body
    if type(b) == 'table' then
      add('body.timestamp', b['timestamp'])
      add('body.block-timestamp', b['block-timestamp'])
    else
      add('body', b)
    end

    -- enumerate every top-level req key so we never assume the shape
    local keys = {}
    for k in pairs(req) do keys[#keys + 1] = tostring(k) end
    table.sort(keys)
    add('req.keys', table.concat(keys, ','))

    out = table.concat(parts, ' | ')
  end)

  base.results = { outbox = {}, output = { data = out } }
  return base
end
