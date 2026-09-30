--- Tier-1 busted spec: the REAL operator-registry contract hosted on the lean
--- runtime, driven under Lua 5.3 (luerl's language level) in a container.
---
--- Proves, per D8 axes: 0 adapter/dispatch · 1 identity (msg.From = committer) ·
--- 2/A11 trust (forged from-process cannot impersonate Owner) · 6 atomicity
--- (mid-handler assert reverts managed contract globals) · unsigned rejection.
--- luerl-specific + on-device shapes are the Tier-2 (luerl container) / Tier-3
--- (node) gates — see runtime.lua TODO(verify-live) markers.

-- Resolve repo paths relative to this spec file (works in-container and locally).
local HERE = debug.getinfo(1, 'S').source:match('^@(.*/)') or './'
local AO = HERE .. '..'
local CT, RT = AO .. '/src/contracts', AO .. '/runtime'
local C, V   = CT .. '/common', RT .. '/vendor'

--- Load a completely fresh runtime + contract so every test starts with clean
--- state (contract state lives in globals, which otherwise persist across tests).
local function freshEnv()
  for _, m in ipairs({ 'json', '.json', '.common.errors', '.common.utils', '.common.acl' }) do
    package.loaded[m] = nil
  end
  for _, g in ipairs({ 'OperatorRegistry', 'Handlers', 'ao', 'Owner', 'Send', 'compute' }) do
    _G[g] = nil
  end
  local function loadmod(p) return assert(loadfile(p))() end
  package.loaded['json']           = loadmod(V .. '/json.lua')
  package.loaded['.json']          = package.loaded['json']
  package.loaded['.common.errors'] = loadmod(C .. '/errors.lua')
  package.loaded['.common.utils']  = loadmod(C .. '/utils.lua')
  package.loaded['.common.acl']    = loadmod(C .. '/acl.lua')
  local runtime = loadmod(RT .. '/runtime.lua')
  runtime.install()
  loadmod(CT .. '/operator-registry.lua')       -- self-calls OperatorRegistry.init()
  runtime.manage(OperatorRegistry)
  runtime.manage(package.loaded['.common.acl'].State)
  return runtime
end

describe('operator-registry on the lean runtime (Lua 5.3)', function()
  local OWNER    = '0x' .. string.rep('C', 40)
  local ATTACKER = '0x' .. string.rep('B', 40)
  local ADDR        = '0x' .. string.rep('a', 40)
  local ADDR_STORED = '0x' .. string.rep('A', 40)   -- normalizeEvmAddress upper-cases

  local function commit(committer)
    return { c1 = { ['commitment-device'] = 'ans104@1.0', committer = committer } }
  end
  local function assign(action, committer, data, extra)
    local body = {
      action = action,
      tags = { { name = 'Action', value = action } },
      data = data,
      commitments = committer and commit(committer) or nil,
    }
    if extra then for k, v in pairs(extra) do body[k] = v end end
    return { body = body }
  end
  local function newBase() return { process = { id = 'PID', commitments = commit(OWNER) }, state = {} } end
  local function certs(list) return require('json').encode(list) end
  local function fp(ch) return string.rep(ch, 40) end
  local function outData(base) return base.results and base.results.output and base.results.output.data or '' end
  local function claimable(f) return OperatorRegistry.ClaimableFingerprintsToOperatorAddresses[f] end
  local function has(s, sub) return type(s) == 'string' and s:find(sub, 1, true) ~= nil end

  before_each(function() freshEnv() end)

  it('dispatches an owner admin action, passes ACL, and mutates state', function()
    local FP, base = fp('A'), newBase()
    compute(base, assign('Admin-Submit-Operator-Certificates', OWNER,
      certs({ { f = FP, a = ADDR, hw = false } })))
    assert.are.equal(ADDR_STORED, claimable(FP))
  end)

  it('emits a reply to the committer and a patch@1.0 state projection', function()
    local FP, base = fp('A'), newBase()
    compute(base, assign('Admin-Submit-Operator-Certificates', OWNER,
      certs({ { f = FP, a = ADDR, hw = false } })))
    local replied = false
    for _, m in pairs(base.results.outbox) do
      if m.Action == 'Admin-Submit-Operator-Certificates-Response' and m.Target == OWNER then replied = true end
    end
    assert.is_true(replied)
    assert.is_true(#ao.outbox.Patches > 0)
  end)

  it('denies a non-owner via ACL and leaves state unchanged', function()
    local FP, base = fp('D'), newBase()
    compute(base, assign('Admin-Submit-Operator-Certificates', ATTACKER,
      certs({ { f = FP, a = ADDR, hw = false } })))
    assert.is_true(has(outData(base), 'Permission Denied'))
    assert.is_nil(claimable(FP))
  end)

  it('rejects a forged from-process impersonating the Owner (A11)', function()
    local FP, base = fp('E'), newBase()
    compute(base, assign('Admin-Submit-Operator-Certificates', ATTACKER,
      certs({ { f = FP, a = ADDR, hw = false } }),
      { ['from-process'] = OWNER }))            -- forgery attempt
    assert.is_true(has(outData(base), 'Permission Denied'))
    assert.is_nil(claimable(FP))
  end)

  it('reverts a partial mutation when a later item in the batch fails (atomicity)', function()
    local GOOD, base = fp('1'), newBase()
    compute(base, assign('Admin-Submit-Operator-Certificates', OWNER,
      certs({ { f = GOOD, a = ADDR, hw = false }, { f = 'BAD', a = ADDR, hw = false } })))
    assert.is_true(has(outData(base), 'Invalid'))
    assert.is_nil(claimable(GOOD))              -- first cert's mutation rolled back
  end)

  it('rejects an unsigned message before dispatch', function()
    local FP, base = fp('F'), newBase()
    compute(base, assign('Admin-Submit-Operator-Certificates', nil, certs({ { f = FP, a = ADDR } })))
    assert.is_true(has(outData(base), 'unsigned'))
    assert.is_nil(claimable(FP))
  end)
end)
