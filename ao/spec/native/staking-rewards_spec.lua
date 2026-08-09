--- Tier-1 busted spec — native staking-rewards (D26 shape) on the native runtime, under Lua 5.3.
---
--- FULL PARITY with the legacynet WASM harness (test/spec/contracts/staking-rewards/*.spec.ts,
--- 108 it() across 13 files), re-expressed native:
---   · state read from `StakingRewards`; a write's reply is the compute output ('OK', or the rewarded
---     JSON for Claim-Rewards); reads are `native.view(...)`; an assert failure surfaces as
---     `output.data = 'error: <msg>'` and reverts state atomically.
---   · Get-Rewards → view `rewards`; Get-Claimed → view `claimed`; Last-Round-Metadata →
---     `last_round`; Last-Round-Data → `last_round_data`; Last-Snapshot → `last_snapshot`;
---     View-State → `dump`. Init → migrate-on-spawn (seeded base).
---
--- The whole suite runs at Tier-1: the largest value the WASM harness asserts is 7.5e13, far inside
--- 64-bit, so (unlike relay-rewards) no reward magnitude needs arbitrary precision here.
---
--- PLUS: explicit REALISTIC-MILLISECOND share-delay cases. The legacynet harness only ever used toy
--- timestamps (request@1000, round@2000, delay 1000), which pass under either unit reading and so
--- never pinned the semantics — that is exactly how the ms/seconds bug survived. See the
--- 'share-change delay — real millisecond timestamps' block.

local HERE = debug.getinfo(1, 'S').source:match('^@(.*/)') or './'
local AO = HERE .. '../..'
local CT, RT = AO .. '/src/contracts', AO .. '/runtime'
local C, V   = CT .. '/common', RT .. '/vendor'

local function freshEnv()
  for _, m in ipairs({ 'json', '.json', '.common.errors', '.common.utils', '.common.eip55', '.common.bigint' }) do
    package.loaded[m] = nil
  end
  for _, g in ipairs({ 'ao', 'Owner', 'Send', 'compute' }) do _G[g] = nil end
  local function loadmod(p) return assert(loadfile(p))() end
  package.loaded['json']            = loadmod(V .. '/json.lua')
  package.loaded['.json']           = package.loaded['json']
  package.loaded['.common.errors']  = loadmod(C .. '/errors.lua')
  package.loaded['.common.utils']   = loadmod(C .. '/utils.lua')
  package.loaded['.common.eip55']   = loadmod(C .. '/eip55.lua')
  package.loaded['.common.bigint']  = loadmod(C .. '/bigint.lua')
  local native = loadmod(RT .. '/native.lua')
  native.install()
  native.register(loadmod(CT .. '/native/staking-rewards.lua'))
  native.reset()               -- state lives in globals; clear it per test
  return native
end

