--- Tier-1 busted spec: a RUDIMENTARY exercise of the relay-rewards contract on the
--- lean runtime, under Lua 5.3. Proves the runtime hosts the reward contract and its
--- bignum money-math path runs end-to-end (Add-Scores → Complete-Round over two
--- rounds), ACL holds, and the no-patch-device projection lands state on `base`.
---
--- Runs the PORTED contract (bint → common/bigint native ints). IMPORTANT: reward
--- MAGNITUDES are NOT asserted here — under real Lua 5.3 integers are 64-bit and the
--- token-scale intermediates (tokensPerSecond * share*precision ≈ 1.6e19) OVERFLOW,
--- so magnitude is only correct under luerl (arbitrary precision). Tier 2
--- (spec/luerl, relay-rewards scenario) validates the exact reward numbers against
--- the bint golden. Here we cover structure/dispatch/ACL/atomicity + the small,
--- non-overflowing quantities (Period, Timestamp).

local HERE = debug.getinfo(1, 'S').source:match('^@(.*/)') or './'
local AO = HERE .. '..'
local CT, RT = AO .. '/src/contracts', AO .. '/runtime'
local C, V = CT .. '/common', RT .. '/vendor'

local function freshEnv()
  for _, m in ipairs({ 'json', '.json', '.common.bigint', '.common.errors', '.common.utils', '.common.acl' }) do
    package.loaded[m] = nil
  end
  for _, g in ipairs({ 'RelayRewards', 'Handlers', 'ao', 'Owner', 'Send', 'compute' }) do _G[g] = nil end
  local function loadmod(p) return assert(loadfile(p))() end
  package.loaded['json']           = loadmod(V .. '/json.lua')
  package.loaded['.json']          = package.loaded['json']
  package.loaded['.common.bigint'] = loadmod(C .. '/bigint.lua')    -- native-int replacement for bint
  package.loaded['.common.errors'] = loadmod(C .. '/errors.lua')
  package.loaded['.common.utils']  = loadmod(C .. '/utils.lua')
  package.loaded['.common.acl']    = loadmod(C .. '/acl.lua')
  local runtime = loadmod(RT .. '/runtime.lua')
  runtime.install()
  loadmod(CT .. '/relay-rewards.lua')            -- self-calls RelayRewards.init()
  runtime.manage(RelayRewards)
  runtime.manage(package.loaded['.common.acl'].State)
  return runtime
end

describe('relay-rewards on the lean runtime (Lua 5.3, rudimentary)', function()
  local OWNER    = '0x' .. string.rep('C', 40)
  local ATTACKER = '0x' .. string.rep('B', 40)
  local FP       = string.rep('A', 40)
  local ADDR     = '0x' .. string.rep('a', 40)
  local T1, T2   = 1000000, 1060000               -- Period = (T2-T1)//1000 = 60

  local function commit(c) return { c1 = { ['commitment-device'] = 'ans104@1.0', committer = c } } end
  local function assign(action, committer, data, tagKVs)
    local tags = { { name = 'Action', value = action } }
    if tagKVs then for k, v in pairs(tagKVs) do tags[#tags + 1] = { name = k, value = v } end end
    return { body = { action = action, tags = tags, data = data,
      commitments = committer and commit(committer) or nil } }
  end
  local function newBase() return { process = { id = 'PID', commitments = commit(OWNER) }, state = {} } end
  local function scoresFor(fp, network)
    return require('json').encode({ Scores = { [fp] = {
      Address = ADDR, Network = network, IsHardware = false,
      UptimeStreak = 5, FamilySize = 1, ExitBonus = false, LocationSize = 1 } } })
  end
  --- Run one message; returns the base (its projected state).
  local function run(action, committer, data, tagKVs)
    local base = newBase()
    compute(base, assign(action, committer, data, tagKVs))
    return base
  end
  local function outData(base) return base.results and base.results.output and base.results.output.data or '' end
  local function has(s, sub) return type(s) == 'string' and s:find(sub, 1, true) ~= nil end

  before_each(function() freshEnv() end)

  it('owner Add-Scores stores a pending round', function()
    run('Add-Scores', OWNER, scoresFor(FP, 1000), { ['Round-Timestamp'] = tostring(T1) })
    assert.are.equal(ADDR, RelayRewards.PendingRounds[T1][FP].Address)
    assert.are.equal(1000, RelayRewards.PendingRounds[T1][FP].Score.Network)
  end)

  it('denies a non-owner Add-Scores and stores nothing', function()
    local base = run('Add-Scores', ATTACKER, scoresFor(FP, 1000), { ['Round-Timestamp'] = tostring(T1) })
    assert.is_true(has(outData(base), 'Permission Denied'))
    assert.is_nil(RelayRewards.PendingRounds[T1])
  end)

  it('completes two rounds at a small (non-overflowing) token scale', function()
    -- reconfigure TokensPerSecond tiny so token-scale intermediates stay within
    -- 64-bit; the real token scale overflows Lua 5.3 and is a Tier-2 (luerl) test.
    run('Update-Configuration', OWNER, require('json').encode({ TokensPerSecond = '1000' }))

    run('Add-Scores',    OWNER, scoresFor(FP, 1000), { ['Round-Timestamp'] = tostring(T1) })
    run('Complete-Round', OWNER, nil,                { ['Round-Timestamp'] = tostring(T1) })
    assert.are.equal(T1, RelayRewards.PreviousRound.Timestamp)
    assert.are.equal(0, RelayRewards.PreviousRound.Period)      -- first round: no elapsed length

    run('Add-Scores',    OWNER, scoresFor(FP, 1000), { ['Round-Timestamp'] = tostring(T2) })
    local base = run('Complete-Round', OWNER, nil,   { ['Round-Timestamp'] = tostring(T2) })
    assert.are.equal(T2, RelayRewards.PreviousRound.Timestamp)
    assert.are.equal(60, RelayRewards.PreviousRound.Period)     -- (T2-T1)//1000
    assert.is_not_nil(RelayRewards.PreviousRound.Details[FP])   -- round ran + serialized
    -- reward MAGNITUDES at full token scale validated at Tier 2 (luerl)

    -- no patch device: state landed on `base` via projection (D4 read path)
    assert.are.equal(60, base.previous_round.Period)
  end)

  it('rejects an invalid score batch and creates no pending round (validate-before-mutate)', function()
    local bad = require('json').encode({ Scores = {
      [FP]    = { Address = ADDR, Network = 1000, IsHardware = false, UptimeStreak = 5, FamilySize = 1, ExitBonus = false, LocationSize = 1 },
      ['BAD'] = { Address = ADDR, Network = 1000, IsHardware = false, UptimeStreak = 5, FamilySize = 1, ExitBonus = false, LocationSize = 1 } } })
    local base = run('Add-Scores', OWNER, bad, { ['Round-Timestamp'] = tostring(T1) })
    assert.is_true(has(outData(base), 'Invalid'))
    assert.is_nil(RelayRewards.PendingRounds[T1])
  end)
end)
