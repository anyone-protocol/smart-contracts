-- One-off: capture golden reward outputs from the CURRENT (bint) staking-rewards.
-- run: podman run --rm -v "$PWD":/work:Z -w /work docker.io/nickblah/lua:5.3 lua spec/fixtures/capture-staking-golden.lua
local CT, RT = 'src/contracts', 'runtime'
local C, V, F = CT .. '/common', RT .. '/vendor', 'spec/fixtures'
local function loadmod(p) return assert(loadfile(p))() end
package.loaded['json'] = loadmod(V .. '/json.lua'); package.loaded['.json'] = package.loaded['json']
package.loaded['.bint'] = loadmod(F .. '/bint.lua')
package.loaded['.common.errors'] = loadmod(C .. '/errors.lua')
package.loaded['.common.utils']  = loadmod(C .. '/utils.lua')
package.loaded['.common.acl']    = loadmod(C .. '/acl.lua')
local runtime = loadmod(RT .. '/runtime.lua'); runtime.install()
loadmod(CT .. '/staking-rewards.lua')
runtime.manage(StakingRewards); runtime.manage(package.loaded['.common.acl'].State)

local json = require('json')
local OWNER = '0x' .. string.rep('C', 40)
local HODLER, OPERATOR = '0x' .. string.rep('d', 40), '0x' .. string.rep('e', 40)
local nH, nO = '0x' .. string.rep('D', 40), '0x' .. string.rep('E', 40)  -- normalized (upper)
local T1, T2 = 1000000, 1060000
local function commit(c) return { c1 = { ['commitment-device'] = 'ans104@1.0', committer = c } } end
local function assign(a, d, ts)
  local tags = { { name = 'Action', value = a } }
  if ts then tags[#tags + 1] = { name = 'Round-Timestamp', value = tostring(ts) } end
  return { body = { action = a, commitments = commit(OWNER), tags = tags, data = d } }
end
local function scores() return json.encode({ Scores = { [HODLER] = { [OPERATOR] = { Staked = '1000', Running = 1 } } } }) end
local function run(a, d, ts) local b = { process = { id = 'PID', commitments = commit(OWNER) }, state = {} }; compute(b, assign(a, d, ts)); return b end

run('Toggle-Feature-Shares', json.encode({ Enabled = true }), nil)   -- default share 0.05 → exercises bint.trunc
run('Add-Scores', scores(), T1); run('Complete-Round', nil, T1)
run('Add-Scores', scores(), T2)
local b = run('Complete-Round', nil, T2)
print('out=' .. tostring(b.results.output.data))
local pr = StakingRewards.PreviousRound
print('Period=' .. tostring(pr.Period))
print('Summary.Rewards=' .. pr.Summary.Rewards)
print('Summary.Ratings=' .. pr.Summary.Ratings)
print('Details.Rating=' .. pr.Details[nH][nO].Rating)
print('Details.Reward.Hodler=' .. pr.Details[nH][nO].Reward.Hodler)
print('Details.Reward.Operator=' .. pr.Details[nH][nO].Reward.Operator)
print('Rewarded[H][O]=' .. tostring(StakingRewards.Rewarded[nH][nO]))
