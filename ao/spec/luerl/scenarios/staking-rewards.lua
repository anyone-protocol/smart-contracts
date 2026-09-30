-- Tier-2 golden differential: the PORTED staking-rewards through real luerl. Must
-- reproduce the bint golden (spec/fixtures/capture-staking-golden.lua) exactly,
-- including the Share/bint.trunc float-mediated path (operator 5%).
local json = require('json')
local pass, fail, failures = 0, 0, {}
local function check(name, cond, got)
  if cond then pass = pass + 1
  else fail = fail + 1; failures[#failures + 1] = name .. ' got=' .. tostring(got) end
end

local OWNER = '0x' .. string.rep('C', 40)
local HODLER, OPERATOR = '0x' .. string.rep('d', 40), '0x' .. string.rep('e', 40)
local nH, nO = '0x' .. string.rep('D', 40), '0x' .. string.rep('E', 40)
local T1, T2 = 1000000, 1060000
local function commit(c) return { c1 = { ['commitment-device'] = 'ans104@1.0', committer = c } } end
local function assign(a, d, ts)
  local tags = { { name = 'Action', value = a } }
  if ts then tags[#tags + 1] = { name = 'Round-Timestamp', value = tostring(ts) } end
  return { body = { action = a, commitments = commit(OWNER), tags = tags, data = d } }
end
local function scores() return json.encode({ Scores = { [HODLER] = { [OPERATOR] = { Staked = '1000', Running = 1 } } } }) end
local function run(a, d, ts)
  local b = { process = { id = 'PID', commitments = commit(OWNER) }, state = {} }
  compute(b, assign(a, d, ts)); return b
end

run('Toggle-Feature-Shares', json.encode({ Enabled = true }), nil)
run('Add-Scores', scores(), T1); run('Complete-Round', nil, T1)
run('Add-Scores', scores(), T2); run('Complete-Round', nil, T2)
local pr = StakingRewards.PreviousRound

check('Period == 60', pr.Period == 60, pr.Period)
check('Summary.Rewards', pr.Summary.Rewards == '6000000000', pr.Summary.Rewards)
check('Summary.Ratings', pr.Summary.Ratings == '1000', pr.Summary.Ratings)
check('Details.Rating',  pr.Details[nH][nO].Rating == '1000', pr.Details[nH][nO].Rating)
check('Reward.Hodler',   pr.Details[nH][nO].Reward.Hodler == '5700000000', pr.Details[nH][nO].Reward.Hodler)
check('Reward.Operator', pr.Details[nH][nO].Reward.Operator == '300000000', pr.Details[nH][nO].Reward.Operator)
check('Rewarded[H][O]',  StakingRewards.Rewarded[nH][nO] == '5700000000', StakingRewards.Rewarded[nH][nO])

return { pass = pass, fail = fail, failures = failures }
