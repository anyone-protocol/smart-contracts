-- Tier-2 golden differential for the NATIVE relay-rewards (D26 shape) at FULL token scale
-- under luerl (arbitrary precision). Must reproduce the EXACT bint golden numbers captured in
-- spec/fixtures/capture-relay-golden.lua — proving the wrapper reshape (Handlers→native,
-- RelayRewards.X→ctx.state.X) did not move the frozen reward math. Plus the native invariants:
-- Details NOT persisted, Details ride the Complete-Round OUTPUT, cumulative maps keyed EIP-55.
local json = require('json')
local function S() return native.stateRoot() end
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

-- ONE base across the sequence: native persists in the `RelayRewards` GLOBAL slot-to-slot
-- (D31/D32), not on the message. S() dereferences it.
local base = { process = { id = 'PID', commitments = commit(OWNER) } }
local function run(a, d, ts) compute(base, assign(a, d, ts)); return base end

run('Add-Scores', scores(1000), T1); run('Complete-Round', nil, T1)   -- round 1: Period 0 → rewards 0
run('Add-Scores', scores(1000), T2)
local last = run('Complete-Round', nil, T2)                            -- round 2: Period 60 → golden

local pr = S().PreviousRound                       -- persisted SUMMARY (no Details)
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
check('TotalFingerprintReward[FP]', S().TotalFingerprintReward[FP] == '1215277736400000000', S().TotalFingerprintReward[FP])
-- cumulative TotalAddressReward keyed by canonical EIP-55 of ADDR
local key = eip55.checksum(ADDR)
check('TotalAddressReward[eip55(addr)]', S().TotalAddressReward[key] == '1215277736400000000', S().TotalAddressReward[key])
check('address key is EIP-55 (not legacy ALLCAPS)', key ~= string.upper(ADDR), key)

-- === Details persisted as a PRE-ENCODED JSON STRING ===
-- Belongs here as well as Tier-1 because the float multipliers must survive luerl's encoder:
-- storing the string means they are encoded ONCE, by the same call that builds the output, so
-- the two read paths cannot drift. Tier-1 runs a different encoder host.
local dj = pr.DetailsJson
check('DetailsJson values are strings', type(dj) == 'table' and type(dj[FP]) == 'string',
  type(dj) == 'table' and type(dj[FP]) or type(dj))
check('Details NOT persisted as a table', pr.Details == nil, tostring(pr.Details))
local djDecoded = type(dj) == 'table' and type(dj[FP]) == 'string' and json.decode(dj[FP]) or {}
check('DetailsJson[fp] matches the output Details[fp]',
  json.encode(djDecoded) == json.encode(snap.Details[FP]), json.encode(djDecoded))
check('float multipliers survive verbatim',
  djDecoded.Variables and djDecoded.Variables.FamilyMultiplier == snap.Details[FP].Variables.FamilyMultiplier,
  tostring(djDecoded.Variables and djDecoded.Variables.FamilyMultiplier))
-- The view must hand back the body VERBATIM. A re-encode would produce a quoted string literal,
-- so the body would start with '"' instead of '{'.
native.installViews()
local djRes = _G['last_round_details'](base, { fingerprint = FP })
check('view body is the stored string', djRes.body == dj[FP], string.sub(tostring(djRes.body), 1, 40))
check('view body is an object, not a quoted string', string.sub(djRes.body, 1, 1) == '{',
  string.sub(djRes.body, 1, 40))
check('view content-type', djRes['content-type'] == 'application/json', djRes['content-type'])
check('unknown fingerprint answers empty',
  _G['last_round_details'](base, { fingerprint = string.rep('F', 40) }).body == '[]',
  _G['last_round_details'](base, { fingerprint = string.rep('F', 40) }).body)

-- === settle-slot pointer (D29 §2) — MUST be an integer end to end ===
-- The node delivers `slot` on the assignment as a STRING, and under luerl `tonumber('7')` is
-- where this can go wrong: a float would serialize as `7.0`, and a consumer building
-- `compute&slot=7.0` from the view gets a 404 rather than the Details payload. Tier-1 cannot
-- see this — it runs Lua 5.3, not the device VM — so the type check belongs here.
local T3 = 1120000
run('Add-Scores', scores(1000), T3)
local slotReq = assign('Complete-Round', nil, T3)
slotReq.slot = '7'                                  -- assignment level, as the scheduler sends it
compute(base, slotReq)
local pr3 = S().PreviousRound
local snap3 = json.decode(base.results.output.data)
check('PreviousRound.Slot == 7', pr3.Slot == 7, pr3.Slot)
check('Slot is an INTEGER, not 7.0', tostring(pr3.Slot) == '7', tostring(pr3.Slot))
check('last_round view exposes Slot', native.view(base, 'last_round').Slot == 7,
  native.view(base, 'last_round').Slot)
check('Complete-Round output carries Slot', snap3.Slot == 7, snap3.Slot)
check('Slot survives JSON encode as 7', json.encode({ s = pr3.Slot }):find('"s":7', 1, true) ~= nil,
  json.encode({ s = pr3.Slot }))

return { pass = pass, fail = fail, failures = failures }
