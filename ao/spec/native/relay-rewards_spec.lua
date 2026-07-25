--- Tier-1 busted spec — native relay-rewards (D26 shape) on the native runtime, under Lua 5.3.
---
--- Parity with the legacynet WASM harness (test/spec/contracts/relay-rewards/*.spec.ts),
--- re-expressed native:
---   · state is read from `base.state` (single source of truth) — not patch@1.0 tags
---   · a successful WRITE's reply is the compute output ('OK', or the JSON snapshot for
---     Complete-Round / the claimed value for Claim-Rewards) — not a `*-Response` message
---   · reads are `native.view(base, <name>, <params>)` — not messages
---   · an assert failure surfaces as `output.data = 'error: <msg>'` and reverts state atomically
---
--- SCOPE: this spec is the per-behavior net — ACL gating, per-field validation + atomicity,
--- round lifecycle, delegate/claim behaviour, the native invariants (Details off-persist), the
--- views, and the D8 runtime-safety axes. The heavy reward-MATH is proven byte-identical elsewhere
--- (Tier-2 bint golden `spec/luerl/scenarios/native-relay-rewards.lua`, Tier-3 real-seed round, and
--- the legacy⇄native cross-check `scripts/tier2-relay-legacy-crosscheck.ts`), so the giant
--- staging/init-state data scenarios are NOT re-ported here; instead one test re-anchors the exact
--- bint golden values in real Lua 5.3, and the accumulation/delegate paths are asserted structurally.
---
--- OWNER=0x11..1; ALICE/BOB/CHARLS are real mixed-case EIP-55 addresses stored VERBATIM.
--- FINGERPRINT_A..F = 'A'..'F' × 40.

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
  package.loaded['.common.bigint']  = loadmod(C .. '/bigint.lua')   -- relay math dep
  local native = loadmod(RT .. '/native.lua')
  native.install()
  native.register(loadmod(CT .. '/native/relay-rewards.lua'))
  return native
end

describe('native relay-rewards — WASM-harness parity (Lua 5.3)', function()
  local native
  local json = nil

  local OWNER  = '0x' .. string.rep('1', 40)
  local ALICE  = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
  local BOB    = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC'
  local CHARLS = '0x90F79bf6EB2c4f870365E785982E1f101E93b906'
  local FP_A, FP_B, FP_C = string.rep('A', 40), string.rep('B', 40), string.rep('C', 40)
  local FP_D = string.rep('D', 40)

  local function commit(committer)
    return { c1 = { ['commitment-device'] = 'ans104@1.0', committer = committer } }
  end
  --- assign(action, committer, data, tags?) → device request `{ body = ... }`.
  local function assign(action, committer, data, tags)
    local taglist = { { name = 'Action', value = action } }
    if tags then for k, v in pairs(tags) do taglist[#taglist + 1] = { name = k, value = v } end end
    return { body = {
      action = action, tags = taglist, data = data,
      commitments = committer and commit(committer) or nil,
    } }
  end
  local function newBase() return { process = { id = 'PID', commitments = commit(OWNER) } } end
  local function outData(base) return base.results and base.results.output and base.results.output.data or '' end
  local function has(s, sub) return type(s) == 'string' and s:find(sub, 1, true) ~= nil end
  local function view(base, name, params) return native.view(base, name, params) end

  -- action helpers
  local function score(addr, o)
    o = o or {}
    return { Address = addr, Network = o.Network or 1000, IsHardware = o.IsHardware or false,
      UptimeStreak = o.UptimeStreak or 0, ExitBonus = o.ExitBonus or false,
      FamilySize = o.FamilySize or 0, LocationSize = o.LocationSize or 0 }
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
  local function setDelegate(base, from, delegateAddr, share)
    local tags = {}
    if delegateAddr then tags['Address'] = delegateAddr end
    if share ~= nil then tags['Share'] = tostring(share) end
    return compute(base, assign('Set-Delegate', from, nil, tags))
  end
  local function claimRewards(base, addr, from)
    return compute(base, assign('Claim-Rewards', from or OWNER, nil, { ['Address'] = addr }))
  end
  local function updateConfig(base, cfg, from)
    return compute(base, assign('Update-Configuration', from or OWNER, json.encode(cfg)))
  end
  local function grantRole(base, addr, roles)
    return compute(base, assign('Update-Roles', OWNER, json.encode({ Grant = { [addr] = roles } })))
  end

  before_each(function() native = freshEnv(); json = require('json') end)

  -- =========================================================================
  describe('ACL enforcement', function()
    local function stageOne(base) return addScores(base, { [FP_A] = score(ALICE) }, 1000) end

    it('Update-Configuration: allows admin role, denies a roleless address', function()
      local base = newBase()
      grantRole(base, ALICE, { 'admin' })
      assert.are.equal('OK', outData(updateConfig(base, { TokensPerSecond = '123' }, ALICE)))
      assert.are.equal('123', base.state.Configuration.TokensPerSecond)
      compute(base, assign('Update-Configuration', BOB, json.encode({ TokensPerSecond = '9' })))
      assert.is_true(has(outData(base), 'Permission Denied'))
    end)

    it('Update-Configuration: allows the named Update-Configuration role', function()
      local base = newBase()
      grantRole(base, ALICE, { 'Update-Configuration' })
      assert.are.equal('OK', outData(updateConfig(base, { TokensPerSecond = '7' }, ALICE)))
    end)

    it('Add-Scores: allows admin + named role, denies roleless', function()
      local base = newBase()
      grantRole(base, ALICE, { 'admin' })
      grantRole(base, BOB, { 'Add-Scores' })
      assert.are.equal('OK', outData(addScores(base, { [FP_A] = score(ALICE) }, 1000, ALICE)))
      assert.are.equal('OK', outData(addScores(base, { [FP_B] = score(BOB) }, 1000, BOB)))
      addScores(base, { [FP_C] = score(CHARLS) }, 1000, CHARLS)
      assert.is_true(has(outData(base), 'Permission Denied'))
    end)

    it('Complete-Round: allows admin, denies roleless', function()
      local base = newBase()
      grantRole(base, ALICE, { 'admin' })
      stageOne(base)
      assert.is_true(has(outData(completeRound(base, 1000, CHARLS)), 'Permission Denied'))
      -- state untouched by the denied call: round still pending, completes for admin
      local snap = json.decode(outData(completeRound(base, 1000, ALICE)))
      assert.are.equal(1000, snap.Timestamp)
    end)

    it('Cancel-Round: allows the named Cancel-Round role, denies roleless', function()
      local base = newBase()
      grantRole(base, ALICE, { 'Cancel-Round' })
      stageOne(base)
      assert.is_true(has(outData(cancelRound(base, 1000, BOB)), 'Permission Denied'))
      assert.are.equal('OK', outData(cancelRound(base, 1000, ALICE)))
    end)
  end)

  -- =========================================================================
  describe('Update-Configuration validation', function()
    it('Requires message data', function()
      local base = newBase()
      compute(base, assign('Update-Configuration', OWNER, nil))
      assert.is_true(has(outData(base), 'Message data is required'))
    end)

    it('TokensPerSecond must be a positive integer string', function()
      local base = newBase()
      assert.is_true(has(outData(updateConfig(base, { TokensPerSecond = 1000 })), 'must be a string number'))
      assert.is_true(has(outData(updateConfig(base, { TokensPerSecond = 'abc' })), 'must be an integer'))
      assert.is_true(has(outData(updateConfig(base, { TokensPerSecond = '-5' })), 'must be a positive value'))
      assert.are.equal('OK', outData(updateConfig(base, { TokensPerSecond = '42' })))
      assert.are.equal('42', base.state.Configuration.TokensPerSecond)
    end)

    it('Modifier shares must be numbers in [0,1]', function()
      local base = newBase()
      assert.is_true(has(outData(updateConfig(base, { Modifiers = { Network = { Share = 2 } } })), 'has to be <= 1'))
      assert.is_true(has(outData(updateConfig(base, { Modifiers = { Network = { Share = -1 } } })), 'has to be >= 0'))
    end)

    it('Hardware/Uptime/ExitBonus Enabled must be boolean', function()
      local base = newBase()
      assert.is_true(has(outData(updateConfig(base, { Modifiers = { Hardware = { Enabled = 'yes', Share = 0.2 } } })), 'Boolean value required'))
      assert.is_true(has(outData(updateConfig(base, { Modifiers = { Uptime = { Enabled = 1, Share = 0.14 } } })), 'Boolean value required'))
      assert.is_true(has(outData(updateConfig(base, { Modifiers = { ExitBonus = { Enabled = 0, Share = 0.1 } } })), 'Boolean value required'))
    end)

    it('Uptime Tiers must be a table; keys parse to ints, weights to numbers; max 42', function()
      local base = newBase()
      assert.is_true(has(outData(updateConfig(base, { Modifiers = { Uptime = { Enabled = true, Share = 0.14, Tiers = 5 } } })), 'Table type required'))
      local big = {}
      for i = 0, 42 do big[tostring(i)] = 1 end   -- 43 tiers
      assert.is_true(has(outData(updateConfig(base, { Modifiers = { Uptime = { Enabled = true, Share = 0.14, Tiers = big } } })), 'Too many'))
    end)

    it('Enforces sum of enabled-modifier shares == 1', function()
      local base = newBase()
      -- default: Network .56 + Hardware .2 + Uptime .14 + ExitBonus .1 == 1. Nudge Network only → .94.
      assert.is_true(has(outData(updateConfig(base, { Modifiers = { Network = { Share = 0.5 } } })), 'Sum of shares'))
      -- a balanced set is accepted
      assert.are.equal('OK', outData(updateConfig(base, { Modifiers = {
        Network = { Share = 0.5 }, Hardware = { Enabled = true, Share = 0.26, UptimeInfluence = 0.35 },
        Uptime = { Enabled = true, Share = 0.14 }, ExitBonus = { Enabled = true, Share = 0.1 } } })))
      assert.are.equal(0.5, base.state.Configuration.Modifiers.Network.Share)
    end)

    it('Multipliers: Family/Location Enabled boolean, Offset in [0,1], Power >= 0, Divider >= 1', function()
      local base = newBase()
      assert.is_true(has(outData(updateConfig(base, { Multipliers = { Family = { Enabled = 'x', Offset = 0.01, Power = 1 } } })), 'Boolean value required'))
      assert.is_true(has(outData(updateConfig(base, { Multipliers = { Family = { Enabled = true, Offset = 2, Power = 1 } } })), 'has to be <= 1'))
      assert.is_true(has(outData(updateConfig(base, { Multipliers = { Location = { Enabled = true, Offset = 0.001, Power = 2, Divider = 0 } } })), 'has to be >= 1'))
      assert.are.equal('OK', outData(updateConfig(base, { Multipliers = { Family = { Enabled = true, Offset = 0.02, Power = 1.0 } } })))
      assert.are.equal(0.02, base.state.Configuration.Multipliers.Family.Offset)
    end)

    it('Delegates: table of valid operator→{valid address, share in [0,1]}', function()
      local base = newBase()
      assert.is_true(has(outData(updateConfig(base, { Delegates = { [ALICE] = { Address = BOB, Share = 2 } } })), 'has to be <= 1'))
      assert.is_true(has(outData(updateConfig(base, { Delegates = { [ALICE] = { Address = 'nope', Share = 0.5 } } })), 'Invalid Address'))
      assert.are.equal('OK', outData(updateConfig(base, { Delegates = { [ALICE] = { Address = BOB, Share = 0.25 } } })))
      assert.are.equal(0.25, base.state.Configuration.Delegates[ALICE].Share)
    end)
  end)

  -- =========================================================================
  describe('Add-Scores validation', function()
    it('Requires JSON message data', function()
      local base = newBase()
      compute(base, assign('Add-Scores', OWNER, nil, { ['Round-Timestamp'] = '1000' }))
      assert.is_true(has(outData(base), 'Message data is required'))
    end)

    it('Round-Timestamp must be numeric, > 0, and not backdated', function()
      local base = newBase()
      addScores(base, { [FP_A] = score(ALICE) }, 'abc')
      assert.is_true(has(outData(base), 'Round-Timestamp tag must be a number'))
      compute(base, assign('Add-Scores', OWNER, json.encode({ Scores = { [FP_A] = score(ALICE) } }), { ['Round-Timestamp'] = '0' }))
      assert.is_true(has(outData(base), 'has to be > 0'))
      -- settle round 1000, then a backdated 500 is rejected
      addScores(base, { [FP_A] = score(ALICE) }, 1000); completeRound(base, 1000)
      addScores(base, { [FP_B] = score(BOB) }, 500)
      assert.is_true(has(outData(base), 'backdated'))
    end)

    it('Scores must be a table', function()
      local base = newBase()
      compute(base, assign('Add-Scores', OWNER, json.encode({ Scores = 'nope' }), { ['Round-Timestamp'] = '1000' }))
      assert.is_true(has(outData(base), 'Scores have to be a table'))
    end)

    it('Each score is validated: fingerprint, address, numeric/boolean fields', function()
      local base = newBase()
      addScores(base, { ['bad-fp'] = score(ALICE) }, 1000)
      assert.is_true(has(outData(base), 'Invalid Fingerprint'))
      addScores(base, { [FP_A] = score('not-an-address') }, 1000)
      assert.is_true(has(outData(base), 'Invalid Address'))
      addScores(base, { [FP_A] = { Address = ALICE, Network = -1, IsHardware = false, UptimeStreak = 0, ExitBonus = false, FamilySize = 0, LocationSize = 0 } }, 1000)
      assert.is_true(has(outData(base), 'Network has to be >= 0'))
      addScores(base, { [FP_A] = { Address = ALICE, Network = 1, IsHardware = 'x', UptimeStreak = 0, ExitBonus = false, FamilySize = 0, LocationSize = 0 } }, 1000)
      assert.is_true(has(outData(base), 'IsHardware'))
      addScores(base, { [FP_A] = { Address = ALICE, Network = 1, IsHardware = false, UptimeStreak = 0, ExitBonus = 1, FamilySize = 0, LocationSize = 0 } }, 1000)
      assert.is_true(has(outData(base), 'ExitBonus'))
      -- nothing was staged by any failed batch
      assert.is_nil(base.state.PendingRounds['1000'])
    end)

    it('Rejects a duplicate fingerprint within the same round', function()
      local base = newBase()
      assert.are.equal('OK', outData(addScores(base, { [FP_A] = score(ALICE) }, 1000)))
      addScores(base, { [FP_A] = score(BOB) }, 1000)
      assert.is_true(has(outData(base), 'Duplicated score for'))
    end)

    it('validate-before-mutate: a bad item in a batch stages NOTHING (atomic)', function()
      local base = newBase()
      addScores(base, { [FP_A] = score(ALICE), [FP_B] = score('bad') }, 1000)
      assert.is_true(has(outData(base), 'Invalid Address'))
      assert.is_nil(base.state.PendingRounds['1000'])   -- FP_A not staged either
    end)

    it('Owner Add-Scores stages a pending round keyed by the string timestamp (A17)', function()
      local base = newBase()
      assert.are.equal('OK', outData(addScores(base, { [FP_A] = score(ALICE, { Network = 7 }) }, 1000)))
      assert.are.equal(ALICE, base.state.PendingRounds['1000'][FP_A].Address)
      assert.are.equal(7, base.state.PendingRounds['1000'][FP_A].Score.Network)
      assert.is_nil(base.state.PendingRounds[1000])      -- NOT the integer key
    end)
  end)

  -- =========================================================================
  describe('Set-Delegate (permissionless, keyed by committer)', function()
    it('Sets, validates share/address, and clears the delegate for the caller', function()
      local base = newBase()
      assert.are.equal('OK', outData(setDelegate(base, ALICE, BOB, 0.25)))
      assert.are.same({ Address = BOB, Share = 0.25 }, base.state.Configuration.Delegates[ALICE])
      assert.is_true(has(outData(setDelegate(base, ALICE, BOB, 2)), 'has to be <= 1'))
      assert.is_true(has(outData(setDelegate(base, ALICE, 'bad-addr', 0.1)), 'Invalid Address'))
      -- clear (no Address tag) → RESET
      assert.are.equal('RESET', outData(setDelegate(base, ALICE, nil, nil)))
      assert.is_nil(base.state.Configuration.Delegates[ALICE])
    end)
  end)

  -- =========================================================================
  describe('Cancel-Round', function()
    it('Requires a numeric timestamp with an existing pending round, then removes it', function()
      local base = newBase()
      addScores(base, { [FP_A] = score(ALICE) }, 1000)
      cancelRound(base, 'x')
      assert.is_true(has(outData(base), 'Number value required'))
      cancelRound(base, 2000)
      assert.is_true(has(outData(base), 'No pending round for'))
      assert.are.equal('OK', outData(cancelRound(base, 1000)))
      assert.is_nil(base.state.PendingRounds['1000'])
    end)
  end)

  -- =========================================================================
  describe('Complete-Round', function()
    it('Requires an existing pending round for the timestamp', function()
      local base = newBase()
      completeRound(base, 1000)
      assert.is_true(has(outData(base), 'No pending round for'))
    end)

    it('Removes pending rounds dated at/before the completed timestamp', function()
      local base = newBase()
      addScores(base, { [FP_A] = score(ALICE) }, 1000)
      addScores(base, { [FP_B] = score(BOB) }, 2000)
      addScores(base, { [FP_C] = score(CHARLS) }, 3000)
      completeRound(base, 2000)
      assert.is_nil(base.state.PendingRounds['1000'])   -- older cleared
      assert.is_nil(base.state.PendingRounds['2000'])   -- settled cleared
      assert.is_not_nil(base.state.PendingRounds['3000'])   -- future kept
    end)

    it('Persists the last-round SUMMARY only; Details ride the compute output', function()
      local base = newBase()
      addScores(base, { [FP_A] = score(ALICE, { Network = 1000 }) }, 1000)
      completeRound(base, 1000)   -- bootstrap: Period 0
      addScores(base, { [FP_A] = score(ALICE, { Network = 1000 }) }, 61000)
      local snap = json.decode(outData(completeRound(base, 61000)))
      -- persisted PreviousRound has NO Details (off-persist invariant)
      assert.is_nil(base.state.PreviousRound.Details)
      assert.is_not_nil(base.state.PreviousRound.Summary)
      assert.are.equal(60, base.state.PreviousRound.Period)
      -- the compute OUTPUT carries the full per-fingerprint Details
      assert.is_not_nil(snap.Details[FP_A])
      assert.are.equal(61000, snap.Timestamp)
      assert.are.equal(60, snap.Period)
    end)
  end)

  -- =========================================================================
  describe('Reward math — relationships at a non-overflowing token scale', function()
    -- `.common.bigint` is a NATIVE-INTEGER wrapper: exact only where ints are arbitrary-precision
    -- (luerl / the device). Real Lua 5.3 here is 64-bit, so full-token-scale intermediates OVERFLOW
    -- and reward MAGNITUDES are a Tier-2 concern — reproduced exactly against the bint golden in
    -- spec/luerl/scenarios/native-relay-rewards.lua, and cross-checked vs legacy in
    -- scripts/tier2-relay-legacy-crosscheck.ts. At Tier-1 we shrink TokensPerSecond so intermediates
    -- stay in 64-bit and assert the reward RELATIONSHIPS: ratings, period, accumulation, delegate split.
    local FP, ADDR = string.rep('A', 40), '0x' .. string.rep('a', 40)
    local function goldenScore() return score(ADDR, { Network = 1000, UptimeStreak = 5, FamilySize = 1, LocationSize = 1 }) end
    local function smallScale(base) updateConfig(base, { TokensPerSecond = '1000000' }) end

    it('derives ratings and period from score + config (overflow-safe)', function()
      local base = newBase(); smallScale(base)
      addScores(base, { [FP] = goldenScore() }, 1000000); completeRound(base, 1000000)   -- Period 0
      addScores(base, { [FP] = goldenScore() }, 1060000)
      local snap = json.decode(outData(completeRound(base, 1060000)))                     -- Period 60
      assert.are.equal(60, base.state.PreviousRound.Period)
      -- floor(1000 * family 1.01 * location ~0.9999975) = 1009; uptime tier for streak 5 → weight 1
      assert.are.equal(1009, snap.Details[FP].Rating.Network)
      assert.are.equal(1, snap.Details[FP].Rating.Uptime)
    end)

    it('accumulates rewards by fingerprint AND (EIP-55) address', function()
      local eip55 = require('.common.eip55')
      local base = newBase(); smallScale(base)
      addScores(base, { [FP] = goldenScore() }, 1000000); completeRound(base, 1000000)   -- Period 0 → 0
      addScores(base, { [FP] = goldenScore() }, 1060000)
      local snap = json.decode(outData(completeRound(base, 1060000)))
      local total = snap.Details[FP].Reward.Total
      assert.is_true(total ~= '0')
      -- cumulative maps accrue the round total; address keyed by canonical EIP-55 (not ALLCAPS)
      assert.are.equal(total, base.state.TotalFingerprintReward[FP])
      local key = eip55.checksum(ADDR)
      assert.are.equal(total, base.state.TotalAddressReward[key])
      assert.is_nil(base.state.TotalAddressReward[string.upper(ADDR)])
    end)

    it('splits the reward with a delegate (Total == Operator + Delegate)', function()
      local bint = require('.common.bigint')(256)
      local base = newBase(); smallScale(base)
      setDelegate(base, ALICE, BOB, 0.25)   -- ALICE delegates 25% to BOB
      addScores(base, { [FP_A] = score(ALICE, { Network = 1000 }) }, 1000000); completeRound(base, 1000000)
      addScores(base, { [FP_A] = score(ALICE, { Network = 1000 }) }, 1060000)
      local snap = json.decode(outData(completeRound(base, 1060000)))
      local d = snap.Details[FP_A].Reward
      assert.is_true(d.DelegateTotal ~= '0')
      assert.are.equal(d.Total, tostring(bint(d.OperatorTotal) + bint(d.DelegateTotal)))
      -- cumulative address maps: ALICE gets the operator cut, BOB the delegate cut
      assert.are.equal(d.OperatorTotal, base.state.TotalAddressReward[ALICE])
      assert.are.equal(d.DelegateTotal, base.state.TotalAddressReward[BOB])
    end)
  end)

  -- =========================================================================
  describe('Claim-Rewards', function()
    it('Tracks Claimed as the current rewarded total; errors when nothing is owed', function()
      local base = newBase()
      updateConfig(base, { TokensPerSecond = '1000000' })   -- small scale (Tier-1 64-bit safe)
      claimRewards(base, ALICE)
      assert.is_true(has(outData(base), 'No rewards for'))
      -- earn something for ALICE
      addScores(base, { [FP_A] = score(ALICE, { Network = 1000 }) }, 1000000); completeRound(base, 1000000)
      addScores(base, { [FP_A] = score(ALICE, { Network = 1000 }) }, 1060000); completeRound(base, 1060000)
      local owed = base.state.TotalAddressReward[ALICE]
      assert.is_not_nil(owed)
      claimRewards(base, ALICE)
      assert.are.equal(owed, base.state.Claimed[ALICE])
    end)
  end)

  -- =========================================================================
  describe('Views', function()
    local function earnedBase()
      local base = newBase()
      updateConfig(base, { TokensPerSecond = '1000000' })   -- small scale (Tier-1 64-bit safe)
      setDelegate(base, ALICE, BOB, 0.25)
      addScores(base, { [FP_A] = score(ALICE, { Network = 1000 }) }, 1000000); completeRound(base, 1000000)
      addScores(base, { [FP_A] = score(ALICE, { Network = 1000 }) }, 1060000); completeRound(base, 1060000)
      return base
    end

    it('rewards: by fingerprint and by address', function()
      local base = earnedBase()
      assert.are.equal(base.state.TotalFingerprintReward[FP_A], view(base, 'rewards', { fingerprint = FP_A }).reward)
      local r = view(base, 'rewards', { address = ALICE })
      assert.are.equal(ALICE, r.address)
      assert.are.equal(base.state.TotalAddressReward[ALICE], r.reward)
    end)

    it('claimed: reflects a claim', function()
      local base = earnedBase()
      claimRewards(base, ALICE)
      assert.are.equal(base.state.Claimed[ALICE], view(base, 'claimed', { address = ALICE }).claimed)
    end)

    it('delegate: set value, and default for an operator with none', function()
      local base = earnedBase()
      assert.are.same({ Address = BOB, Share = 0.25 }, view(base, 'delegate', { address = ALICE }))
      assert.are.same({ Address = '', Share = 0 }, view(base, 'delegate', { address = CHARLS }))
    end)

    it('last_round: summary + metadata, no Details', function()
      local base = earnedBase()
      local lr = view(base, 'last_round')
      assert.are.equal(1060000, lr.Timestamp)
      assert.are.equal(60, lr.Period)
      assert.is_not_nil(lr.Summary)
      assert.is_nil(lr.Details)
    end)

    it('status: counts + tokensPerSecond + runtime identity', function()
      local base = earnedBase()
      local s = view(base, 'status')
      assert.are.equal(1060000, s.lastRoundTimestamp)
      assert.are.equal(1, s.counts.fingerprints)
      assert.are.equal(2, s.counts.addresses)   -- ALICE (operator) + BOB (delegate)
      assert.are.equal(1, s.counts.delegates)
      assert.are.equal('relay-rewards', s.name)
    end)

    it('dump: full state snapshot', function()
      local base = earnedBase()
      local d = view(base, 'dump')
      assert.are.equal(base.state.TotalFingerprintReward[FP_A], d.TotalFingerprintReward[FP_A])
      assert.is_not_nil(d.Configuration)
    end)
  end)

  -- =========================================================================
  describe('Runtime safety (D8 axes)', function()
    it('Rejects an unsigned message (no committer)', function()
      local base = newBase()
      compute(base, assign('Add-Scores', nil, json.encode({ Scores = { [FP_A] = score(ALICE) } }), { ['Round-Timestamp'] = '1000' }))
      assert.is_true(has(outData(base), 'unsigned or unresolved committer'))
      assert.is_nil(base.state.PendingRounds['1000'])
    end)

    it('Rejects an unknown action', function()
      local base = newBase()
      compute(base, assign('Frobnicate', OWNER, nil))
      assert.is_true(has(outData(base), 'unknown action'))
    end)

    it('Reverts state atomically when a handler errors mid-batch', function()
      local base = newBase()
      addScores(base, { [FP_A] = score(ALICE) }, 1000); completeRound(base, 1000)
      local tfrBefore = json.encode(base.state.TotalFingerprintReward)
      -- a Complete-Round for a non-existent round must not perturb the cumulative maps
      completeRound(base, 999999)
      assert.is_true(has(outData(base), 'No pending round for'))
      assert.are.equal(tfrBefore, json.encode(base.state.TotalFingerprintReward))
    end)
  end)
end)
