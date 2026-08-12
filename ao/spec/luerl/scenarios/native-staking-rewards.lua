-- Tier-2 (luerl 1.3.0 — the real device VM) scenario for the NATIVE staking-rewards.
--
-- Tier-1 busted proves the logic under real Lua 5.3; this proves it under the VM the node actually
-- runs, where the divergences live. Two things only Tier-2 can catch:
--   * A17 — a large positive-integer table KEY makes luerl array-allocate and HANG the VM. So this
--     scenario drives REALISTIC 13-digit millisecond round timestamps (the Tier-1 spec's small
--     integers would never trigger it). Period is kept at 10 s so the golden reward values below are
--     identical to the WASM harness's (rewards depend on ratings + period, not on absolute time).
--   * A18 — metadata on persisted nested maps; staking's maps are TWO levels deep
--     (Rewarded[hodler/operator] since D32), so iteration hits it harder than relay's.
local json = require('json')
local function S() return native.stateRoot() end
local pass, fail, failures = 0, 0, {}
local function check(name, cond, got)
  if cond then pass = pass + 1
  else fail = fail + 1; failures[#failures + 1] = name .. ' got=' .. tostring(got) end
end

local OWNER  = '0x' .. string.rep('1', 40)
local ALICE  = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
local BOB    = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC'
local CHARLS = '0x90F79bf6EB2c4f870365E785982E1f101E93b906'

-- REAL observed round timestamps (ms). T1 → T2 is 10 s, matching the harness's Period 10.
local T1 = 1783064040855
local T2 = T1 + 10000

local function commit(c) return { c1 = { ['commitment-device'] = 'ans104@1.0', committer = c } } end
local function assign(a, d, tagKVs, msgTs)
  local tags = { { name = 'Action', value = a } }
  if tagKVs then for k, v in pairs(tagKVs) do tags[#tags + 1] = { name = k, value = v } end end
  local req = { body = { action = a, commitments = commit(OWNER), tags = tags, data = d } }
  if msgTs then req.timestamp = msgTs end
  return req
end

-- ONE base across the sequence: native persists in the `StakingRewards` GLOBAL slot-to-slot
-- (D31/D32), not on the message. S() dereferences it.
local base = { process = { id = 'PID', commitments = commit(OWNER) } }
local function run(a, d, tagKVs, msgTs) compute(base, assign(a, d, tagKVs, msgTs)); return base end
local function out() return base.results.output.data end
local function stake(s, r) return { Staked = s, Running = r } end
local function round(ts, scores)
  run('Add-Scores', json.encode({ Scores = scores }), { ['Round-Timestamp'] = tostring(ts) })
  run('Complete-Round', nil, { ['Round-Timestamp'] = tostring(ts) })
end

-- config: the WASM score-rewards fixture (TPS 1000, Running 0.5, shares on, CHARLS 0.1, default 0.05)
run('Update-Configuration', json.encode({ TokensPerSecond = '1000', Requirements = { Running = 0.5 } }))
check('config OK', out() == 'OK', out())
run('Toggle-Feature-Shares', json.encode({ Enabled = true }))
run('Update-Shares-Configuration', json.encode({ SetSharesEnabled = true, ChangeDelaySeconds = 0,
  Default = 0.05, Min = 0, Max = 1 }))
run('Set-Share', json.encode({ Share = 0.1 }), nil, T1 - 1000)   -- committer is OWNER here
-- re-issue as CHARLS by writing directly is not possible (ctx.from is the committer), so drive the
-- CHARLS share through the state the same way the node would after a CHARLS-signed Set-Share:
S().Shares[CHARLS] = 0.1
S().Shares[OWNER] = nil

local all = { [ALICE] = { [BOB] = stake('1000', 0.6) },
              [BOB] = { [CHARLS] = stake('2000', 0.7) },
              [CHARLS] = { [CHARLS] = stake('3000', 0.8) } }

round(T1, { [ALICE] = { [BOB] = stake('1000', 0.6) } })   -- Period 0 → no rewards
check('round1 settled', out() == 'OK', out())
check('A17: PendingRounds cleared by string key', S().PendingRounds[tostring(T1)] == nil,
  tostring(S().PendingRounds[tostring(T1)]))

round(T2, all)                                            -- Period 10 → the golden numbers
check('round2 settled', out() == 'OK', out())

local pr = S().PreviousRound
-- Details is stored as parallel typed maps under D32; the `last_snapshot` view reassembles the
-- legacy nested shape, so assert through it — that is the shape consumers actually get.
local prDetails = native.view(base, 'last_snapshot').Details
check('Period == 10', pr.Period == 10, pr.Period)
check('Timestamp == T2', pr.Timestamp == T2, pr.Timestamp)
check('Summary.Ratings', pr.Summary.Ratings == '6000', pr.Summary.Ratings)
check('Summary.Stakes',  pr.Summary.Stakes  == '6000', pr.Summary.Stakes)
check('Summary.Rewards', pr.Summary.Rewards == '9999', pr.Summary.Rewards)

-- per-hodler/operator breakdown (Details ARE persisted for staking — see contract header)
check('A→B Hodler 1583',   prDetails[ALICE][BOB].Reward.Hodler   == '1583', prDetails[ALICE][BOB].Reward.Hodler)
check('A→B Operator 83',   prDetails[ALICE][BOB].Reward.Operator == '83',   prDetails[ALICE][BOB].Reward.Operator)
check('A→B Rating 1000',   prDetails[ALICE][BOB].Rating          == '1000', prDetails[ALICE][BOB].Rating)
check('A→B Share 0.05',    prDetails[ALICE][BOB].Score.Share     == 0.05,   prDetails[ALICE][BOB].Score.Share)
check('B→C Hodler 3000',   prDetails[BOB][CHARLS].Reward.Hodler   == '3000', prDetails[BOB][CHARLS].Reward.Hodler)
check('B→C Operator 333',  prDetails[BOB][CHARLS].Reward.Operator == '333',  prDetails[BOB][CHARLS].Reward.Operator)
check('C→C Hodler 4500',   prDetails[CHARLS][CHARLS].Reward.Hodler   == '4500', prDetails[CHARLS][CHARLS].Reward.Hodler)
check('C→C Operator 500',  prDetails[CHARLS][CHARLS].Reward.Operator == '500',  prDetails[CHARLS][CHARLS].Reward.Operator)

-- cumulative two-level maps; the operator self-key carries their own cut (4500 + 500 + 333)
check('Rewarded[A][B] 1583', S().Rewarded[ALICE .. '/' .. BOB] == '1583', S().Rewarded[ALICE .. '/' .. BOB])
check('Rewarded[B][C] 3000', S().Rewarded[BOB .. '/' .. CHARLS] == '3000', S().Rewarded[BOB .. '/' .. CHARLS])
check('Rewarded[B][B] 83',   S().Rewarded[BOB .. '/' .. BOB] == '83', S().Rewarded[BOB .. '/' .. BOB])
check('Rewarded[C][C] 5333', S().Rewarded[CHARLS .. '/' .. CHARLS] == '5333', S().Rewarded[CHARLS .. '/' .. CHARLS])

-- views resolve through the real VM
local rw = native.view(base, 'rewards', { address = CHARLS })
check('view rewards', rw.Rewarded[CHARLS] == '5333', rw.Rewarded[CHARLS])
local lr = native.view(base, 'last_round')
check('view last_round Period', lr.Period == 10, lr.Period)
local ls = native.view(base, 'last_snapshot')
check('view last_snapshot has Details', ls.Details[ALICE][BOB] ~= nil, tostring(ls.Details))

-- === share-change delay at realistic ms (the unit fix) ===
run('Update-Shares-Configuration', json.encode({ ChangeDelaySeconds = 604800 }))   -- 7 days
run('Set-Share', json.encode({ Share = 0.42 }), nil, T2 + 1000)                    -- OWNER queues
check('queued, not applied', S().Shares[OWNER] == nil, tostring(S().Shares[OWNER]))
check('pending recorded ms', S().PendingShareChanges[OWNER].RequestedTimestamp == T2 + 1000,
  tostring(S().PendingShareChanges[OWNER].RequestedTimestamp))
-- ...and as an INTEGER. `ctx.timestamp` used to be `tonumber(req['timestamp'])`, which under
-- luerl yields a FLOAT — so this PERSISTED field would read back '1783064051855.0' while the
-- same field arriving from the migration seed is an integer. `==` cannot see the difference;
-- tostring can. Tier-1 is blind to it entirely (Lua 5.3 returns an integer there).
check('RequestedTimestamp is an INTEGER, not <ms>.0',
  tostring(S().PendingShareChanges[OWNER].RequestedTimestamp) == tostring(T2 + 1000),
  tostring(S().PendingShareChanges[OWNER].RequestedTimestamp))

round(T2 + 3600 * 1000, all)   -- one hour later: under the legacy ms+seconds bug this would apply
check('7-day delay NOT elapsed after 1h', S().Shares[OWNER] == nil, tostring(S().Shares[OWNER]))

round(T2 + 1000 + 604800 * 1000, all)   -- exactly 7 days after the request
check('7-day delay elapsed at 7d', S().Shares[OWNER] == 0.42, tostring(S().Shares[OWNER]))
check('pending cleared', S().PendingShareChanges[OWNER] == nil,
  tostring(S().PendingShareChanges[OWNER]))

return { pass = pass, fail = fail, failures = failures }