describe('native staking-rewards — WASM-harness parity (Lua 5.3)', function()
  local native
  local json = nil

  local OWNER  = '0x' .. string.rep('1', 40)
  -- Real mixed-case EIP-55 addresses stored VERBATIM (the WASM harness used 0xAAA…/0xBBB…/0xCCC…;
  -- those are all-one-case so eip55 accepts them, but mixed case proves no stray upper/lower).
  local ALICE  = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
  local BOB    = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC'
  local CHARLS = '0x90F79bf6EB2c4f870365E785982E1f101E93b906'

  local function commit(committer)
    return { c1 = { ['commitment-device'] = 'ans104@1.0', committer = committer } }
  end
  --- assign(action, committer, data, tags?, msgTimestamp?) → device request.
  --- NB: `timestamp` sits at ASSIGNMENT (req) level, not on req.body — that is where the scheduler
  --- puts it (verified on-node); the runtime reads it into `ctx.timestamp` (ms).
  local function assign(action, committer, data, tags, msgTimestamp)
    local taglist = { { name = 'Action', value = action } }
    if tags then for k, v in pairs(tags) do taglist[#taglist + 1] = { name = k, value = v } end end
    local req = { body = {
      action = action, tags = taglist, data = data,
      commitments = committer and commit(committer) or nil,
    } }
    if msgTimestamp then req.timestamp = msgTimestamp end
    return req
  end
  -- Each call starts a FRESH contract: native.reset() clears the state root + ACL globals.
  -- Under globals there is one VM per process, so `base = newBase()` mid-test means
  -- "start over", which is exactly how these tests already used it.
  local function newBase()
    native.reset()
    return { process = { id = 'PID', commitments = commit(OWNER) } }
  end
  local function outData(base) return base.results and base.results.output and base.results.output.data or '' end
  local function has(s, sub) return type(s) == 'string' and s:find(sub, 1, true) ~= nil end
  local function view(base, name, params) return native.view(base, name, params) end

  -- action helpers
  local function updateConfig(base, cfg, from)
    return compute(base, assign('Update-Configuration', from or OWNER, json.encode(cfg)))
  end
  local function updateShares(base, cfg, from)
    return compute(base, assign('Update-Shares-Configuration', from or OWNER, json.encode(cfg)))
  end
  local function toggleShares(base, enabled, from)
    return compute(base, assign('Toggle-Feature-Shares', from or OWNER, json.encode({ Enabled = enabled })))
  end
  local function setShare(base, from, share, msgTs)
    return compute(base, assign('Set-Share', from, json.encode({ Share = share }), nil, msgTs))
  end
  local function addScores(base, scores, ts, from)
    return compute(base, assign('Add-Scores', from or OWNER, json.encode({ Scores = scores }), { ['Round-Timestamp'] = tostring(ts) }))
  end
  local function completeRound(base, ts, from)
    return compute(base, assign('Complete-Round', from or OWNER, nil, { ['Round-Timestamp'] = tostring(ts) }))
  end
  local function cancelRound(base, ts, from)
    return compute(base, assign('Cancel-Round', from or OWNER, nil, { ['Round-Timestamp'] = tostring(ts) }))
  end
  local function claim(base, addr, from)
    return compute(base, assign('Claim-Rewards', from or OWNER, nil, { ['Address'] = addr }))
  end
  local function grantRole(base, addr, roles)
    return compute(base, assign('Update-Roles', OWNER, json.encode({ Grant = { [addr] = roles } })))
  end
  local function round(base, ts, scores) addScores(base, scores, ts); return completeRound(base, ts) end
  local function stake(staked, running) return { Staked = staked, Running = running } end
  local function snapshot(base) return StakingRewards.PreviousRound end

  before_each(function() native = freshEnv(); json = require('json') end)

  -- =========================================================================
  -- acl.spec.ts (8)
  -- =========================================================================
  describe('ACL enforcement', function()
    local MOCK = { [ALICE] = { [BOB] = stake('1', 0.0) } }

    it('Update-Configuration: allows Admin Role', function()
      local base = newBase(); grantRole(base, ALICE, { 'admin' })
      assert.are.equal('OK', outData(updateConfig(base, { TokensPerSecond = '100', Requirements = { Running = 0.1 } }, ALICE)))
      assert.are.equal('100', StakingRewards.Configuration.TokensPerSecond)
    end)
    it('Update-Configuration: allows Update-Configuration Role', function()
      local base = newBase(); grantRole(base, BOB, { 'Update-Configuration' })
      assert.are.equal('OK', outData(updateConfig(base, { TokensPerSecond = '100', Requirements = { Running = 0.5 } }, BOB)))
    end)
    it('Add-Scores: allows Admin Role', function()
      local base = newBase(); grantRole(base, ALICE, { 'admin' })
      assert.are.equal('OK', outData(addScores(base, MOCK, 1000, ALICE)))
    end)
    it('Add-Scores: allows Add-Scores Role', function()
      local base = newBase(); grantRole(base, BOB, { 'Add-Scores' })
      assert.are.equal('OK', outData(addScores(base, MOCK, 1000, BOB)))
    end)
    it('Complete-Round: allows Admin Role', function()
      local base = newBase(); grantRole(base, ALICE, { 'admin' })
      addScores(base, MOCK, 2000)
      assert.are.equal('OK', outData(completeRound(base, 2000, ALICE)))
    end)
    it('Complete-Round: allows Complete-Round Role', function()
      local base = newBase(); grantRole(base, BOB, { 'Complete-Round' })
      addScores(base, MOCK, 2000)
      assert.are.equal('OK', outData(completeRound(base, 2000, BOB)))
    end)
    it('Cancel-Round: allows Admin Role', function()
      local base = newBase(); grantRole(base, ALICE, { 'admin' })
      addScores(base, MOCK, 2000)
      assert.are.equal('OK', outData(cancelRound(base, 2000, ALICE)))
    end)
    it('Cancel-Round: allows Cancel-Round Role', function()
      local base = newBase(); grantRole(base, BOB, { 'Cancel-Round' })
      addScores(base, MOCK, 2000)
      assert.are.equal('OK', outData(cancelRound(base, 2000, BOB)))
    end)
  end)

  -- =========================================================================
  -- configuration.spec.ts (4)
  -- =========================================================================
  describe('Update-Configuration', function()
    it('Blocks non-owners from doing updates', function()
      local base = newBase()
      updateConfig(base, { TokensPerSecond = '1' }, ALICE)
      assert.is_true(has(outData(base), 'Permission Denied'))
    end)
    it('Requires message data to be JSON', function()
      local base = newBase()
      compute(base, assign('Update-Configuration', OWNER, nil))
      assert.is_true(has(outData(base), 'Message data is required'))
    end)
    it('Ensures TokensPerSecond is a string integer and >= 0', function()
      local base = newBase()
      assert.is_true(has(outData(updateConfig(base, { TokensPerSecond = '' })), 'TokensPerSecond'))
      assert.is_true(has(outData(updateConfig(base, { TokensPerSecond = '-100' })), 'TokensPerSecond'))
      assert.is_true(has(outData(updateConfig(base, { TokensPerSecond = 100 })), 'TokensPerSecond'))
    end)
    it('Ensures Requirements.Running is a float 0..1', function()
      local base = newBase()
      assert.is_true(has(outData(updateConfig(base, { Requirements = { Running = '' } })), 'Running'))
      assert.is_true(has(outData(updateConfig(base, { Requirements = { Running = 1.1 } })), 'Running'))
      assert.is_true(has(outData(updateConfig(base, { Requirements = { Running = -1.1 } })), 'Running'))
      assert.is_true(has(outData(updateConfig(base, { Requirements = { Running = '10' } })), 'Running'))
    end)
  end)

  -- =========================================================================
  -- add-scores.spec.ts (11)
  -- =========================================================================
  describe('Add-Scores', function()
    local REF = { [ALICE] = { [BOB] = stake('1', 0.0) } }

    it('Blocks non-owners from doing updates', function()
      local base = newBase()
      addScores(base, REF, 1000, ALICE)
      assert.is_true(has(outData(base), 'Permission Denied'))
    end)
    it('Requires message data to be JSON', function()
      local base = newBase()
      compute(base, assign('Add-Scores', OWNER, nil, { ['Round-Timestamp'] = '1000' }))
      assert.is_true(has(outData(base), 'Message data is required'))
    end)
    it('Ensures provided timestamp is integer', function()
      local base = newBase()
      compute(base, assign('Add-Scores', OWNER, json.encode({ Scores = REF })))
      assert.is_true(has(outData(base), 'Timestamp tag'))
      compute(base, assign('Add-Scores', OWNER, json.encode({ Scores = REF }), { ['Round-Timestamp'] = '' }))
      assert.is_true(has(outData(base), 'Timestamp tag'))
      compute(base, assign('Add-Scores', OWNER, json.encode({ Scores = REF }), { ['Round-Timestamp'] = 'bad-stamp' }))
      assert.is_true(has(outData(base), 'Timestamp tag'))
      -- Numeric but FRACTIONAL. `utils.parseInt` (the A12 workaround) rejects any non-digit
      -- byte, which is what keeps this out; plain `tonumber` would return 1000.5 and let a
      -- fractional round timestamp into state. The legacy suite asserted integer-ness; no
      -- native spec covered this case until now.
      compute(base, assign('Add-Scores', OWNER, json.encode({ Scores = REF }), { ['Round-Timestamp'] = '1000.5' }))
      assert.is_true(has(outData(base), 'Timestamp tag'))
    end)
    it('Ensures timestamp is > 0', function()
      local base = newBase()
      compute(base, assign('Add-Scores', OWNER, json.encode({ Scores = REF }), { ['Round-Timestamp'] = '0' }))
      assert.is_true(has(outData(base), 'has to be > 0'))
      compute(base, assign('Add-Scores', OWNER, json.encode({ Scores = REF }), { ['Round-Timestamp'] = '-100' }))
      assert.is_true(has(outData(base), 'has to be > 0'))
    end)
    it('Ensures timestamp is not backdated to previous round', function()
      local base = newBase()
      updateConfig(base, { TokensPerSecond = '100', Requirements = { Running = 0.5 } })
      assert.are.equal('OK', outData(addScores(base, REF, 10)))
      assert.are.equal('OK', outData(completeRound(base, 10)))
      addScores(base, REF, 10)
      assert.is_true(has(outData(base), 'backdated'))
      assert.are.equal('OK', outData(addScores(base, REF, 20)))
    end)
    it('Scores must be a table', function()
      local base = newBase()
      compute(base, assign('Add-Scores', OWNER, json.encode({ Scores = 'some scores' }), { ['Round-Timestamp'] = '1000' }))
      assert.is_true(has(outData(base), 'Scores have to be a table'))
    end)
    it('Each score - Hodler address has valid format', function()
      local base = newBase()
      addScores(base, { ['asd'] = { [BOB] = stake('1', 0.0) } }, 1000)
      assert.is_true(has(outData(base), 'Invalid Hodler Address'))
    end)
    it('Each score - score was not duplicated during round scoring', function()
      local base = newBase()
      assert.are.equal('OK', outData(addScores(base, REF, 5)))
      addScores(base, REF, 5)
      assert.is_true(has(outData(base), 'Duplicated score'))
    end)
    it('Each score - Operator address must be a valid EVM address', function()
      local base = newBase()
      addScores(base, { [ALICE] = { ['asd'] = stake('1', 0.0) } }, 1000)
      assert.is_true(has(outData(base), 'Invalid Operator address: Scores[' .. ALICE .. '][asd]'))
    end)
    it('Each score - Staked must be a string integer > 0', function()
      local base = newBase()
      addScores(base, { [ALICE] = { [BOB] = stake('', 0.0) } }, 1000)
      assert.is_true(has(outData(base), 'failed parsing to bint'))
      addScores(base, { [ALICE] = { [BOB] = stake('-1', 0.0) } }, 1000)
      assert.is_true(has(outData(base), 'must be positive value'))
      addScores(base, { [ALICE] = { [BOB] = stake('0', 0.0) } }, 1000)
      assert.is_true(has(outData(base), 'must be positive value'))
      addScores(base, { [ALICE] = { [BOB] = { Running = 0.0 } } }, 1000)
      assert.is_true(has(outData(base), 'must be a string number'))
    end)
    it('Each score - Running must be a float 0..1', function()
      local base = newBase()
      addScores(base, { [ALICE] = { [BOB] = { Staked = '1', Running = '' } } }, 1000)
      assert.is_true(has(outData(base), 'Number value required'))
      addScores(base, { [ALICE] = { [BOB] = { Staked = '1' } } }, 1000)
      assert.is_true(has(outData(base), 'Number value required'))
      addScores(base, { [ALICE] = { [BOB] = stake('1', 1.1) } }, 1000)
      assert.is_true(has(outData(base), 'has to be <= 1'))
      addScores(base, { [ALICE] = { [BOB] = stake('1', -0.1) } }, 1000)
      assert.is_true(has(outData(base), 'has to be >= 0'))
      -- validate-before-mutate: none of the above staged anything
      assert.is_nil(StakingRewards.PendingRounds['1000'])
    end)
  end)

  -- =========================================================================
  -- round-cancel.spec.ts (4)
  -- =========================================================================
  describe('Cancel-Round', function()
    it('Blocks non-owners from doing updates', function()
      local base = newBase()
      cancelRound(base, 1000, ALICE)
      assert.is_true(has(outData(base), 'Permission Denied'))
    end)
    it('Ensure provided timestamp is integer', function()
      local base = newBase()
      compute(base, assign('Cancel-Round', OWNER, nil))
      assert.is_true(has(outData(base), 'Timestamp tag'))
      compute(base, assign('Cancel-Round', OWNER, nil, { ['Round-Timestamp'] = 'bad-stamp' }))
      assert.is_true(has(outData(base), 'Timestamp tag'))
    end)
    it('Confirms pending round exists for timestamp', function()
      local base = newBase()
      cancelRound(base, 1234567890)
      assert.is_true(has(outData(base), 'No pending round for 1234567890'))
    end)
    it('Removes pending round for timestamp', function()
      local base = newBase()
      addScores(base, { [ALICE] = { [BOB] = stake('1', 0.3) } }, 1234567890)
      assert.are.equal('OK', outData(cancelRound(base, 1234567890)))
      assert.is_nil(StakingRewards.PendingRounds['1234567890'])
    end)
  end)

  -- =========================================================================
  -- round-complete.spec.ts (11)
  -- =========================================================================
  describe('Complete-Round', function()
    it('Blocks non-owners from doing updates', function()
      local base = newBase()
      completeRound(base, 1000, ALICE)
      assert.is_true(has(outData(base), 'Permission Denied'))
    end)
    it('Ensures provided timestamp is integer', function()
      local base = newBase()
      compute(base, assign('Complete-Round', OWNER, nil))
      assert.is_true(has(outData(base), 'Timestamp tag'))
      compute(base, assign('Complete-Round', OWNER, nil, { ['Round-Timestamp'] = 'bad-stamp' }))
      assert.is_true(has(outData(base), 'Timestamp tag'))
    end)
    it('Confirms pending round exists for given timestamp', function()
      local base = newBase()
      completeRound(base, 1000)
      assert.is_true(has(outData(base), 'No pending round for 1000'))
    end)
    it('Removes rounds dated before completed timestamp', function()
      local base = newBase()
      updateConfig(base, { TokensPerSecond = '100000000', Requirements = { Running = 0.5 } })
      addScores(base, { [ALICE] = { [BOB] = stake('1', 0.0) } }, 1000)
      addScores(base, { [BOB] = { [BOB] = stake('100', 0.8) } }, 2000)
      completeRound(base, 2000)
      cancelRound(base, 1000)
      assert.is_true(has(outData(base), 'No pending round for 1000'))
    end)
    it('Tracks data and metadata of the last round', function()
      local base = newBase()
      updateConfig(base, { TokensPerSecond = '100000000', Requirements = { Running = 0.5 } })
      local REF = { [ALICE] = { [BOB] = stake('1', 0.0) }, [BOB] = { [BOB] = stake('100', 0.8) } }
      round(base, 1000, REF)   -- Period 0
      round(base, 2000, REF)   -- Period 1
      local lrd = view(base, 'last_round_data', { address = BOB })
      assert.are.equal('100000000', lrd.Details[BOB].Reward.Hodler)
      local meta = view(base, 'last_round')
      assert.are.equal(2000, meta.Timestamp)
      assert.are.equal(1, meta.Period)
      assert.are.equal('100000000', meta.Configuration.TokensPerSecond)
      assert.are.equal('101', meta.Summary.Stakes)
      assert.are.equal('100', meta.Summary.Ratings)
      assert.are.equal('100000000', meta.Summary.Rewards)
      local snap = view(base, 'last_snapshot')
      assert.are.equal(2000, snap.Timestamp)
      local n = 0; for _ in pairs(snap.Details) do n = n + 1 end
      assert.are.equal(2, n)
    end)

    describe('uses default share for new operators', function()
      local REF = { [ALICE] = { [BOB] = stake('1', 0.5) } }
      local function base100()
        local b = newBase()
        updateConfig(b, { TokensPerSecond = '100', Requirements = { Running = 0.5 } })
        return b
      end

      it('New operator uses default share (not persisted to Shares table)', function()
        local base = base100()
        toggleShares(base, true); updateShares(base, { Default = 0.15, Min = 0, Max = 1 })
        round(base, 1000, REF)
        assert.is_nil(StakingRewards.Shares[BOB])
        assert.are.equal(0.15, snapshot(base).Details[ALICE][BOB].Score.Share)
      end)
      it('Existing operator retains their set share', function()
        local base = base100()
        toggleShares(base, true)
        updateShares(base, { SetSharesEnabled = true, ChangeDelaySeconds = 0, Default = 0.1, Min = 0, Max = 1 })
        setShare(base, BOB, 0.3, 1000)
        round(base, 2000, REF)
        assert.are.equal(0.3, StakingRewards.Shares[BOB])
        assert.are.equal(0.3, snapshot(base).Details[ALICE][BOB].Score.Share)
      end)
      it('New operator continues to use default share across rounds (no persistence)', function()
        local base = base100()
        toggleShares(base, true); updateShares(base, { Default = 0.2, Min = 0, Max = 1 })
        round(base, 1000, REF)
        updateShares(base, { Default = 0.35 })
        round(base, 2000, REF)
        assert.is_nil(StakingRewards.Shares[BOB])
        assert.are.equal(0.35, snapshot(base).Details[ALICE][BOB].Score.Share)
      end)
      it('New operator gets share 0.0 when shares are disabled', function()
        local base = base100()
        round(base, 1000, REF)
        assert.is_nil(StakingRewards.Shares[BOB])
        assert.are.equal(0.0, snapshot(base).Details[ALICE][BOB].Score.Share)
      end)
      it('Multiple new operators all use default share (not persisted)', function()
        local base = base100()
        toggleShares(base, true); updateShares(base, { Default = 0.25, Min = 0, Max = 1 })
        round(base, 1000, { [ALICE] = { [BOB] = stake('100', 0.8), [CHARLS] = stake('200', 0.9) } })
        assert.is_nil(StakingRewards.Shares[BOB])
        assert.is_nil(StakingRewards.Shares[CHARLS])
        assert.are.equal(0.25, snapshot(base).Details[ALICE][BOB].Score.Share)
        assert.are.equal(0.25, snapshot(base).Details[ALICE][CHARLS].Score.Share)
      end)
      it('Share is correctly snapshotted in PendingRounds for new operator', function()
        local base = base100()
        toggleShares(base, true); updateShares(base, { Default = 0.18, Min = 0, Max = 1 })
        round(base, 1000, REF)
        assert.are.equal(0.18, view(base, 'last_snapshot').Details[ALICE][BOB].Score.Share)
      end)
    end)
  end)

  -- =========================================================================
  -- score-ratings.spec.ts (1)
  -- =========================================================================
  describe('Score ratings', function()
    it('Calculate ratings only for scores passing the running requirement', function()
      local base = newBase()
      updateConfig(base, { TokensPerSecond = '1000', Requirements = { Running = 0.5 } })
      round(base, 1000, { [ALICE] = { [BOB] = stake('1000', 0.7) } })   -- Period 0

      -- @2000: ALICE→BOB passes (0.7), BOB→CHARLS fails (0.3)
      round(base, 2000, { [ALICE] = { [BOB] = stake('1000', 0.7) }, [BOB] = { [CHARLS] = stake('1000', 0.3) } })
      local s = snapshot(base)
      assert.are.equal('1000', s.Summary.Rewards)
      assert.are.equal('1000', s.Summary.Ratings)
      assert.are.equal('2000', s.Summary.Stakes)
      assert.are.equal('1000', s.Details[ALICE][BOB].Score.Staked)
      assert.are.equal('0', s.Details[ALICE][BOB].Score.Restaked)
      assert.are.equal('1000', s.Details[ALICE][BOB].Rating)
      assert.are.equal('1000', s.Details[ALICE][BOB].Reward.Hodler)
      assert.are.equal('1000', s.Details[BOB][CHARLS].Score.Staked)
      assert.are.equal('0', s.Details[BOB][CHARLS].Rating)
      assert.are.equal('0', s.Details[BOB][CHARLS].Reward.Hodler)

      -- @3000: roles flipped
      round(base, 3000, { [ALICE] = { [BOB] = stake('1000', 0.1) }, [BOB] = { [CHARLS] = stake('1000', 0.8) } })
      s = snapshot(base)
      assert.are.equal('2000', s.Summary.Stakes)
      assert.are.equal('1000', s.Summary.Ratings)
      assert.are.equal('1000', s.Summary.Rewards)
      assert.are.equal('0', s.Details[ALICE][BOB].Rating)
      assert.are.equal('0', s.Details[ALICE][BOB].Reward.Hodler)
      assert.are.equal('1000', s.Details[BOB][CHARLS].Rating)
      assert.are.equal('1000', s.Details[BOB][CHARLS].Reward.Hodler)
      assert.are.equal('1000', s.Details[BOB][CHARLS].Score.Staked)

      -- @4000: both pass, both now carry restake from their prior reward
      round(base, 4000, { [ALICE] = { [BOB] = stake('1000', 0.8) }, [BOB] = { [CHARLS] = stake('1000', 0.8) } })
      s = snapshot(base)
      assert.are.equal('4000', s.Summary.Stakes)
      assert.are.equal('4000', s.Summary.Ratings)
      assert.are.equal('1000', s.Summary.Rewards)
      for _, pair in ipairs({ { ALICE, BOB }, { BOB, CHARLS } }) do
        local d = s.Details[pair[1]][pair[2]]
        assert.are.equal('1000', d.Score.Staked)
        assert.are.equal('1000', d.Score.Restaked)
        assert.are.equal('2000', d.Rating)
        assert.are.equal('500', d.Reward.Hodler)
      end
    end)
  end)

  -- =========================================================================
  -- score-rewards.spec.ts (3)
  -- =========================================================================
  describe('Score rewards', function()
    local s1 = { [ALICE] = { [BOB] = stake('1000', 0.6) } }
    local s2 = { [BOB] = { [CHARLS] = stake('2000', 0.7) } }
    local s3 = { [CHARLS] = { [CHARLS] = stake('3000', 0.8) } }
    local all = { [ALICE] = { [BOB] = stake('1000', 0.6) },
                  [BOB] = { [CHARLS] = stake('2000', 0.7) },
                  [CHARLS] = { [CHARLS] = stake('3000', 0.8) } }

    --- shares enabled + operator-set shares, CHARLS on 0.1, everyone else on the 0.05 default
    local function sharedBase()
      local base = newBase()
      updateConfig(base, { TokensPerSecond = '1000', Requirements = { Running = 0.5 } })
      toggleShares(base, true)
      updateShares(base, { SetSharesEnabled = true, ChangeDelaySeconds = 0, Default = 0.05, Min = 0, Max = 1 })
      setShare(base, CHARLS, 0.1, 500)
      return base
    end

    it('Calculates a correct period since the last round', function()
      local base = newBase()
      updateConfig(base, { TokensPerSecond = '1000', Requirements = { Running = 0.5 } })
      round(base, 1000, s1)
      round(base, 2345, s1)
      assert.are.equal(2345, view(base, 'last_round').Timestamp)
      assert.are.equal(math.floor((2345 - 1000) / 1000), view(base, 'last_round').Period)   -- 1
      round(base, 40000, s1)
      assert.are.equal(40000, view(base, 'last_round').Timestamp)
      assert.are.equal(math.floor((40000 - 2345) / 1000), view(base, 'last_round').Period)  -- 37
    end)

    it('Proportionally rewards hodlers based on their rating', function()
      local base = sharedBase()
      round(base, 1000, s1)   -- Period 0 → no rewards
      local s = snapshot(base)
      assert.are.equal(1000, s.Timestamp)
      assert.are.equal(0, s.Period)
      assert.are.equal('1000', s.Summary.Ratings)
      assert.are.equal('1000', s.Summary.Stakes)
      assert.are.equal('0', s.Summary.Rewards)
      assert.are.same({ Reward = { Operator = '0', Hodler = '0' }, Rating = '1000',
        Score = { Running = 0.6, Restaked = '0', Staked = '1000', Share = 0.05 } }, s.Details[ALICE][BOB])
      -- zero rewards are never written into Rewarded (bint.ispos gate), but the maps exist
      assert.is_not_nil(StakingRewards.Rewarded[ALICE])
      assert.is_nil(StakingRewards.Rewarded[ALICE][BOB])

      round(base, 11000, all)   -- Period 10
      s = snapshot(base)
      assert.are.equal('6000', s.Summary.Ratings)
      assert.are.equal('6000', s.Summary.Stakes)
      assert.are.equal('9999', s.Summary.Rewards)
      assert.are.same({ Reward = { Hodler = '1583', Operator = '83' }, Rating = '1000',
        Score = { Running = 0.6, Restaked = '0', Staked = '1000', Share = 0.05 } }, s.Details[ALICE][BOB])
      assert.are.same({ Reward = { Hodler = '3000', Operator = '333' }, Rating = '2000',
        Score = { Running = 0.7, Restaked = '0', Staked = '2000', Share = 0.1 } }, s.Details[BOB][CHARLS])
      assert.are.same({ Reward = { Hodler = '4500', Operator = '500' }, Rating = '3000',
        Score = { Running = 0.8, Restaked = '0', Staked = '3000', Share = 0.1 } }, s.Details[CHARLS][CHARLS])
      assert.are.equal(11000, view(base, 'last_round').Timestamp)
      assert.are.equal(10, view(base, 'last_round').Period)
      -- cumulative maps (operator self-key carries their own cut)
      assert.are.equal('1583', StakingRewards.Rewarded[ALICE][BOB])
      assert.are.equal('3000', StakingRewards.Rewarded[BOB][CHARLS])
      assert.are.equal('83', StakingRewards.Rewarded[BOB][BOB])
      assert.are.equal('5333', StakingRewards.Rewarded[CHARLS][CHARLS])   -- 4500 + 500 + 333
    end)

    it('Accumulates rewards for hodlers and operators', function()
      local base = sharedBase()
      round(base, 1000, s1)
      round(base, 11000, all)
      assert.are.equal('1583', view(base, 'rewards', { address = ALICE }).Rewarded[BOB])
      assert.are.equal('3000', view(base, 'rewards', { address = BOB }).Rewarded[CHARLS])
      assert.are.equal('5333', view(base, 'rewards', { address = CHARLS }).Rewarded[CHARLS])

      round(base, 21000, all)
      assert.are.equal('9998', snapshot(base).Summary.Rewards)
      assert.are.equal(21000, view(base, 'last_round').Timestamp)
      assert.are.equal(10, view(base, 'last_round').Period)
      assert.are.equal('3124', view(base, 'rewards', { address = ALICE }).Rewarded[BOB])
      assert.are.equal('5827', view(base, 'rewards', { address = BOB }).Rewarded[CHARLS])
      assert.are.equal('10882', view(base, 'rewards', { address = CHARLS }).Rewarded[CHARLS])
    end)
  end)

  -- =========================================================================
  -- claim-rewards.spec.ts (1)
  -- =========================================================================
  describe('Claim-Rewards', function()
    local all = { [ALICE] = { [BOB] = stake('1000', 0.6) },
                  [BOB] = { [CHARLS] = stake('2000', 0.7) },
                  [CHARLS] = { [CHARLS] = stake('3000', 0.8) } }

    it('Tracks Claimed, rewarded tokens', function()
      local base = newBase()
      updateConfig(base, { TokensPerSecond = '1000', Requirements = { Running = 0.5 } })
      toggleShares(base, true)
      updateShares(base, { SetSharesEnabled = true, ChangeDelaySeconds = 0, Default = 0.05, Min = 0, Max = 1 })
      setShare(base, CHARLS, 0.1, 500)
      round(base, 1000, { [ALICE] = { [BOB] = stake('1000', 0.6) } })
      round(base, 11000, all)

      assert.are.equal('1583', view(base, 'rewards', { address = ALICE }).Rewarded[BOB])
      assert.are.equal('3000', view(base, 'rewards', { address = BOB }).Rewarded[CHARLS])
      assert.are.equal('5333', view(base, 'rewards', { address = CHARLS }).Rewarded[CHARLS])
      -- nothing claimed yet
      for _, a in ipairs({ ALICE, BOB, CHARLS }) do
        local n = 0; for _ in pairs(view(base, 'rewards', { address = a }).Claimed) do n = n + 1 end
        assert.are.equal(0, n)
      end

      -- claim CHARLS then BOB
      assert.are.equal('5333', json.decode(outData(claim(base, CHARLS)))[CHARLS])
      assert.are.equal('5333', StakingRewards.Claimed[CHARLS][CHARLS])
      assert.are.equal('3000', json.decode(outData(claim(base, BOB)))[CHARLS])
      assert.are.equal('3000', StakingRewards.Claimed[BOB][CHARLS])
      assert.are.equal('83', StakingRewards.Claimed[BOB][BOB])
      assert.are.equal('5333', view(base, 'claimed', { address = CHARLS }).claimed[CHARLS])

      -- next round: claimed stakes stop counting as restake
      round(base, 21000, all)
      assert.are.equal('4819', view(base, 'rewards', { address = ALICE }).Rewarded[BOB])
      assert.are.equal('5374', view(base, 'rewards', { address = BOB }).Rewarded[CHARLS])
      assert.are.equal('3000', view(base, 'rewards', { address = BOB }).Claimed[CHARLS])
      assert.are.equal('253', StakingRewards.Rewarded[BOB][BOB])
      assert.are.equal('9552', view(base, 'rewards', { address = CHARLS }).Rewarded[CHARLS])
      assert.are.equal('5333', view(base, 'rewards', { address = CHARLS }).Claimed[CHARLS])

      assert.are.equal('4819', json.decode(outData(claim(base, ALICE)))[BOB])
      assert.are.equal('5374', json.decode(outData(claim(base, BOB)))[CHARLS])
      assert.are.equal('4819', view(base, 'claimed', { address = ALICE }).claimed[BOB])
      assert.are.equal('5374', view(base, 'claimed', { address = BOB }).claimed[CHARLS])
    end)

    it('Errors when the hodler has no rewards', function()
      local base = newBase()
      claim(base, ALICE)
      assert.is_true(has(outData(base), 'No rewards for'))
    end)
  end)

  -- =========================================================================
  -- set-share.spec.ts (7) + shares-configuration describe B (5)
  -- =========================================================================
  describe('Set-Share', function()
    local function enabled()
      local base = newBase()
      toggleShares(base, true)
      updateShares(base, { SetSharesEnabled = true })
      return base
    end

    it('Rejects empty Share value', function()
      assert.is_true(has(outData(setShare(enabled(), ALICE, '', 1000)), 'Number value required'))
    end)
    it('Rejects string Share value', function()
      assert.is_true(has(outData(setShare(enabled(), ALICE, '1', 1000)), 'Number value required'))
    end)
    it('Rejects Share > 1', function()
      assert.is_true(has(outData(setShare(enabled(), ALICE, 1.1, 1000)), 'has to be <= 1'))
    end)
    it('Rejects Share < 0', function()
      assert.is_true(has(outData(setShare(enabled(), ALICE, -0.1, 1000)), 'has to be >= 0'))
    end)
    it('Accepts Share of 0', function()
      assert.are.equal('OK', outData(setShare(enabled(), ALICE, 0, 1000)))
    end)
    it('Accepts Share of 1', function()
      assert.are.equal('OK', outData(setShare(enabled(), ALICE, 1, 1000)))
    end)
    it('Accepts a valid Share between 0 and 1', function()
      assert.are.equal('OK', outData(setShare(enabled(), ALICE, 0.5, 1000)))
    end)

    it('Rejects a share below configured Min / above configured Max, accepts the boundaries', function()
      local base = enabled()
      updateShares(base, { Min = 0.2, Max = 0.8, Default = 0.5 })
      assert.is_true(has(outData(setShare(base, ALICE, 0.1, 1000)), 'Share has to be >= 0.2'))
      assert.is_true(has(outData(setShare(base, ALICE, 0.9, 1000)), 'Share has to be <= 0.8'))
      assert.are.equal('OK', outData(setShare(base, ALICE, 0.2, 1000)))
      assert.are.equal('OK', outData(setShare(base, ALICE, 0.8, 1000)))
    end)
    it('Uses default 0-1 bounds when configuration not updated', function()
      local base = enabled()
      assert.are.equal('OK', outData(setShare(base, ALICE, 0.0, 1000)))
      assert.are.equal('OK', outData(setShare(base, BOB, 1.0, 1000)))
    end)
  end)

  -- =========================================================================
  -- shares-configuration.spec.ts describe A (26) + C (3)
  -- =========================================================================
  describe('Update-Shares-Configuration', function()
    it('Blocks non-owners from doing updates', function()
      local base = newBase()
      updateShares(base, { Min = 0.1 }, ALICE)
      assert.is_true(has(outData(base), 'Permission Denied'))
    end)
    it('Allows owner to update shares configuration', function()
      assert.are.equal('OK', outData(updateShares(newBase(), { Default = 0.1 })))
    end)
    it('Allows admin role to update shares configuration', function()
      local base = newBase(); grantRole(base, ALICE, { 'admin' })
      assert.are.equal('OK', outData(updateShares(base, { Default = 0.2 }, ALICE)))
    end)
    it('Allows the Update-Shares-Configuration specific role', function()
      local base = newBase(); grantRole(base, BOB, { 'Update-Shares-Configuration' })
      assert.are.equal('OK', outData(updateShares(base, { Min = 0.05, Default = 0.05 }, BOB)))
    end)
    it('Denies users with other roles but not Update-Shares-Configuration', function()
      local base = newBase(); grantRole(base, CHARLS, { 'Add-Scores' })
      updateShares(base, { Default = 0.1 }, CHARLS)
      assert.is_true(has(outData(base), 'Permission Denied'))
    end)
    it('Requires message data to be JSON', function()
      local base = newBase()
      compute(base, assign('Update-Shares-Configuration', OWNER, nil))
      assert.is_true(has(outData(base), 'Message data is required'))
    end)
    it('Ensures Min is a number between 0 and 1', function()
      local base = newBase()
      assert.is_true(has(outData(updateShares(base, { Min = 'string' })), 'Min'))
      assert.is_true(has(outData(updateShares(base, { Min = -0.1 })), 'Min has to be >= 0'))
      assert.is_true(has(outData(updateShares(base, { Min = 1.1 })), 'Min has to be <= 1'))
    end)
    it('Ensures Max is a number between 0 and 1', function()
      local base = newBase()
      assert.is_true(has(outData(updateShares(base, { Max = 'string' })), 'Max'))
      assert.is_true(has(outData(updateShares(base, { Max = -0.1 })), 'Max has to be >= 0'))
      assert.is_true(has(outData(updateShares(base, { Max = 1.5 })), 'Max has to be <= 1'))
    end)
    it('Ensures Default is a number between 0 and 1', function()
      local base = newBase()
      assert.is_true(has(outData(updateShares(base, { Default = 'string' })), 'Default'))
      assert.is_true(has(outData(updateShares(base, { Default = -0.5 })), 'Default has to be >= 0'))
      assert.is_true(has(outData(updateShares(base, { Default = 2.0 })), 'Default has to be <= 1'))
    end)
    it('Accepts edge case values 0.0 and 1.0', function()
      local base = newBase()
      assert.are.equal('OK', outData(updateShares(base, { Min = 0, Max = 1, Default = 0 })))
      assert.are.equal('OK', outData(updateShares(base, { Min = 1, Max = 1, Default = 1 })))
    end)
    it('Allows omitting all fields (no-op update)', function()
      assert.are.equal('OK', outData(updateShares(newBase(), {})))
    end)
    it('Updates only the provided field, leaving the others', function()
      local base = newBase()
      updateShares(base, { Min = 0.1, Max = 0.9, Default = 0.5 })
      updateShares(base, { Min = 0.2 })
      local sh = StakingRewards.Configuration.Shares
      assert.are.equal(0.2, sh.Min); assert.are.equal(0.9, sh.Max); assert.are.equal(0.5, sh.Default)
      updateShares(base, { Max = 0.8 })
      assert.are.equal(0.2, sh.Min); assert.are.equal(0.8, StakingRewards.Configuration.Shares.Max)
      updateShares(base, { Default = 0.3 })
      assert.are.equal(0.3, StakingRewards.Configuration.Shares.Default)
    end)
    it('Rejects Min > Max', function()
      assert.is_true(has(outData(updateShares(newBase(), { Min = 0.8, Max = 0.2 })), 'Min must be <= Max'))
    end)
    it('Rejects Default < Min', function()
      assert.is_true(has(outData(updateShares(newBase(), { Min = 0.3, Max = 0.9, Default = 0.1 })), 'Default must be >= Min'))
    end)
    it('Rejects Default > Max', function()
      assert.is_true(has(outData(updateShares(newBase(), { Min = 0.1, Max = 0.5, Default = 0.8 })), 'Default must be <= Max'))
    end)
    it('Rejects updating Min above the existing Default', function()
      local base = newBase()
      updateShares(base, { Min = 0.1, Max = 0.9, Default = 0.3 })
      assert.is_true(has(outData(updateShares(base, { Min = 0.5 })), 'Default must be >= Min'))
    end)
    it('Rejects updating Max below the existing Default', function()
      local base = newBase()
      updateShares(base, { Min = 0.1, Max = 0.9, Default = 0.7 })
      assert.is_true(has(outData(updateShares(base, { Max = 0.5 })), 'Default must be <= Max'))
    end)
    it('Allows Min == Max == Default', function()
      assert.are.equal('OK', outData(updateShares(newBase(), { Min = 0.5, Max = 0.5, Default = 0.5 })))
    end)

    describe('retroactive clamping of existing operator shares', function()
      -- ChangeDelaySeconds = 0 so Set-Share applies immediately (otherwise the change is correctly
      -- QUEUED into PendingShareChanges and there is nothing in `Shares` to clamp).
      local function withShare(addr, share, extra)
        local base = newBase()
        toggleShares(base, true)
        updateShares(base, { SetSharesEnabled = true, ChangeDelaySeconds = 0, Min = 0, Max = 1, Default = 0.5 })
        setShare(base, addr, share, 1000)
        if extra then setShare(base, extra[1], extra[2], 1000) end
        return base
      end
      it('Clamps existing shares when Min is raised', function()
        local base = withShare(ALICE, 0.1)
        updateShares(base, { Min = 0.3, Default = 0.3 })
        assert.are.equal(0.3, StakingRewards.Shares[ALICE])
      end)
      it('Clamps existing shares when Max is lowered', function()
        local base = withShare(ALICE, 0.8)
        updateShares(base, { Max = 0.5, Default = 0.5 })
        assert.are.equal(0.5, StakingRewards.Shares[ALICE])
      end)
      it('Leaves shares untouched when no clamping is needed', function()
        local base = withShare(ALICE, 0.5)
        updateShares(base, { Min = 0.1, Max = 0.9, Default = 0.5 })
        assert.are.equal(0.5, StakingRewards.Shares[ALICE])
      end)
      it('Clamps multiple operator shares simultaneously', function()
        local base = withShare(ALICE, 0.1, { BOB, 0.9 })
        updateShares(base, { Min = 0.3, Max = 0.7, Default = 0.5 })
        assert.are.equal(0.3, StakingRewards.Shares[ALICE])
        assert.are.equal(0.7, StakingRewards.Shares[BOB])
      end)
      it('Keeps unmodified shares alongside clamped ones', function()
        local base = withShare(ALICE, 0.1, { BOB, 0.5 })
        updateShares(base, { Min = 0.3, Default = 0.3 })
        assert.are.equal(0.3, StakingRewards.Shares[ALICE])
        assert.are.equal(0.5, StakingRewards.Shares[BOB])
      end)
      it('Handles an empty Shares state gracefully', function()
        assert.are.equal('OK', outData(updateShares(newBase(), { Min = 0.2, Max = 0.8, Default = 0.5 })))
      end)
    end)
  end)

  describe('Toggle-Feature-Shares', function()
    it('Enables and disables the shares feature', function()
      local base = newBase()
      assert.are.equal('OK', outData(toggleShares(base, true)))
      assert.is_true(StakingRewards.Configuration.Shares.Enabled)
      assert.are.equal('OK', outData(toggleShares(base, false)))
      assert.is_false(StakingRewards.Configuration.Shares.Enabled)
    end)
    it('Requires Enabled to be a boolean', function()
      local base = newBase()
      compute(base, assign('Toggle-Feature-Shares', OWNER, json.encode({ Enabled = 'yes' })))
      assert.is_true(has(outData(base), 'Enabled must be a boolean'))
    end)
    it('Set-Share is blocked when shares are disabled', function()
      local base = newBase()
      assert.is_true(has(outData(setShare(base, ALICE, 0.5, 1000)), 'Shares feature is disabled'))
    end)
  end)

  -- =========================================================================
  -- set-shares-enabled.spec.ts (10)
  -- =========================================================================
  describe('SetSharesEnabled', function()
    it('Requires SetSharesEnabled to be a boolean', function()
      local base = newBase()
      assert.is_true(has(outData(updateShares(base, { SetSharesEnabled = 'yes' })), 'SetSharesEnabled must be a boolean'))
      assert.is_true(has(outData(updateShares(base, { SetSharesEnabled = 1 })), 'SetSharesEnabled must be a boolean'))
    end)
    it('Can disable and re-enable set shares', function()
      local base = newBase()
      updateShares(base, { SetSharesEnabled = false })
      assert.is_false(StakingRewards.Configuration.Shares.SetSharesEnabled)
      updateShares(base, { SetSharesEnabled = true })
      assert.is_true(StakingRewards.Configuration.Shares.SetSharesEnabled)
    end)
    it('SetSharesEnabled is independent from Shares.Enabled', function()
      local base = newBase()
      toggleShares(base, true)
      updateShares(base, { SetSharesEnabled = false })
      assert.is_true(StakingRewards.Configuration.Shares.Enabled)
      assert.is_false(StakingRewards.Configuration.Shares.SetSharesEnabled)
    end)
    it('Can update SetSharesEnabled together with other share config options', function()
      local base = newBase()
      assert.are.equal('OK', outData(updateShares(base, { SetSharesEnabled = false, Default = 0.2, Min = 0.1, Max = 0.5 })))
      local sh = StakingRewards.Configuration.Shares
      assert.is_false(sh.SetSharesEnabled)
      assert.are.equal(0.2, sh.Default); assert.are.equal(0.1, sh.Min); assert.are.equal(0.5, sh.Max)
    end)
    it('Blocks Set-Share when SetSharesEnabled is false', function()
      local base = newBase()
      toggleShares(base, true)
      updateShares(base, { SetSharesEnabled = false })
      assert.is_true(has(outData(setShare(base, ALICE, 0.1, 1000)), 'Operator share setting is disabled'))
    end)
    it('Allows Set-Share when SetSharesEnabled is re-enabled', function()
      local base = newBase()
      toggleShares(base, true)
      updateShares(base, { SetSharesEnabled = false })
      updateShares(base, { SetSharesEnabled = true, ChangeDelaySeconds = 0 })
      assert.are.equal('OK', outData(setShare(base, ALICE, 0.1, 1000)))
    end)

    describe('share used in scoring', function()
      local REF = { [ALICE] = { [BOB] = stake('1000', 0.6) } }
      local function b(cfg)
        local base = newBase()
        updateConfig(base, { TokensPerSecond = '1000', Requirements = { Running = 0.5 } })
        toggleShares(base, true)
        updateShares(base, cfg)
        return base
      end
      it('Uses default share when SetSharesEnabled is false, ignoring operator shares', function()
        local base = b({ SetSharesEnabled = true, ChangeDelaySeconds = 0, Default = 0.15, Min = 0, Max = 1 })
        setShare(base, BOB, 0.25, 500)
        updateShares(base, { SetSharesEnabled = false })
        round(base, 1000, REF)
        assert.are.equal(0.15, snapshot(base).Details[ALICE][BOB].Score.Share)
      end)
      it('Uses operator share when SetSharesEnabled is true', function()
        local base = b({ SetSharesEnabled = true, ChangeDelaySeconds = 0, Default = 0.15, Min = 0, Max = 1 })
        setShare(base, BOB, 0.25, 500)
        round(base, 1000, REF)
        assert.are.equal(0.25, snapshot(base).Details[ALICE][BOB].Score.Share)
      end)
      it('Uses default share for operators without a set share', function()
        local base = b({ SetSharesEnabled = true, ChangeDelaySeconds = 0, Default = 0.2, Min = 0, Max = 1 })
        round(base, 1000, REF)
        assert.are.equal(0.2, snapshot(base).Details[ALICE][BOB].Score.Share)
      end)
      it('Preserves operator shares when SetSharesEnabled is toggled off and back on', function()
        local base = b({ SetSharesEnabled = true, ChangeDelaySeconds = 0, Default = 0.15, Min = 0, Max = 1 })
        setShare(base, BOB, 0.3, 500)
        updateShares(base, { SetSharesEnabled = false })
        updateShares(base, { SetSharesEnabled = true })
        round(base, 1000, REF)
        assert.are.equal(0.3, snapshot(base).Details[ALICE][BOB].Score.Share)
      end)
    end)
  end)

  -- =========================================================================
  -- share-change-delay.spec.ts (13) — legacynet toy-timestamp semantics.
  -- NB: these use tiny integers, so `delay` is compared against them directly. Under the ms fix a
  -- delay of N seconds = N*1000 ms, so the WASM delays are scaled by /1000 here to express the SAME
  -- intent (e.g. legacy delay 1000 "seconds" vs stamps 1000/2000 → 1 second vs stamps 1000/2000 ms).
  -- The realistic-ms block below is what actually pins the unit semantics.
  -- =========================================================================
  describe('Share change delay', function()
    local function b(delaySeconds)
      local base = newBase()
      updateConfig(base, { TokensPerSecond = '1000', Requirements = { Running = 0.5 } })
      toggleShares(base, true)
      updateShares(base, { SetSharesEnabled = true, Min = 0, Max = 1, Default = 0.05,
        ChangeDelaySeconds = delaySeconds })
      return base
    end

    it('Allows configuring ChangeDelaySeconds', function()
      local base = newBase()
      assert.are.equal('OK', outData(updateShares(base, { ChangeDelaySeconds = 3600 })))
      assert.are.equal(3600, StakingRewards.Configuration.Shares.ChangeDelaySeconds)
    end)
    it('Rejects non-integer ChangeDelaySeconds', function()
      assert.is_true(has(outData(updateShares(newBase(), { ChangeDelaySeconds = 3600.5 })), 'ChangeDelaySeconds'))
    end)
    it('Rejects negative ChangeDelaySeconds', function()
      assert.is_true(has(outData(updateShares(newBase(), { ChangeDelaySeconds = -1 })), 'ChangeDelaySeconds has to be >= 0'))
    end)
    it('Allows ChangeDelaySeconds of 0 (immediate)', function()
      local base = newBase()
      assert.are.equal('OK', outData(updateShares(base, { ChangeDelaySeconds = 0 })))
      assert.are.equal(0, StakingRewards.Configuration.Shares.ChangeDelaySeconds)
    end)
    it('Can update ChangeDelaySeconds together with other share config options', function()
      local base = newBase()
      assert.are.equal('OK', outData(updateShares(base, { ChangeDelaySeconds = 7200, Default = 0.1, Min = 0.05, Max = 0.5 })))
      assert.are.equal(7200, StakingRewards.Configuration.Shares.ChangeDelaySeconds)
    end)

    it('Applies share change immediately when ChangeDelaySeconds is 0', function()
      local base = b(0)
      setShare(base, BOB, 0.15, 1000)
      assert.are.equal(0.15, StakingRewards.Shares[BOB])
      assert.is_nil(StakingRewards.PendingShareChanges[BOB])
    end)
    it('Queues share change when ChangeDelaySeconds > 0', function()
      local base = b(3600)
      setShare(base, BOB, 0.2, 1000)
      assert.are.same({ Share = 0.2, RequestedTimestamp = 1000 }, StakingRewards.PendingShareChanges[BOB])
      assert.is_nil(StakingRewards.Shares[BOB])
    end)
    it('Replaces a pending change when Set-Share is called again', function()
      local base = b(3600)
      setShare(base, BOB, 0.1, 1000)
      setShare(base, BOB, 0.25, 2000)
      assert.are.same({ Share = 0.25, RequestedTimestamp = 2000 }, StakingRewards.PendingShareChanges[BOB])
    end)
    it('Pending changes are visible in state', function()
      local base = b(3600)
      setShare(base, BOB, 0.15, 5000)
      assert.are.same({ Share = 0.15, RequestedTimestamp = 5000 }, StakingRewards.PendingShareChanges[BOB])
      assert.are.same({ Share = 0.15, RequestedTimestamp = 5000 }, view(base, 'shares').PendingShareChanges[BOB])
    end)
    it('Applies a pending share change after the delay has passed', function()
      local base = b(1)   -- 1 s = 1000 ms
      setShare(base, BOB, 0.3, 1000)
      round(base, 2000, { [ALICE] = { [BOB] = stake('1000', 0.6) } })
      assert.are.equal(0.3, StakingRewards.Shares[BOB])
      assert.is_nil(StakingRewards.PendingShareChanges[BOB])
    end)
    it('Does NOT apply a pending share change before the delay has passed', function()
      local base = b(2)   -- 2 s = 2000 ms; request@1000 → ready at 3000
      setShare(base, BOB, 0.3, 1000)
      round(base, 2000, { [ALICE] = { [BOB] = stake('1000', 0.6) } })
      assert.is_nil(StakingRewards.Shares[BOB])
      assert.are.same({ Share = 0.3, RequestedTimestamp = 1000 }, StakingRewards.PendingShareChanges[BOB])
    end)
    it('Applies multiple pending changes when the delay has passed for each', function()
      local base = b(1)   -- 1 s = 1000 ms; both requests are ready by round 3000
      setShare(base, BOB, 0.1, 1000)
      setShare(base, CHARLS, 0.2, 1200)
      round(base, 3000, { [ALICE] = { [BOB] = stake('1000', 0.6), [CHARLS] = stake('2000', 0.7) } })
      assert.are.equal(0.1, StakingRewards.Shares[BOB])
      assert.are.equal(0.2, StakingRewards.Shares[CHARLS])
    end)
    it('Partial application — only applies changes whose delay has passed', function()
      local base = b(1)   -- 1 s = 1000 ms
      setShare(base, BOB, 0.1, 500)      -- ready at 1500
      setShare(base, CHARLS, 0.2, 1500)  -- ready at 2500
      round(base, 2000, { [ALICE] = { [BOB] = stake('1000', 0.6), [CHARLS] = stake('2000', 0.7) } })
      assert.are.equal(0.1, StakingRewards.Shares[BOB])
      assert.is_nil(StakingRewards.Shares[CHARLS])
      assert.is_nil(StakingRewards.PendingShareChanges[BOB])
      assert.are.same({ Share = 0.2, RequestedTimestamp = 1500 }, StakingRewards.PendingShareChanges[CHARLS])
    end)
  end)

  -- =========================================================================
  -- NEW — realistic millisecond timestamps. The legacynet harness only used toy integers, which
  -- pass under BOTH the buggy (ms + seconds) and fixed (ms + seconds*1000) arithmetic — which is
  -- precisely why the unit bug survived. These use real epoch-ms stamps and hourly rounds, so they
  -- FAIL on the legacy arithmetic and pin the fix. See the contract header / D8.
  -- =========================================================================
  describe('share-change delay — real millisecond timestamps', function()
    local T0   = 1783064040855              -- a real observed round timestamp (ms)
    local HOUR = 3600 * 1000
    local SEVEN_DAYS_S = 604800             -- the production default, in seconds

    local function b(delaySeconds)
      local base = newBase()
      updateConfig(base, { TokensPerSecond = '1000', Requirements = { Running = 0.5 } })
      toggleShares(base, true)
      updateShares(base, { SetSharesEnabled = true, Min = 0, Max = 1, Default = 0.05,
        ChangeDelaySeconds = delaySeconds })
      round(base, T0, { [ALICE] = { [BOB] = stake('1000', 0.6) } })   -- establish PreviousRound
      return base
    end
    local function nextRound(base, ts)
      round(base, ts, { [ALICE] = { [BOB] = stake('1000', 0.6) } })
    end

    it('a 7-day delay does NOT elapse at the next hourly round (the legacy bug)', function()
      local base = b(SEVEN_DAYS_S)
      setShare(base, BOB, 0.42, T0 + 1000)
      nextRound(base, T0 + HOUR)
      -- under the legacy arithmetic (ms + 604800) this would have applied immediately
      assert.is_nil(StakingRewards.Shares[BOB])
      assert.are.same({ Share = 0.42, RequestedTimestamp = T0 + 1000 }, StakingRewards.PendingShareChanges[BOB])
    end)

    it('a 7-day delay does NOT elapse after 6 days', function()
      local base = b(SEVEN_DAYS_S)
      setShare(base, BOB, 0.42, T0 + 1000)
      nextRound(base, T0 + 6 * 24 * HOUR)
      assert.is_nil(StakingRewards.Shares[BOB])
    end)

    it('a 7-day delay DOES elapse after 7 days', function()
      local base = b(SEVEN_DAYS_S)
      setShare(base, BOB, 0.42, T0 + 1000)
      nextRound(base, T0 + 1000 + SEVEN_DAYS_S * 1000)
      assert.are.equal(0.42, StakingRewards.Shares[BOB])
      assert.is_nil(StakingRewards.PendingShareChanges[BOB])
    end)

    it('an hour-long delay elapses on the hour, not 3.6 seconds later', function()
      local base = b(3600)
      setShare(base, BOB, 0.2, T0 + 1000)
      nextRound(base, T0 + 1000 + 3600 * 1000 - 1)   -- one ms short
      assert.is_nil(StakingRewards.Shares[BOB])
      nextRound(base, T0 + 1000 + 3600 * 1000)       -- exactly on the delay
      assert.are.equal(0.2, StakingRewards.Shares[BOB])
    end)
  end)

  -- =========================================================================
  -- view-init-state.spec.ts (1) → migrate-on-spawn: a seeded base exposes imported state.
  -- =========================================================================
  describe('Seeded state (migrate-on-spawn ≙ Init import/reimport)', function()
    -- Migrate-on-spawn: the state root is planted directly, exactly as native.compute's seed
    -- path does. Through the setters — busted's per-file _ENV proxies _G, so `StakingRewards = …`
    -- here would be invisible to the runtime.
    local function seededBase(state)
      native.reset()
      native.setStateRoot(state)
      native.setACL({ roles = {} })
      return { process = { id = 'PID', commitments = commit(OWNER) } }
    end
    local function seed()
      return {
        Claimed = {},
        Rewarded = { [CHARLS] = { [ALICE] = '25000000000000', [CHARLS] = '75000000000000' } },
        Shares = {},
        PendingShareChanges = {},
        Configuration = {
          TokensPerSecond = '1000000000000',
          Requirements = { Running = 0.6 },
          Shares = { Enabled = false, SetSharesEnabled = false, Min = 0.0, Max = 1.0,
                     Default = 0.05, ChangeDelaySeconds = 604800 },
        },
        PreviousRound = { Timestamp = 1741829269954, Period = 100,
          Summary = { Rewards = '0', Ratings = '0', Stakes = '0' }, Configuration = {}, Details = {} },
        PendingRounds = {},
      }
    end

    it('exposes imported reward + round state through views', function()
      local base = seededBase(seed())
      assert.are.equal('25000000000000', view(base, 'rewards', { address = CHARLS }).Rewarded[ALICE])
      assert.are.equal('75000000000000', view(base, 'rewards', { address = CHARLS }).Rewarded[CHARLS])
      assert.are.equal(1741829269954, view(base, 'last_round').Timestamp)
      assert.are.equal(100, view(base, 'last_round').Period)
      assert.are.equal('1000000000000', view(base, 'dump').Configuration.TokensPerSecond)
      assert.are.equal('1000000000000', view(base, 'status').tokensPerSecond)
      assert.are.equal(0.6, view(base, 'status').runningRequirement)
    end)

    it('a dump round-trips into a fresh base (reimport-equivalent)', function()
      local base = seededBase(seed())
      local d = view(base, 'dump')
      local base2 = seededBase({
        Claimed = d.Claimed, Rewarded = d.Rewarded, Shares = d.Shares,
        PendingShareChanges = d.PendingShareChanges, Configuration = d.Configuration,
        PreviousRound = d.PreviousRound, PendingRounds = {} })
      assert.are.equal('75000000000000', view(base2, 'rewards', { address = CHARLS }).Rewarded[CHARLS])
      assert.are.equal(1741829269954, view(base2, 'last_round').Timestamp)
      assert.are.equal(100, view(base2, 'last_round').Period)
      assert.are.equal('1000000000000', view(base2, 'dump').Configuration.TokensPerSecond)
    end)

    it('continues a round on top of seeded (migrated) balances', function()
      local base = seededBase(seed())
      -- CHARLS already holds 75e12 from ALICE-operated stake; a further round must restake it
      round(base, 1741829269954 + 3600000, { [CHARLS] = { [CHARLS] = stake('1000', 0.8) } })
      local d = snapshot(base).Details[CHARLS][CHARLS]
      assert.are.equal('75000000000000', d.Score.Restaked)   -- prior reward, unclaimed
      assert.are.equal('75000000001000', d.Rating)           -- staked + restaked
    end)
  end)

  -- =========================================================================
  -- Runtime safety (D8 axes) — never exercised by the WASM harness
  -- =========================================================================
  describe('Runtime safety (D8 axes)', function()
    it('Rejects an unsigned message (no committer)', function()
      local base = newBase()
      compute(base, assign('Add-Scores', nil, json.encode({ Scores = { [ALICE] = { [BOB] = stake('1', 0.5) } } }), { ['Round-Timestamp'] = '1000' }))
      assert.is_true(has(outData(base), 'unsigned or unresolved committer'))
      assert.is_nil(StakingRewards.PendingRounds['1000'])
    end)
    it('Rejects an unknown action', function()
      local base = newBase()
      compute(base, assign('Frobnicate', OWNER, nil))
      assert.is_true(has(outData(base), 'unknown action'))
    end)
    it('Reverts state atomically when a handler errors', function()
      local base = newBase()
      updateConfig(base, { TokensPerSecond = '1000', Requirements = { Running = 0.5 } })
      round(base, 1000, { [ALICE] = { [BOB] = stake('1000', 0.6) } })
      round(base, 2000, { [ALICE] = { [BOB] = stake('1000', 0.6) } })
      -- deep-copy + structural compare: `pairs` order is not stable, so comparing json.encode
      -- strings is flaky once the map has more than one key (revert also REPLACES the table).
      local before = native.deepcopy(StakingRewards.Rewarded)
      completeRound(base, 999999)
      assert.is_true(has(outData(base), 'No pending round for'))
      assert.are.same(before, StakingRewards.Rewarded)
    end)
    it('A17: PendingRounds is keyed by the string timestamp, never the integer', function()
      local base = newBase()
      addScores(base, { [ALICE] = { [BOB] = stake('1000', 0.6) } }, 1783064040855)
      assert.is_not_nil(StakingRewards.PendingRounds['1783064040855'])
      assert.is_nil(StakingRewards.PendingRounds[1783064040855])
    end)
  end)
end)
