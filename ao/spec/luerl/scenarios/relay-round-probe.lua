-- Tier-3 parity ORACLE: drive a fixed round on top of the SEEDED bundle under luerl (full
-- precision). Prints PROBE=<json> with the Complete-Round output Details + resulting cumulative
-- rewards. The on-node run (scripts/tier3-relay-validate.ts) drives the IDENTICAL round and must
-- produce byte-identical values — proving the device VM computes the frozen math the same at
-- real (719KB) state scale. Committer differs (OWNER here, dev wallet on-node) but rewards depend
-- only on scores+config+roundLength, so results match.
local json = require('json')
local OWNER = '0x' .. string.rep('1', 40)
local AA = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
local BB = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC'
local FP1, FP2, FP3 = string.rep('1', 40), string.rep('2', 40), string.rep('3', 40)
local T = 1783067641960   -- seeded PreviousRound.Timestamp (1783064041960) + 3600000 → Period 3600

local function commit(c) return { c1 = { ['commitment-device'] = 'ans104@1.0', committer = c } } end
local function assign(a, d, tags)
  local tl = { { name = 'Action', value = a } }
  if tags then for k, v in pairs(tags) do tl[#tl + 1] = { name = k, value = v } end end
  return { body = { action = a, commitments = commit(OWNER), tags = tl, data = d } }
end

local base = { process = { id = 'PID', commitments = commit(OWNER) } }
local scoresData = json.encode({ Scores = {
  [FP1] = { Address = AA, Network = 1000000, IsHardware = true,  UptimeStreak = 14, ExitBonus = true,  FamilySize = 3, LocationSize = 5 },
  [FP2] = { Address = BB, Network = 500000,  IsHardware = false, UptimeStreak = 3,  ExitBonus = false, FamilySize = 1, LocationSize = 2 },
  [FP3] = { Address = AA, Network = 800000,  IsHardware = false, UptimeStreak = 0,  ExitBonus = false, FamilySize = 1, LocationSize = 1 },
} })
compute(base, assign('Add-Scores', scoresData, { ['Round-Timestamp'] = tostring(T) }))
compute(base, assign('Complete-Round', nil, { ['Round-Timestamp'] = tostring(T) }))

local out = json.decode(base.results.output.data)
local probe = {
  Period = out.Period,
  Details = out.Details,
  tar = { [AA] = native.stateRoot().TotalAddressReward[AA], [BB] = native.stateRoot().TotalAddressReward[BB] },
  tfr = { [FP1] = native.stateRoot().TotalFingerprintReward[FP1], [FP2] = native.stateRoot().TotalFingerprintReward[FP2], [FP3] = native.stateRoot().TotalFingerprintReward[FP3] },
}
print('PROBE=' .. json.encode(probe))
return { pass = 1, fail = 0, failures = {} }
