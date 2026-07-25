-- Tier-2 golden differential for the NATIVE relay-rewards (D26 shape) at FULL token scale
-- under luerl (arbitrary precision). Must reproduce the EXACT bint golden numbers captured in
-- spec/fixtures/capture-relay-golden.lua — proving the wrapper reshape (Handlers→native,
-- RelayRewards.X→ctx.state.X) did not move the frozen reward math. Plus the native invariants:
-- Details NOT persisted, Details ride the Complete-Round OUTPUT, cumulative maps keyed EIP-55.
local json = require('json')
local eip55 = require('.common.eip55')
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

-- ONE base across the sequence: native persists on base.state slot-to-slot.
local base = { process = { id = 'PID', commitments = commit(OWNER) } }
local function run(a, d, ts) compute(base, assign(a, d, ts)); return base end

run('Add-Scores', scores(1000), T1); run('Complete-Round', nil, T1)   -- round 1: Period 0 → rewards 0
run('Add-Scores', scores(1000), T2)
local last = run('Complete-Round', nil, T2)                            -- round 2: Period 60 → golden

local pr = base.state.PreviousRound                       -- persisted SUMMARY (no Details)
local snap = json.decode(last.results.output.data)        -- settle-slot OUTPUT (has Details)

-- === golden values (from the bint version — must be byte-identical) ===
check('Period == 60', pr.Period == 60, pr.Period)
check('Rating.Network == 1009', snap.Details[FP].Rating.Network == 1009, snap.Details[FP].Rating.Network)
check('Summary.Rewards.Network', pr.Summary.Rewards.Network == '972222189120000000', pr.Summary.Rewards.Network)
check('Summary.Rewards.Total',   pr.Summary.Rewards.Total   == '1215277736400000000', pr.Summary.Rewards.Total)
check('Reward.Total',            snap.Details[FP].Reward.Total == '1215277736400000000', snap.Details[FP].Reward.Total)
check('Reward.Network',          snap.Details[FP].Reward.Network == '972222189120000000', snap.Details[FP].Reward.Network)
check('Reward.OperatorTotal',    snap.Details[FP].Reward.OperatorTotal == '1215277736400000000', snap.Details[FP].Reward.OperatorTotal)

-- === native-shape invariants ===
check('Details NOT persisted', pr.Details == nil, tostring(pr.Details))
check('output carries Details', snap.Details ~= nil and snap.Details[FP] ~= nil, tostring(snap.Details))
-- cumulative TotalFingerprintReward (round1=0 + round2=golden)
check('TotalFingerprintReward[FP]', base.state.TotalFingerprintReward[FP] == '1215277736400000000', base.state.TotalFingerprintReward[FP])
-- cumulative TotalAddressReward keyed by canonical EIP-55 of ADDR
local key = eip55.checksum(ADDR)
check('TotalAddressReward[eip55(addr)]', base.state.TotalAddressReward[key] == '1215277736400000000', base.state.TotalAddressReward[key])
check('address key is EIP-55 (not legacy ALLCAPS)', key ~= string.upper(ADDR), key)

return { pass = pass, fail = fail, failures = failures }
