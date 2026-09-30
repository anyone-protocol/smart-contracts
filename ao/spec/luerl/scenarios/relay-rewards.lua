-- Tier-2 golden differential: the PORTED relay-rewards (bint → native bigint) through
-- real luerl, at FULL token scale (default TokensPerSecond). luerl integers are
-- arbitrary precision, so this must reproduce the exact numbers the bint version
-- produced under Lua 5.3 (captured in spec/fixtures/capture-relay-golden.lua).
-- This is the real proof the port is byte-identical AND runs where bint hangs.
local json = require('json')
local pass, fail, failures = 0, 0, {}
local function check(name, cond, got)
  if cond then pass = pass + 1
  else fail = fail + 1; failures[#failures + 1] = name .. ' got=' .. tostring(got) end
end

local OWNER = '0x' .. string.rep('C', 40)
local FP, ADDR = string.rep('A', 40), '0x' .. string.rep('a', 40)
local T1, T2 = 1000000, 1060000
local function commit(c) return { c1 = { ['commitment-device'] = 'ans104@1.0', committer = c } } end
local function assign(a, d, ts)
  local tags = { { name = 'Action', value = a } }
  if ts then tags[#tags + 1] = { name = 'Round-Timestamp', value = tostring(ts) } end
  return { body = { action = a, commitments = commit(OWNER), tags = tags, data = d } }
end
local function scores(net) return json.encode({ Scores = { [FP] = { Address = ADDR, Network = net,
  IsHardware = false, UptimeStreak = 5, FamilySize = 1, ExitBonus = false, LocationSize = 1 } } }) end
local function run(a, d, ts)
  local b = { process = { id = 'PID', commitments = commit(OWNER) }, state = {} }
  compute(b, assign(a, d, ts)); return b
end

run('Add-Scores', scores(1000), T1); run('Complete-Round', nil, T1)
run('Add-Scores', scores(1000), T2); run('Complete-Round', nil, T2)
local pr = RelayRewards.PreviousRound

-- golden values from the bint version (capture-relay-golden.lua)
check('Period == 60', pr.Period == 60, pr.Period)
check('Rating.Network == 1009', pr.Details[FP].Rating.Network == 1009, pr.Details[FP].Rating.Network)
check('Summary.Rewards.Network', pr.Summary.Rewards.Network == '972222189120000000', pr.Summary.Rewards.Network)
check('Summary.Rewards.Total',   pr.Summary.Rewards.Total   == '1215277736400000000', pr.Summary.Rewards.Total)
check('Reward.Total',            pr.Details[FP].Reward.Total == '1215277736400000000', pr.Details[FP].Reward.Total)
check('Reward.Network',          pr.Details[FP].Reward.Network == '972222189120000000', pr.Details[FP].Reward.Network)
check('Reward.OperatorTotal',    pr.Details[FP].Reward.OperatorTotal == '1215277736400000000', pr.Details[FP].Reward.OperatorTotal)

return { pass = pass, fail = fail, failures = failures }
