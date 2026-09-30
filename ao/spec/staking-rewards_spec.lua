--- Tier-1 busted spec: the PORTED staking-rewards (bint → common/bigint native ints,
--- tonumber → parseInt) on the lean runtime under Lua 5.3. Staking's token scale
--- (TokensPerSecond '100000000') keeps this scenario's intermediates within 64-bit, so
--- the exact reward numbers ARE asserted here; Tier 2 (spec/luerl) reconfirms them on
--- the device VM. Exercises the Share/`bint.trunc` float-mediated path (operator 5%).

local HERE = debug.getinfo(1, 'S').source:match('^@(.*/)') or './'
local AO = HERE .. '..'
local CT, RT = AO .. '/src/contracts', AO .. '/runtime'
local C, V = CT .. '/common', RT .. '/vendor'

local function freshEnv()
  for _, m in ipairs({ 'json', '.json', '.common.bigint', '.common.errors', '.common.utils', '.common.acl' }) do
    package.loaded[m] = nil
  end
  for _, g in ipairs({ 'StakingRewards', 'Handlers', 'ao', 'Owner', 'Send', 'compute' }) do _G[g] = nil end
  local function loadmod(p) return assert(loadfile(p))() end
  package.loaded['json']           = loadmod(V .. '/json.lua')
  package.loaded['.json']          = package.loaded['json']
  package.loaded['.common.bigint'] = loadmod(C .. '/bigint.lua')
  package.loaded['.common.errors'] = loadmod(C .. '/errors.lua')
  package.loaded['.common.utils']  = loadmod(C .. '/utils.lua')
  package.loaded['.common.acl']    = loadmod(C .. '/acl.lua')
  local runtime = loadmod(RT .. '/runtime.lua')
  runtime.install()
  loadmod(CT .. '/staking-rewards.lua')
  runtime.manage(StakingRewards); runtime.manage(package.loaded['.common.acl'].State)
  return runtime
end

describe('staking-rewards on the lean runtime (Lua 5.3)', function()
  local OWNER, ATTACKER = '0x' .. string.rep('C', 40), '0x' .. string.rep('B', 40)
  local HODLER, OPERATOR = '0x' .. string.rep('d', 40), '0x' .. string.rep('e', 40)
  local nH, nO = '0x' .. string.rep('D', 40), '0x' .. string.rep('E', 40)   -- normalized (upper)
  local T1, T2 = 1000000, 1060000

  local function commit(c) return { c1 = { ['commitment-device'] = 'ans104@1.0', committer = c } } end
  local function assign(a, committer, d, ts)
    local tags = { { name = 'Action', value = a } }
    if ts then tags[#tags + 1] = { name = 'Round-Timestamp', value = tostring(ts) } end
    return { body = { action = a, commitments = committer and commit(committer) or nil, tags = tags, data = d } }
  end
  local function run(a, committer, d, ts)
    local b = { process = { id = 'PID', commitments = commit(OWNER) }, state = {} }
    compute(b, assign(a, committer, d, ts)); return b
  end
  local function scores() return require('json').encode({ Scores = { [HODLER] = { [OPERATOR] = { Staked = '1000', Running = 1 } } } }) end
  local function outData(base) return base.results and base.results.output and base.results.output.data or '' end
  local function has(s, sub) return type(s) == 'string' and s:find(sub, 1, true) ~= nil end

  before_each(function() freshEnv() end)

  it('owner Add-Scores stores a pending round', function()
    run('Add-Scores', OWNER, scores(), T1)
    assert.are.equal('1000', StakingRewards.PendingRounds[T1][nH][nO].Staked)
  end)

  it('denies a non-owner Add-Scores and stores nothing', function()
    local base = run('Add-Scores', ATTACKER, scores(), T1)
    assert.is_true(has(outData(base), 'Permission Denied'))
    assert.is_nil(StakingRewards.PendingRounds[T1])
  end)

  it('two rounds with shares reproduce the bint golden (Share/bint.trunc path)', function()
    run('Toggle-Feature-Shares', OWNER, require('json').encode({ Enabled = true }))  -- default share 0.05
    run('Add-Scores', OWNER, scores(), T1); run('Complete-Round', OWNER, nil, T1)
    run('Add-Scores', OWNER, scores(), T2); run('Complete-Round', OWNER, nil, T2)

    local pr = StakingRewards.PreviousRound
    assert.are.equal(T2, pr.Timestamp)
    assert.are.equal(60, pr.Period)
    assert.are.equal('6000000000', pr.Summary.Rewards)
    assert.are.equal('5700000000', pr.Details[nH][nO].Reward.Hodler)      -- 95%
    assert.are.equal('300000000',  pr.Details[nH][nO].Reward.Operator)    -- 5% via bint.trunc(0.05*1000)
    assert.are.equal('5700000000', StakingRewards.Rewarded[nH][nO])
  end)
end)
