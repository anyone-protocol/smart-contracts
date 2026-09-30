-- One-off: capture golden reward outputs from the CURRENT (bint) relay-rewards,
-- to lock the bint→native port to byte-identical results.
-- run: podman run --rm -v "$PWD":/work:Z -w /work docker.io/nickblah/lua:5.3 lua spec/fixtures/capture-relay-golden.lua
local CT, RT = 'src/contracts', 'runtime'
local C, V, F = CT .. '/common', RT .. '/vendor', 'spec/fixtures'
local function loadmod(p) return assert(loadfile(p))() end
package.loaded['json'] = loadmod(V .. '/json.lua'); package.loaded['.json'] = package.loaded['json']
package.loaded['.bint'] = loadmod(F .. '/bint.lua')
package.loaded['.common.errors'] = loadmod(C .. '/errors.lua')
package.loaded['.common.utils']  = loadmod(C .. '/utils.lua')
package.loaded['.common.acl']    = loadmod(C .. '/acl.lua')
local runtime = loadmod(RT .. '/runtime.lua'); runtime.install()
loadmod(CT .. '/relay-rewards.lua')
runtime.manage(RelayRewards); runtime.manage(package.loaded['.common.acl'].State)

local json = require('json')
local OWNER = '0x' .. string.rep('C', 40)
local FP, ADDR = string.rep('A', 40), '0x' .. string.rep('a', 40)
local T1, T2 = 1000000, 1060000
local function commit(c) return { c1 = { ['commitment-device'] = 'ans104@1.0', committer = c } } end
local function assign(action, data, ts)
  return { body = { action = action, commitments = commit(OWNER),
    tags = { { name = 'Action', value = action }, { name = 'Round-Timestamp', value = tostring(ts) } }, data = data } }
end
local function scores(net) return json.encode({ Scores = { [FP] = { Address = ADDR, Network = net,
  IsHardware = false, UptimeStreak = 5, FamilySize = 1, ExitBonus = false, LocationSize = 1 } } }) end
local function run(a, d, ts) local b = { process = { id = 'PID', commitments = commit(OWNER) }, state = {} }; compute(b, assign(a, d, ts)); return b end

run('Add-Scores', scores(1000), T1); run('Complete-Round', nil, T1)
run('Add-Scores', scores(1000), T2); run('Complete-Round', nil, T2)

local pr = RelayRewards.PreviousRound
print('Period=' .. tostring(pr.Period))
print('Summary.Rewards.Network=' .. pr.Summary.Rewards.Network)
print('Summary.Rewards.Total=' .. pr.Summary.Rewards.Total)
print('Details.Rating.Network=' .. tostring(pr.Details[FP].Rating.Network))
print('Details.Reward.Total=' .. pr.Details[FP].Reward.Total)
print('Details.Reward.Network=' .. pr.Details[FP].Reward.Network)
print('Details.Reward.OperatorTotal=' .. pr.Details[FP].Reward.OperatorTotal)
