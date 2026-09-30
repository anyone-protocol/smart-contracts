-- Phase 0 spike — can a Lua script BE a `p4@1.0` PRICING device?
--
-- `dev_p4`'s own tests only ever wire Lua as a LEDGER device (hyper-token-p4-client.lua,
-- `ledger-device: lua@5.3a`). Pricing is always a built-in Erlang module there. The write-gate
-- design needs the opposite, so this file is the minimum that proves the mechanism before any
-- of Phases 1-4 get built on it.
--
-- Contract with dev_p4 (see src/dev_p4.erl:79-96). `estimate` is resolved as a key on the hook
-- message with the device swapped to lua@5.3a, so dev_lua's `default => compute/4` calls the
-- Lua function of the same name with (base, req, opts):
--
--   base  the `on/request` hook message itself (device, pricing-device, ledger-device, module)
--   req   #{ path = 'estimate', request = <the signed user request>, body = <messages> }
--
-- Return values dev_p4 branches on:
--   'infinity'  -> refuse outright, ledger is NEVER consulted     -> HTTP 400
--   0           -> admit for free, ledger is NEVER consulted
--   anything else -> a price, which sends dev_p4 to the ledger's `balance`
--
-- ⚠️ The `{ok, 0}` clause matches the Erlang INTEGER 0. Lua 5.3 distinguishes 0 from 0.0, so
-- returning a float here would fall through to the price branch and ask the ledger for a
-- balance -- and `dev_faff` exports no `balance/3`, so that surfaces as a 500 rather than as
-- an admission. `math.tointeger` is the guard; the probe asserts the admitted path is not a 500.

local ALLOWED = {
--[[ALLOWED]]
}

-- Same shape as runtime/native.lua's resolveCommitter: trust only the node-verified
-- `committer` field on a real signature commitment, never a self-declared owner/from.
-- hmac-sha256 commitments carry no committer and must be skipped, not treated as anonymous.
local function committers(m)
  local out, n = {}, 0
  if type(m) ~= 'table' or type(m.commitments) ~= 'table' then return out, 0 end
  for _, c in pairs(m.commitments) do
    if type(c) == 'table' and c.committer ~= nil then
      local dev = c['commitment-device']
      if dev == 'ans104@1.0' or dev == 'httpsig@1.0' then
        n = n + 1
        out[n] = c.committer
      end
    end
  end
  return out, n
end

function estimate(base, req, opts)
  local request = type(req) == 'table' and req.request or nil
  local signers, n = committers(request)

  -- Deny-by-default on an unsigned request. NOTE this is deliberately STRICTER than
  -- `dev_faff`, whose `lists:all` over an empty signer list is vacuously true -- i.e. stock
  -- faff ADMITS unsigned requests. Nothing downstream lets an unsigned request create a
  -- process, so it is not a bypass today, but there is no reason for the gate to allow it.
  if n == 0 then return 'ok', 'infinity' end

  -- Every signer must be allowed, matching dev_faff:is_admissible's `lists:all`.
  for i = 1, n do
    if not ALLOWED[signers[i]] then return 'ok', 'infinity' end
  end

  return 'ok', math.tointeger(0)
end

-- Called on the `on/response` hook. Returning integer 0 means dev_p4 short-circuits before
-- the charge, so the ledger device is never invoked on the way out either. Without this key
-- dev_p4 falls back to re-running `estimate` (dev_p4.erl:199-204), which would work but does
-- the committer walk twice.
function price(base, req, opts)
  return 'ok', math.tointeger(0)
end
