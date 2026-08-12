--- Tier-1 busted spec — native relay-rewards (D26 shape) on the native runtime, under Lua 5.3.
---
--- FULL PARITY with the legacynet WASM harness (test/spec/contracts/relay-rewards/*.spec.ts),
--- re-expressed native:
---   · state read from `RelayRewards` (single source of truth) — not patch@1.0 tags
---   · a WRITE's reply is the compute output ('OK'; Complete-Round returns the JSON snapshot;
---     Claim-Rewards returns the claimed value) — not a `*-Response` message
---   · reads (Get-Rewards / Get-Claimed / Get-Delegate / Last-Round-*) are `native.view(...)` or
---     direct RelayRewards — not messages. Last-Round-Data (per-fingerprint Details) rides the
---     Complete-Round OUTPUT (Details are never persisted — see the contract header / D27).
---   · an assert failure surfaces as `output.data = 'error: <msg>'` and reverts state atomically.
---
--- Reward MAGNITUDE cases are recreated with the harness's SMALL TokensPerSecond (100/123/1000) so the
--- exact expected integers (110, 70, 700, 2240, 558, …) stay within 64-bit — `common/bigint` is a
--- native-int wrapper (exact only where ints are arbitrary-precision, i.e. luerl/device). FULL
--- token-scale magnitudes are the Tier-2 concern (spec/luerl golden + tier2-relay-legacy-crosscheck).
---
--- The Init import/reimport cases (WASM view-init-state) map to migrate-on-spawn: a native process is
--- SEEDED by a module carrying `RelayRewards` (no Init action), so those are recreated as seeded-base
--- view round-trips. Plus D8 runtime-safety axes the WASM harness never exercised.
---
--- OWNER=0x11..1; ALICE/BOB/CHARLS are real mixed-case EIP-55 addresses stored VERBATIM.
--- FINGERPRINT_A..C = 'A'..'C' × 40.

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
  native.reset()               -- state lives in globals; clear it per test
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

  local function commit(committer)
    return { c1 = { ['commitment-device'] = 'ans104@1.0', committer = committer } }
  end
  local function assign(action, committer, data, tags)
    local taglist = { { name = 'Action', value = action } }
    if tags then for k, v in pairs(tags) do taglist[#taglist + 1] = { name = k, value = v } end end
    return { body = {
      action = action, tags = taglist, data = data,
      commitments = committer and commit(committer) or nil,
    } }
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
  -- add + complete one round; return the decoded Complete-Round snapshot (Timestamp/Period/Summary/Details)
  local function completeR(base, ts, scores, from)
    addScores(base, scores, ts, from)
    return json.decode(outData(completeRound(base, ts, from)))
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
  -- full modifier/multiplier config (Network .56 / Uptime .14 / Hardware .2 / ExitBonus .1) at a small
  -- token scale — the shared fixture behind score-rewards / claim-rewards.
  local function fullConfig(extra)
    local c = {
      TokensPerSecond = '1000',
      Modifiers = {
        Network  = { Share = 0.56 },
        Uptime   = { Enabled = true, Share = 0.14, Tiers = { ['0'] = 0, ['3'] = 1, ['14'] = 3 } },
        Hardware = { Enabled = true, Share = 0.2 },
        ExitBonus = { Enabled = true, Share = 0.1 },
      },
      Multipliers = {
        Family   = { Enabled = true, Offset = 0.01, Power = 1 },
        Location = { Enabled = true, Offset = 0.003, Power = 2, Divider = 1 },
      },
      Delegates = {},
    }
    if extra then for k, v in pairs(extra) do c[k] = v end end
    return c
  end

  before_each(function() native = freshEnv(); json = require('json') end)

  -- =========================================================================
  -- acl.spec.ts — role gating for the four gated writes (admin + named role)
  -- =========================================================================
  describe('ACL enforcement', function()
    it('Update-Configuration: allows Admin role', function()
      local base = newBase(); grantRole(base, ALICE, { 'admin' })
      assert.are.equal('OK', outData(updateConfig(base, { TokensPerSecond = '123' }, ALICE)))
    end)
    it('Update-Configuration: allows the named Update-Configuration role', function()
      local base = newBase(); grantRole(base, BOB, { 'Update-Configuration' })
      assert.are.equal('OK', outData(updateConfig(base, { TokensPerSecond = '123' }, BOB)))
    end)
    it('Add-Scores: allows Admin role', function()
      local base = newBase(); grantRole(base, ALICE, { 'admin' })
      assert.are.equal('OK', outData(addScores(base, { [FP_A] = score(ALICE) }, 1000, ALICE)))
    end)
    it('Add-Scores: allows the named Add-Scores role', function()
      local base = newBase(); grantRole(base, BOB, { 'Add-Scores' })
      assert.are.equal('OK', outData(addScores(base, { [FP_A] = score(ALICE) }, 1000, BOB)))
    end)
    it('Complete-Round: allows Admin role', function()
      local base = newBase(); grantRole(base, ALICE, { 'admin' })
      addScores(base, { [FP_A] = score(ALICE) }, 2000)
      assert.are.equal(2000, json.decode(outData(completeRound(base, 2000, ALICE))).Timestamp)
    end)
    it('Complete-Round: allows the named Complete-Round role', function()
      local base = newBase(); grantRole(base, BOB, { 'Complete-Round' })
      addScores(base, { [FP_A] = score(ALICE) }, 2000)
      assert.are.equal(2000, json.decode(outData(completeRound(base, 2000, BOB))).Timestamp)
    end)
    it('Cancel-Round: allows Admin role', function()
      local base = newBase(); grantRole(base, ALICE, { 'admin' })
      addScores(base, { [FP_A] = score(ALICE) }, 2000)
      assert.are.equal('OK', outData(cancelRound(base, 2000, ALICE)))
    end)
    it('Cancel-Round: allows the named Cancel-Round role', function()
      local base = newBase(); grantRole(base, BOB, { 'Cancel-Round' })
      addScores(base, { [FP_A] = score(ALICE) }, 2000)
      assert.are.equal('OK', outData(cancelRound(base, 2000, BOB)))
    end)
  end)

  -- =========================================================================
  -- configuration.spec.ts
  -- =========================================================================
  describe('Update-Configuration', function()
    it('Blocks non-owners from doing updates', function()
      local base = newBase()
      compute(base, assign('Update-Configuration', ALICE, json.encode({ TokensPerSecond = '1' })))
      assert.is_true(has(outData(base), 'Permission Denied'))
    end)
    it('Requires message data (JSON)', function()
      local base = newBase()
      compute(base, assign('Update-Configuration', OWNER, nil))
      assert.is_true(has(outData(base), 'Message data is required'))
    end)
    it('Ensures TokensPerSecond is an integer string and >= 0', function()
      local base = newBase()
      assert.is_true(has(outData(updateConfig(base, { TokensPerSecond = 100 })), 'must be a string number'))
      assert.is_true(has(outData(updateConfig(base, { TokensPerSecond = 'abc' })), 'must be an integer'))
      assert.is_true(has(outData(updateConfig(base, { TokensPerSecond = '-100' })), 'must be a positive value'))
      assert.are.equal('OK', outData(updateConfig(base, { TokensPerSecond = '42' })))
      assert.are.equal('42', RelayRewards.Configuration.TokensPerSecond)
    end)
  end)

  -- =========================================================================
  -- modifiers.spec.ts — Update-Configuration Modifiers validation
  -- =========================================================================
  describe('Update-Configuration Modifiers', function()
    it('Network share must be a number in [0,1]', function()
      local base = newBase()
      assert.is_true(has(outData(updateConfig(base, { Modifiers = { Network = { Share = 'abc' } } })), 'Modifiers.Network.Share'))
      assert.is_true(has(outData(updateConfig(base, { Modifiers = { Network = { Share = 2 } } })), 'has to be <= 1'))
      assert.is_true(has(outData(updateConfig(base, { Modifiers = { Network = { Share = -2 } } })), 'has to be >= 0'))
    end)
    it('Hardware Enabled must be boolean', function()
      local base = newBase()
      assert.is_true(has(outData(updateConfig(base, { Modifiers = { Hardware = { Enabled = 'asd', Share = 0.2 } } })), 'Boolean value required'))
      assert.is_true(has(outData(updateConfig(base, { Modifiers = { Hardware = { Enabled = 1, Share = 0.2 } } })), 'Boolean value required'))
    end)
    it('Hardware Share must be a number in [0,1]', function()
      local base = newBase()
      assert.is_true(has(outData(updateConfig(base, { Modifiers = { Hardware = { Enabled = true, Share = 'x' } } })), 'Modifiers.Hardware.Share'))
      assert.is_true(has(outData(updateConfig(base, { Modifiers = { Hardware = { Enabled = true, Share = 2 } } })), 'has to be <= 1'))
      assert.is_true(has(outData(updateConfig(base, { Modifiers = { Hardware = { Enabled = true, Share = -2 } } })), 'has to be >= 0'))
    end)
    it('UptimeInfluence on Hardware must be a number in [0,1]', function()
      local base = newBase()
      assert.is_true(has(outData(updateConfig(base, { Modifiers = { Hardware = { Enabled = true, Share = 0.2, UptimeInfluence = 'x' } } })), 'UptimeInfluence'))
      assert.is_true(has(outData(updateConfig(base, { Modifiers = { Hardware = { Enabled = true, Share = 0.2, UptimeInfluence = 2 } } })), 'has to be <= 1'))
      assert.is_true(has(outData(updateConfig(base, { Modifiers = { Hardware = { Enabled = true, Share = 0.2, UptimeInfluence = -1 } } })), 'has to be >= 0'))
    end)
    it('Uptime Enabled must be boolean', function()
      local base = newBase()
      assert.is_true(has(outData(updateConfig(base, { Modifiers = { Uptime = { Enabled = 'asd', Share = 0.14 } } })), 'Boolean value required'))
      assert.is_true(has(outData(updateConfig(base, { Modifiers = { Uptime = { Enabled = 1, Share = 0.14 } } })), 'Boolean value required'))
    end)
    it('Uptime Share must be a number in [0,1]', function()
      local base = newBase()
      assert.is_true(has(outData(updateConfig(base, { Modifiers = { Uptime = { Enabled = true, Share = 'x' } } })), 'Modifiers.Uptime.Share'))
      assert.is_true(has(outData(updateConfig(base, { Modifiers = { Uptime = { Enabled = true, Share = 2 } } })), 'has to be <= 1'))
      assert.is_true(has(outData(updateConfig(base, { Modifiers = { Uptime = { Enabled = true, Share = -2 } } })), 'has to be >= 0'))
    end)
    it('Uptime Tiers must be a table', function()
      local base = newBase()
      assert.is_true(has(outData(updateConfig(base, { Modifiers = { Uptime = { Enabled = true, Share = 0.14, Tiers = 123 } } })), 'Table type required'))
    end)
    it('Uptime Tiers keys must be integers >= 0', function()
      local base = newBase()
      assert.is_true(has(outData(updateConfig(base, { Modifiers = { Uptime = { Enabled = true, Share = 0.14, Tiers = { ['a'] = 1 } } } })), 'Modifiers.Uptime.Tiers days'))
      assert.is_true(has(outData(updateConfig(base, { Modifiers = { Uptime = { Enabled = true, Share = 0.14, Tiers = { ['-10'] = 1 } } } })), 'has to be >= 0'))
    end)
    it('Uptime Tiers values must be numbers >= 0', function()
      local base = newBase()
      assert.is_true(has(outData(updateConfig(base, { Modifiers = { Uptime = { Enabled = true, Share = 0.14, Tiers = { ['3'] = 'a' } } } })), 'Modifiers.Uptime.Tiers weight'))
      assert.is_true(has(outData(updateConfig(base, { Modifiers = { Uptime = { Enabled = true, Share = 0.14, Tiers = { ['3'] = -10 } } } })), 'has to be >= 0'))
    end)
    it('Allows a maximum of 42 Uptime Tiers', function()
      local base = newBase()
      local big = {}
      for i = 0, 42 do big[tostring(i)] = 1 end   -- 43 tiers
      assert.is_true(has(outData(updateConfig(base, { Modifiers = { Uptime = { Enabled = true, Share = 0.14, Tiers = big } } })), 'Too many'))
    end)
    it('ExitBonus Enabled must be boolean', function()
      local base = newBase()
      assert.is_true(has(outData(updateConfig(base, { Modifiers = { ExitBonus = { Enabled = 'asd', Share = 0.1 } } })), 'Boolean value required'))
      assert.is_true(has(outData(updateConfig(base, { Modifiers = { ExitBonus = { Enabled = 1, Share = 0.1 } } })), 'Boolean value required'))
    end)
    it('ExitBonus Share must be a number in [0,1]', function()
      local base = newBase()
      assert.is_true(has(outData(updateConfig(base, { Modifiers = { ExitBonus = { Enabled = true, Share = 'x' } } })), 'Modifiers.ExitBonus.Share'))
      assert.is_true(has(outData(updateConfig(base, { Modifiers = { ExitBonus = { Enabled = true, Share = 2 } } })), 'has to be <= 1'))
      assert.is_true(has(outData(updateConfig(base, { Modifiers = { ExitBonus = { Enabled = true, Share = -2 } } })), 'has to be >= 0'))
    end)
    it('Sum of enabled-modifier shares must equal 1', function()
      local base = newBase()
      assert.is_true(has(outData(updateConfig(base, { Modifiers = { Network = { Share = 0.5 } } })), 'Sum of shares'))
      -- only Network enabled at share 1 is accepted
      assert.are.equal('OK', outData(updateConfig(base, { Modifiers = {
        Network = { Share = 1 }, Hardware = { Enabled = false, Share = 0 },
        Uptime = { Enabled = false, Share = 0 }, ExitBonus = { Enabled = false, Share = 0 } } })))
    end)
  end)

  -- =========================================================================
  -- multipliers.spec.ts — Update-Configuration Multipliers validation
  -- =========================================================================
  describe('Update-Configuration Multipliers', function()
    it('Family Enabled must be boolean', function()
      local base = newBase()
      assert.is_true(has(outData(updateConfig(base, { Multipliers = { Family = { Enabled = 'asd', Offset = 0.01, Power = 1 } } })), 'Multipliers.Family.Enabled'))
    end)
    it('Family Offset must be a number in [0,1]', function()
      local base = newBase()
      assert.is_true(has(outData(updateConfig(base, { Multipliers = { Family = { Enabled = true, Offset = 'x', Power = 1 } } })), 'Multipliers.Family.Offset'))
      assert.is_true(has(outData(updateConfig(base, { Multipliers = { Family = { Enabled = true, Offset = 2, Power = 1 } } })), 'has to be <= 1'))
      assert.is_true(has(outData(updateConfig(base, { Multipliers = { Family = { Enabled = true, Offset = -2, Power = 1 } } })), 'has to be >= 0'))
    end)
    it('Family Power must be a number >= 0', function()
      local base = newBase()
      assert.is_true(has(outData(updateConfig(base, { Multipliers = { Family = { Enabled = true, Offset = 0.01, Power = 'x' } } })), 'Multipliers.Family.Power'))
      assert.is_true(has(outData(updateConfig(base, { Multipliers = { Family = { Enabled = true, Offset = 0.01, Power = -1 } } })), 'has to be >= 0'))
    end)
    it('Location Enabled must be boolean', function()
      local base = newBase()
      assert.is_true(has(outData(updateConfig(base, { Multipliers = { Location = { Enabled = 'asd', Offset = 0.001, Power = 2, Divider = 20 } } })), 'Multipliers.Location.Enabled'))
    end)
    it('Location Offset must be a number in [0,1]', function()
      local base = newBase()
      assert.is_true(has(outData(updateConfig(base, { Multipliers = { Location = { Enabled = true, Offset = 'x', Power = 2, Divider = 20 } } })), 'Multipliers.Location.Offset'))
      assert.is_true(has(outData(updateConfig(base, { Multipliers = { Location = { Enabled = true, Offset = 2, Power = 2, Divider = 20 } } })), 'has to be <= 1'))
      assert.is_true(has(outData(updateConfig(base, { Multipliers = { Location = { Enabled = true, Offset = -2, Power = 2, Divider = 20 } } })), 'has to be >= 0'))
    end)
    it('Location Power must be a number >= 0', function()
      local base = newBase()
      assert.is_true(has(outData(updateConfig(base, { Multipliers = { Location = { Enabled = true, Offset = 0.001, Power = 'x', Divider = 20 } } })), 'Multipliers.Location.Power'))
      assert.is_true(has(outData(updateConfig(base, { Multipliers = { Location = { Enabled = true, Offset = 0.001, Power = -1, Divider = 20 } } })), 'has to be >= 0'))
    end)
  end)

  -- =========================================================================
  -- delegates.spec.ts — Update-Configuration Delegates + Set-Delegate
  -- =========================================================================
  describe('Update-Configuration Delegates', function()
    it('Delegate share must be a number in [0,1]', function()
      local base = newBase()
      assert.is_true(has(outData(updateConfig(base, { Delegates = { [ALICE] = { Address = BOB, Share = 'abc' } } })), 'Share'))
      assert.is_true(has(outData(updateConfig(base, { Delegates = { [ALICE] = { Address = BOB, Share = 2 } } })), 'has to be <= 1'))
      assert.is_true(has(outData(updateConfig(base, { Delegates = { [ALICE] = { Address = BOB, Share = -2 } } })), 'has to be >= 0'))
    end)
    it('Delegate address is validated', function()
      local base = newBase()
      assert.is_true(has(outData(updateConfig(base, { Delegates = { [ALICE] = { Address = 'fail-address', Share = 0.5 } } })), 'Invalid Address'))
    end)
    it('Operator address is validated', function()
      local base = newBase()
      assert.is_true(has(outData(updateConfig(base, { Delegates = { ['fail-address'] = { Address = BOB, Share = 0.5 } } })), 'Invalid Address'))
    end)
  end)

  describe('Set-Delegate', function()
    it('Delegate share must be a number in [0,1]', function()
      local base = newBase()
      assert.is_true(has(outData(setDelegate(base, ALICE, BOB, 'asd')), 'Delegate.Share'))
      assert.is_true(has(outData(setDelegate(base, ALICE, BOB, 2)), 'has to be <= 1'))
      assert.is_true(has(outData(setDelegate(base, ALICE, BOB, -2)), 'has to be >= 0'))
    end)
    it('Delegate address is validated', function()
      local base = newBase()
      assert.is_true(has(outData(setDelegate(base, ALICE, 'fail-address', 0.2)), 'Invalid Address'))
    end)
    it('keys the delegate by the verified committer (operator identity is node-verified, D6)', function()
      -- DEVIATION: native trusts ctx.from (the node-verified, EIP-55 committer) as the operator and
      -- does NOT re-validate it in-contract (address-type-agnostic runtime), unlike legacynet which
      -- asserted msg.From. So an operator can only ever set a delegate for their OWN verified address.
      local base = newBase()
      setDelegate(base, ALICE, BOB, 0.2)
      assert.are.same({ Address = BOB, Share = 0.2 }, RelayRewards.Configuration.Delegates[ALICE])
      assert.is_nil(RelayRewards.Configuration.Delegates[BOB])
    end)
    it('Allows users to set and clear the Delegate', function()
      local base = newBase()
      assert.are.equal('OK', outData(setDelegate(base, ALICE, BOB, 0.2)))
      assert.are.same({ Address = BOB, Share = 0.2 }, RelayRewards.Configuration.Delegates[ALICE])
      assert.are.same({ Address = BOB, Share = 0.2 }, view(base, 'delegate', { address = ALICE }))
      assert.are.equal('RESET', outData(setDelegate(base, ALICE, nil, nil)))
      assert.is_nil(RelayRewards.Configuration.Delegates[ALICE])
      assert.are.same({ Address = '', Share = 0 }, view(base, 'delegate', { address = ALICE }))
    end)
  end)

  -- =========================================================================
  -- add-scores.spec.ts
  -- =========================================================================
  describe('Add-Scores', function()
    it('Blocks non-owners from doing updates', function()
      local base = newBase()
      addScores(base, { [FP_A] = score(ALICE) }, 1000, ALICE)
      assert.is_true(has(outData(base), 'Permission Denied'))
    end)
    it('Requires message data (JSON)', function()
      local base = newBase()
      compute(base, assign('Add-Scores', OWNER, nil, { ['Round-Timestamp'] = '1000' }))
      assert.is_true(has(outData(base), 'Message data is required'))
    end)
    -- Brought to parity with the staking spec (missing tag / empty / non-numeric) and
    -- extended with the FRACTIONAL case, which the legacy suite asserted as "timestamp is
    -- integer" and neither native spec covered. It is the case that matters most here:
    -- `utils.parseInt` is the A12 workaround (luerl's `tonumber` never yields the integer
    -- subtype), and its strictness — rejecting anything with a non-digit byte, where
    -- `tonumber` would happily return 1783067641960.5 — is the only thing keeping a
    -- fractional round timestamp out of the state.
    it('Ensures provided timestamp is an integer', function()
      local base = newBase()
      local function reject(tags)
        compute(base, assign('Add-Scores', OWNER, json.encode({ Scores = {} }), tags))
        assert.is_true(has(outData(base), 'Round-Timestamp tag'))
      end
      reject(nil)                                          -- tag absent
      reject({ ['Round-Timestamp'] = '' })                 -- empty
      reject({ ['Round-Timestamp'] = 'bad-stamp' })        -- non-numeric
      reject({ ['Round-Timestamp'] = '1783067641960.5' })  -- numeric but fractional
    end)
    it('Ensures timestamp is > 0', function()
      local base = newBase()
      compute(base, assign('Add-Scores', OWNER, json.encode({ Scores = { [FP_A] = score(ALICE) } }), { ['Round-Timestamp'] = '0' }))
      assert.is_true(has(outData(base), 'has to be > 0'))
      compute(base, assign('Add-Scores', OWNER, json.encode({ Scores = { [FP_A] = score(ALICE) } }), { ['Round-Timestamp'] = '-100' }))
      assert.is_true(has(outData(base), 'Round-Timestamp'))
    end)
    it('Ensures timestamp is not backdated to previous round', function()
      local base = newBase()
      addScores(base, { [FP_A] = score(ALICE) }, 10000); completeRound(base, 10000)
      addScores(base, { [FP_A] = score(ALICE) }, 10000)
      assert.is_true(has(outData(base), 'backdated'))
      assert.are.equal('OK', outData(addScores(base, { [FP_A] = score(ALICE) }, 20000)))
    end)
    it('Scores must be a table', function()
      local base = newBase()
      compute(base, assign('Add-Scores', OWNER, json.encode({ Scores = 'some scores' }), { ['Round-Timestamp'] = '1000' }))
      assert.is_true(has(outData(base), 'Scores have to be a table'))
    end)
    it('Each score - Fingerprint has valid format', function()
      local base = newBase()
      addScores(base, { ['asd'] = score(ALICE) }, 1000)
      assert.is_true(has(outData(base), 'Invalid Fingerprint'))
    end)
    it('Each score - Fingerprint was not already set during the round', function()
      local base = newBase()
      assert.are.equal('OK', outData(addScores(base, { [FP_A] = score(ALICE) }, 1000)))
      addScores(base, { [FP_A] = score(BOB) }, 1000)
      assert.is_true(has(outData(base), 'Duplicated score for'))
    end)
    it('Each score - Address must be a valid EVM address', function()
      local base = newBase()
      addScores(base, { [FP_A] = score('not-an-address') }, 1000)
      assert.is_true(has(outData(base), 'Invalid Address'))
    end)
    it('Each score - Network must be an integer >= 0', function()
      local base = newBase()
      local s = score(ALICE); s.Network = -100
      addScores(base, { [FP_A] = s }, 1000)
      assert.is_true(has(outData(base), 'Network'))
    end)
    it('Each score - IsHardware must be boolean', function()
      local base = newBase()
      local s = score(ALICE); s.IsHardware = 12
      addScores(base, { [FP_A] = s }, 1000)
      assert.is_true(has(outData(base), 'IsHardware'))
    end)
    it('Each score - UptimeStreak must be an integer >= 0', function()
      local base = newBase()
      local s = score(ALICE); s.UptimeStreak = -100
      addScores(base, { [FP_A] = s }, 1000)
      assert.is_true(has(outData(base), 'UptimeStreak'))
    end)
    it('Each score - ExitBonus must be boolean', function()
      local base = newBase()
      local s = score(ALICE); s.ExitBonus = 12
      addScores(base, { [FP_A] = s }, 1000)
      assert.is_true(has(outData(base), 'ExitBonus'))
    end)
    it('Each score - FamilySize must be an integer >= 0', function()
      local base = newBase()
      local s = score(ALICE); s.FamilySize = -100
      addScores(base, { [FP_A] = s }, 1000)
      assert.is_true(has(outData(base), 'FamilySize'))
    end)
    it('Each score - LocationSize must be an integer >= 0', function()
      local base = newBase()
      local s = score(ALICE); s.LocationSize = -100
      addScores(base, { [FP_A] = s }, 1000)
      assert.is_true(has(outData(base), 'LocationSize'))
    end)
    it('validate-before-mutate: a bad item stages NOTHING; a good batch stages under the string key', function()
      local base = newBase()
      addScores(base, { [FP_A] = score(ALICE), [FP_B] = score('bad') }, 1000)
      assert.is_true(has(outData(base), 'Invalid Address'))
      assert.is_nil(RelayRewards.PendingRounds['1000'])
      assert.are.equal('OK', outData(addScores(base, { [FP_A] = score(ALICE, { Network = 7 }) }, 1000)))
      assert.are.equal(7, RelayRewards.PendingRounds['1000'][FP_A].Score.Network)
      assert.is_nil(RelayRewards.PendingRounds[1000])   -- A17: string key only
    end)
  end)

  -- =========================================================================
  -- round-cancel.spec.ts
  -- =========================================================================
  describe('Cancel-Round', function()
    it('Blocks non-owners from doing updates', function()
      local base = newBase()
      addScores(base, { [FP_A] = score(ALICE) }, 1000)
      cancelRound(base, 1000, ALICE)
      assert.is_true(has(outData(base), 'Permission Denied'))
    end)
    it('Ensures provided timestamp is numeric', function()
      local base = newBase()
      compute(base, assign('Cancel-Round', OWNER, nil, { ['Round-Timestamp'] = 'bad-stamp' }))
      assert.is_true(has(outData(base), 'Round-Timestamp tag'))
    end)
    it('Confirms a pending round exists for the timestamp', function()
      local base = newBase()
      cancelRound(base, 1234567890)
      assert.is_true(has(outData(base), 'No pending round for'))
    end)
    it('Removes the pending round for the timestamp', function()
      local base = newBase()
      addScores(base, { [FP_A] = score(ALICE) }, 1234567890)
      assert.are.equal('OK', outData(cancelRound(base, 1234567890)))
      assert.is_nil(RelayRewards.PendingRounds['1234567890'])
    end)
  end)

  -- =========================================================================
  -- round-complete.spec.ts
  -- =========================================================================
  describe('Complete-Round', function()
    it('Blocks non-owners from doing updates', function()
      local base = newBase()
      addScores(base, { [FP_A] = score(ALICE) }, 1000)
      completeRound(base, 1000, ALICE)
      assert.is_true(has(outData(base), 'Permission Denied'))
    end)
    it('Ensures provided timestamp is numeric', function()
      local base = newBase()
      compute(base, assign('Complete-Round', OWNER, nil, { ['Round-Timestamp'] = 'bad-stamp' }))
      assert.is_true(has(outData(base), 'Round-Timestamp tag'))
    end)
    it('Confirms a pending round exists for the timestamp', function()
      local base = newBase()
      completeRound(base, 1000)
      assert.is_true(has(outData(base), 'No pending round for 1000'))
    end)
    it('Removes rounds dated at/before the completed timestamp', function()
      local base = newBase()
      addScores(base, { [FP_A] = score(ALICE) }, 1000)
      addScores(base, { [FP_B] = score(BOB) }, 2000)
      completeRound(base, 2000)
      assert.is_nil(RelayRewards.PendingRounds['1000'])   -- older pruned
      assert.is_nil(RelayRewards.PendingRounds['2000'])   -- settled pruned
      cancelRound(base, 1000)
      assert.is_true(has(outData(base), 'No pending round for 1000'))
    end)
    it('Tracks data and metadata of the last round (TokensPerSecond 123, Network share 1)', function()
      local base = newBase()
      updateConfig(base, { TokensPerSecond = '123', Modifiers = {
        Network = { Share = 1 }, Hardware = { Enabled = false, Share = 0 },
        Uptime = { Enabled = false, Share = 0 }, ExitBonus = { Enabled = false, Share = 0 } } })
      completeR(base, 1000, { [FP_A] = score(ALICE, { Network = 0 }) })                  -- Period 0
      local snap = completeR(base, 2000, {                                              -- Period 1
        [FP_A] = score(ALICE, { Network = 0 }), [FP_B] = score(BOB, { Network = 100 }) })
      -- Complete-Round output (Details ride the output; last-round metadata persists as SUMMARY)
      assert.are.equal(2000, snap.Timestamp)
      assert.are.equal(1, snap.Period)
      assert.are.equal('123', snap.Details[FP_B].Reward.OperatorTotal)
      assert.are.equal(100, snap.Details[FP_B].Rating.Network)
      local lr = view(base, 'last_round')
      assert.are.equal(2000, lr.Timestamp)
      assert.are.equal(1, lr.Period)
      assert.are.equal('123', lr.Summary.Rewards.Total)
      assert.are.equal('123', lr.Summary.Rewards.Network)
      assert.are.equal('100', lr.Summary.Ratings.Network)
      -- cumulative maps
      assert.are.equal('123', RelayRewards.TotalAddressReward[BOB])
      assert.are.equal('0', RelayRewards.TotalAddressReward[ALICE])
      assert.are.equal('123', RelayRewards.TotalFingerprintReward[FP_B])
      assert.are.equal('0', RelayRewards.TotalFingerprintReward[FP_A])
      assert.is_nil(RelayRewards.PreviousRound.Details)   -- Details NOT persisted
    end)

    -- The settle-slot pointer (D29 §2). Because Details are never persisted, the settlement has
    -- to record WHERE its own output landed or consumers would have to scan backwards for the
    -- last Complete-Round. `slot` rides the ASSIGNMENT (req), not req.body — the same level as
    -- `timestamp` — and the node delivers it as a string.
    it('Records its own settle slot, on the output and the persisted summary', function()
      local base = newBase()
      assert.are.equal(0, view(base, 'last_round').Slot)   -- unset until a round settles
      addScores(base, { [FP_A] = score(ALICE) }, 1000)
      local req = assign('Complete-Round', OWNER, nil, { ['Round-Timestamp'] = '1000' })
      req.slot = '7'
      local snap = json.decode(outData(compute(base, req)))
      assert.are.equal(7, snap.Slot)                       -- self-identifying output
      assert.are.equal(7, RelayRewards.PreviousRound.Slot)
      assert.are.equal(7, view(base, 'last_round').Slot)
    end)

    -- Details are persisted as PER-FINGERPRINT pre-encoded JSON strings, so nothing walks or
    -- re-encodes them, and a point read costs one key lookup.
    it('Persists Details as per-fingerprint JSON strings matching the output', function()
      local base = newBase()
      addScores(base, { [FP_A] = score(ALICE), [FP_B] = score(BOB) }, 1000)
      local snap = json.decode(outData(completeRound(base, 1000)))
      local stored = RelayRewards.PreviousRound.DetailsJson
      assert.is_nil(RelayRewards.PreviousRound.Details)          -- not under the old name
      assert.are.equal('string', type(stored[FP_A]))             -- VALUES are strings...
      assert.are.equal('string', type(stored[FP_B]))
      -- ...and each decodes to exactly that fingerprint's line in the output, so the settle-slot
      -- payload and the state read cannot diverge.
      assert.are.same(snap.Details[FP_A], json.decode(stored[FP_A]))
      assert.are.same(snap.Details[FP_B], json.decode(stored[FP_B]))
    end)

    it('Serves one fingerprint through the view with no re-encoding', function()
      local base = newBase()
      addScores(base, { [FP_A] = score(ALICE) }, 1000)
      completeRound(base, 1000)
      -- native.view hands back the raw stored string...
      local raw = view(base, 'last_round_details', { fingerprint = FP_A })
      assert.are.equal('string', type(raw))
      assert.are.equal(ALICE, json.decode(raw).Address)
      -- ...and the installed global wraps it as the BODY verbatim. Re-encoding would yield a
      -- quoted string literal ('"{\\"...\\"}"'), so assert the body still parses as an object.
      native.installViews()
      local res = _G['last_round_details'](base, { fingerprint = FP_A })
      assert.are.equal(raw, res.body)
      assert.are.equal('application/json', res['content-type'])
      assert.are.equal(ALICE, json.decode(res.body).Address)
    end)

    -- Empty answers are '[]', not '{}': the wrapper's default is `json.encode({})` and the
    -- encoder cannot tell an empty object from an empty array. This is the EXISTING convention
    -- for every view's absent-key answer (`rewards`, `claimed`, `delegate` all do it), so it is
    -- pinned here rather than special-cased — a consumer must test for its field, not for '{}'.
    it('Answers empty for a missing fingerprint, an unknown one, or before any round', function()
      local base = newBase()
      native.installViews()
      assert.are.equal('[]', _G['last_round_details'](base, nil).body)              -- no param
      assert.are.equal('[]', _G['last_round_details'](base, { fingerprint = FP_A }).body)
      addScores(base, { [FP_A] = score(ALICE) }, 1000); completeRound(base, 1000)
      assert.are.equal('[]', _G['last_round_details'](base, { fingerprint = FP_C }).body)
      assert.is_not_nil(view(base, 'last_round_details', { fingerprint = FP_A }))
    end)

    it('Falls back to slot 0 with no assignment (Tier-1/2 harness path)', function()
      local base = newBase()
      addScores(base, { [FP_A] = score(ALICE) }, 1000)
      assert.are.equal(0, json.decode(outData(completeRound(base, 1000))).Slot)
      assert.are.equal(0, RelayRewards.PreviousRound.Slot)
    end)
  end)

  -- =========================================================================
  -- score-processing.spec.ts — network score + reference multiplier formulas
  -- =========================================================================
  describe('Score processing', function()
    local score0 = score(ALICE, { Network = 0 })
    local score1 = score(BOB, { Network = 100 })
    local score1WithMul = score(BOB, { Network = 100, IsHardware = true, FamilySize = 10, LocationSize = 10 })

    it('Verify base network score assignment', function()
      local base = newBase()
      updateConfig(base, { TokensPerSecond = '123', Modifiers = {
        Network = { Share = 1 }, Hardware = { Enabled = false, Share = 0, UptimeInfluence = 0 },
        Uptime = { Enabled = false, Share = 0 }, ExitBonus = { Enabled = false, Share = 0 } },
        Multipliers = { Location = { Enabled = false, Offset = 1, Power = 1, Divider = 1 } } })
      completeR(base, 1000, { [FP_A] = score0, [FP_B] = score1 })   -- Period 0
      completeR(base, 2000, { [FP_A] = score0, [FP_B] = score1 })   -- Period 1 → Bob 123
      assert.are.equal('123', RelayRewards.TotalAddressReward[BOB])
      assert.are.equal('0', RelayRewards.TotalAddressReward[ALICE])
      completeR(base, 3000, { [FP_A] = score0, [FP_B] = score1 })   -- cumulative → Bob 246
      assert.are.equal('246', view(base, 'rewards', { address = BOB }).reward)
      assert.are.equal('0', view(base, 'rewards', { address = ALICE }).reward)
      assert.are.equal('246', view(base, 'rewards', { fingerprint = FP_B }).reward)
      assert.are.equal('0', view(base, 'rewards', { fingerprint = FP_A }).reward)
    end)

    it('Validate reference family multiplier formula (1.1 → Rating.Network 110)', function()
      local base = newBase()
      updateConfig(base, { TokensPerSecond = '100', Modifiers = {
        Network = { Share = 1 }, Hardware = { Enabled = false, Share = 0, UptimeInfluence = 0 },
        Uptime = { Enabled = false, Share = 0 }, ExitBonus = { Enabled = false, Share = 0 } },
        Multipliers = { Family = { Enabled = true, Offset = 0.01, Power = 1 },
                        Location = { Enabled = false, Offset = 1, Power = 1, Divider = 1 } } })
      completeR(base, 1000, { [FP_A] = score0, [FP_B] = score1 })
      completeR(base, 2000, { [FP_A] = score0, [FP_B] = score1 })
      local snap = completeR(base, 3000, { [FP_A] = score0, [FP_B] = score1WithMul })
      assert.are.equal(1.1, snap.Details[FP_B].Variables.FamilyMultiplier)
      assert.are.equal(110, snap.Details[FP_B].Rating.Network)
    end)

    it('Validate reference location multiplier formula (0.7 → Rating.Network 70)', function()
      local base = newBase()
      updateConfig(base, { TokensPerSecond = '100', Modifiers = {
        Network = { Share = 1 }, Hardware = { Enabled = false, Share = 0, UptimeInfluence = 0 },
        Uptime = { Enabled = false, Share = 0 }, ExitBonus = { Enabled = false, Share = 0 } },
        Multipliers = { Location = { Enabled = true, Offset = 0.003, Power = 2, Divider = 1 },
                        Family = { Enabled = false, Offset = 1, Power = 1 } } })
      completeR(base, 1000, { [FP_A] = score0, [FP_B] = score1 })
      completeR(base, 2000, { [FP_A] = score0, [FP_B] = score1 })
      local snap = completeR(base, 3000, { [FP_A] = score0, [FP_B] = score1WithMul })
      assert.are.equal(0.7, snap.Details[FP_B].Variables.LocationMultiplier)
      assert.are.equal(70, snap.Details[FP_B].Rating.Network)
    end)
  end)

  -- =========================================================================
  -- score-ratings.spec.ts — uptime tiers, hardware 65/35 split, exit bonus
  -- =========================================================================
  describe('Score ratings', function()
    it('Calculate uptime ratings with uptime streak tiers', function()
      local base = newBase()
      updateConfig(base, { TokensPerSecond = '1000', Modifiers = {
        Network = { Share = 0.9 }, Hardware = { Enabled = true, Share = 0 },
        Uptime = { Enabled = true, Share = 0.1, Tiers = { ['0'] = 0, ['3'] = 1, ['14'] = 3 } },
        ExitBonus = { Enabled = false, Share = 0 } } })
      completeR(base, 1000, { [FP_A] = score(ALICE, { Network = 100 }) })                 -- Period 0
      local s2 = completeR(base, 2000, {                                                  -- Period 1
        [FP_A] = score(ALICE, { Network = 100, IsHardware = true }),
        [FP_B] = score(BOB, { Network = 200, UptimeStreak = 3 }) })
      assert.are.equal('100', s2.Summary.Rewards.Uptime)
      assert.are.equal('1.0', s2.Summary.Ratings.Uptime)
      assert.are.equal(0, s2.Details[FP_A].Rating.Uptime)
      assert.are.equal('0', s2.Details[FP_A].Reward.Uptime)
      assert.are.equal(1, s2.Details[FP_B].Rating.Uptime)
      assert.are.equal('100', s2.Details[FP_B].Reward.Uptime)
      assert.are.equal('600', s2.Details[FP_B].Reward.Network)
      assert.are.equal('700', s2.Details[FP_B].Reward.Total)
      local s3 = completeR(base, 3000, {                                                  -- Period 1
        [FP_A] = score(ALICE, { Network = 100, IsHardware = true, UptimeStreak = 3 }),
        [FP_B] = score(BOB, { Network = 200, UptimeStreak = 14 }) })
      assert.are.equal('4.0', s3.Summary.Ratings.Uptime)
      assert.are.equal('100', s3.Summary.Rewards.Uptime)
      assert.are.equal(1, s3.Details[FP_A].Rating.Uptime)
      assert.are.equal('25', s3.Details[FP_A].Reward.Uptime)
      assert.are.equal(3, s3.Details[FP_B].Rating.Uptime)
      assert.are.equal('75', s3.Details[FP_B].Reward.Uptime)
      assert.are.equal('600', s3.Details[FP_B].Reward.Network)
      assert.are.equal('675', s3.Details[FP_B].Reward.Total)
    end)

    it('Calculate hardware bonus (65% network + 35% uptime)', function()
      local base = newBase()
      updateConfig(base, { TokensPerSecond = '1000', Modifiers = {
        Network = { Share = 0.56 },
        Uptime = { Enabled = true, Share = 0.14, Tiers = { ['0'] = 0, ['3'] = 1, ['14'] = 3 } },
        Hardware = { Enabled = true, Share = 0.3 }, ExitBonus = { Enabled = false, Share = 0 } } })
      completeR(base, 1000, { [FP_A] = score(ALICE, { Network = 100 }) })                 -- Period 0
      local s2 = completeR(base, 2000, { [FP_A] = score(ALICE, { Network = 100 }) })      -- no hw/uptime
      assert.are.equal('0', s2.Summary.Rewards.Uptime)
      assert.are.equal('0', s2.Summary.Rewards.Hardware)
      assert.are.equal('0.0', s2.Summary.Ratings.Uptime)
      assert.are.equal(0, s2.Details[FP_A].Rating.Uptime)
      assert.are.equal('0', s2.Details[FP_A].Reward.Uptime)
      assert.are.equal('0', s2.Details[FP_A].Reward.Hardware)
      assert.are.equal('560', s2.Details[FP_A].Reward.Network)
      local s3 = completeR(base, 3000, { [FP_A] = score(ALICE, { Network = 100, IsHardware = true, UptimeStreak = 3 }) })
      assert.are.equal('140', s3.Summary.Rewards.Uptime)
      assert.are.equal('300', s3.Summary.Rewards.Hardware)
      assert.are.equal('1.0', s3.Summary.Ratings.Uptime)
      assert.are.equal(1, s3.Details[FP_A].Rating.Uptime)
      assert.are.equal('140', s3.Details[FP_A].Reward.Uptime)
      assert.are.equal('300', s3.Details[FP_A].Reward.Hardware)
      assert.are.equal('560', s3.Details[FP_A].Reward.Network)
      assert.are.equal('1000', s3.Details[FP_A].Reward.Total)
      local s4 = completeR(base, 4000, {                                                  -- Alice hw uptime14, Bob uptime3 no hw
        [FP_A] = score(ALICE, { Network = 100, IsHardware = true, UptimeStreak = 14 }),
        [FP_B] = score(BOB, { Network = 200, UptimeStreak = 3 }) })
      assert.are.equal('4.0', s4.Summary.Ratings.Uptime)
      assert.are.equal('140', s4.Summary.Rewards.Uptime)
      assert.are.equal('300', s4.Summary.Rewards.Hardware)
      assert.are.equal(3, s4.Details[FP_A].Rating.Uptime)
      assert.are.equal('105', s4.Details[FP_A].Reward.Uptime)
      assert.are.equal('186', s4.Details[FP_A].Reward.Network)   -- floor(560 * 100/300)
      assert.are.equal('300', s4.Details[FP_A].Reward.Hardware)
      assert.are.equal('591', s4.Details[FP_A].Reward.Total)
      assert.are.equal(1, s4.Details[FP_B].Rating.Uptime)
      assert.are.equal('35', s4.Details[FP_B].Reward.Uptime)
      assert.are.equal('0', s4.Details[FP_B].Reward.Hardware)
      assert.are.equal('373', s4.Details[FP_B].Reward.Network)   -- floor(560 * 200/300)
      assert.are.equal('408', s4.Details[FP_B].Reward.Total)
    end)

    it('Calculate exit bonus', function()
      local base = newBase()
      updateConfig(base, { TokensPerSecond = '1000', Modifiers = {
        Network = { Share = 0.56 },
        Uptime = { Enabled = true, Share = 0.14, Tiers = { ['0'] = 0, ['3'] = 1, ['14'] = 3 } },
        Hardware = { Enabled = true, Share = 0.2 }, ExitBonus = { Enabled = true, Share = 0.1 } } })
      completeR(base, 1000, { [FP_A] = score(ALICE, { Network = 100 }) })                 -- Period 0
      local s2 = completeR(base, 2000, { [FP_A] = score(ALICE, { Network = 100, ExitBonus = true }) })
      assert.are.equal('100', s2.Summary.Rewards.ExitBonus)
      assert.are.equal('100', s2.Summary.Ratings.ExitBonus)
      assert.are.equal(100, s2.Details[FP_A].Rating.ExitBonus)
      assert.are.equal('100', s2.Details[FP_A].Reward.ExitBonus)
      assert.are.equal('560', s2.Details[FP_A].Reward.Network)
      assert.are.equal('660', s2.Details[FP_A].Reward.Total)
    end)
  end)

  -- =========================================================================
  -- score-rewards.spec.ts — period, proportional split, delegate, accumulation
  -- =========================================================================
  describe('Score rewards', function()
    local score1 = score(ALICE, { Network = 100 })
    local score2 = score(BOB, { Network = 200, IsHardware = true, UptimeStreak = 3, ExitBonus = true, LocationSize = 2 })
    local score3 = score(CHARLS, { Network = 300, IsHardware = true, UptimeStreak = 14, ExitBonus = true, FamilySize = 2, LocationSize = 1 })

    it('Calculates a correct period since the last round', function()
      local base = newBase()
      updateConfig(base, { TokensPerSecond = '1000' })
      completeR(base, 1000, { [FP_A] = score1 })                        -- Period 0
      local s2 = completeR(base, 2345, { [FP_A] = score1 })
      assert.are.equal(2345, s2.Timestamp)
      assert.are.equal(math.floor((2345 - 1000) / 1000), s2.Period)     -- 1
      local s3 = completeR(base, 40000, { [FP_A] = score1 })
      assert.are.equal(40000, s3.Timestamp)
      assert.are.equal(math.floor((40000 - 2345) / 1000), s3.Period)    -- 37
    end)

    it('Proportionally rewards relays based on their rating', function()
      local base = newBase()
      updateConfig(base, fullConfig())
      completeR(base, 1000, { [FP_A] = score1 })                        -- Period 0
      local snap = completeR(base, 11000, { [FP_A] = score1, [FP_B] = score2, [FP_C] = score3 })
      assert.are.equal(11000, snap.Timestamp)
      assert.are.equal(10, snap.Period)
      local sum = RelayRewards.PreviousRound.Summary.Ratings
      local sumNet, sumUp, sumExit = tonumber(sum.Network), tonumber(sum.Uptime), tonumber(sum.ExitBonus)
      -- reference formula (matches the WASM harness): Total = floor(5600·ratNet/sumNet) +
      -- floor(1400·ratUp/sumUp) + Reward.Hardware + floor(1000·ratExit/sumExit)
      local function refTotal(d)
        local t = math.floor(5600 * d.Rating.Network / sumNet)
        if sumUp > 0 then t = t + math.floor(1400 * d.Rating.Uptime / sumUp) end
        t = t + tonumber(d.Reward.Hardware)
        if sumExit > 0 then t = t + math.floor(1000 * d.Rating.ExitBonus / sumExit) end
        return tostring(t)
      end
      assert.are.equal(refTotal(snap.Details[FP_A]), snap.Details[FP_A].Reward.Total)
      assert.are.equal(refTotal(snap.Details[FP_B]), snap.Details[FP_B].Reward.Total)
      assert.are.equal(refTotal(snap.Details[FP_C]), snap.Details[FP_C].Reward.Total)
    end)

    it('Assigns a shared reward to the Delegate (5600 → 2240 / 3360)', function()
      local base = newBase()
      updateConfig(base, fullConfig({ Delegates = { [ALICE] = { Address = BOB, Share = 0.4 } } }))
      completeR(base, 1000, { [FP_A] = score1 })                        -- Period 0
      local snap = completeR(base, 11000, { [FP_A] = score1 })          -- Alice sole relay → Network 5600
      assert.are.equal('5600', snap.Details[FP_A].Reward.Total)
      assert.are.equal('2240', snap.Details[FP_A].Reward.DelegateTotal)   -- 5600 * 0.4
      assert.are.equal('3360', snap.Details[FP_A].Reward.OperatorTotal)   -- 5600 * 0.6
    end)

    it('Accumulates rewards by address and by fingerprint', function()
      local base = newBase()
      updateConfig(base, fullConfig({ Delegates = { [ALICE] = { Address = BOB, Share = 0.4 } } }))
      completeR(base, 1000, { [FP_A] = score1 })                        -- Period 0
      completeR(base, 11000, { [FP_A] = score1, [FP_B] = score2, [FP_C] = score3 })
      assert.are.equal('558', RelayRewards.TotalAddressReward[ALICE])     -- 930 * 0.6
      assert.are.equal('930', RelayRewards.TotalFingerprintReward[FP_A])
      assert.are.equal('3631', RelayRewards.TotalAddressReward[BOB])      -- own 3259 + Alice delegate 372
      assert.are.equal('3259', RelayRewards.TotalFingerprintReward[FP_B])
      assert.are.equal('5808', RelayRewards.TotalAddressReward[CHARLS])
      assert.are.equal('5808', RelayRewards.TotalFingerprintReward[FP_C])
      completeR(base, 21000, { [FP_A] = score1 })                       -- only Alice scored
      assert.are.equal('3918', RelayRewards.TotalAddressReward[ALICE])
      assert.are.equal('6530', RelayRewards.TotalFingerprintReward[FP_A])
      assert.are.equal('5871', RelayRewards.TotalAddressReward[BOB])
      assert.are.equal('3259', RelayRewards.TotalFingerprintReward[FP_B])
    end)
  end)

  -- =========================================================================
  -- claim-rewards.spec.ts
  -- =========================================================================
  describe('Claim-Rewards', function()
    local score1 = score(ALICE, { Network = 100 })
    local score2 = score(BOB, { Network = 200, IsHardware = true, UptimeStreak = 3, ExitBonus = true, LocationSize = 2 })
    local score3 = score(CHARLS, { Network = 300, IsHardware = true, UptimeStreak = 14, ExitBonus = true, FamilySize = 2, LocationSize = 1 })

    it('Errors when nothing is owed', function()
      local base = newBase()
      claimRewards(base, ALICE)
      assert.is_true(has(outData(base), 'No rewards for'))
    end)

    it('Tracks Claimed vs rewarded tokens across rounds', function()
      local base = newBase()
      updateConfig(base, fullConfig({ Delegates = { [ALICE] = { Address = BOB, Share = 0.4 } } }))
      completeR(base, 1000, { [FP_A] = score1 })                        -- Period 0
      completeR(base, 11000, { [FP_A] = score1, [FP_B] = score2, [FP_C] = score3 })
      assert.are.equal('558', view(base, 'rewards', { address = ALICE }).reward)
      assert.are.equal('3631', view(base, 'rewards', { address = BOB }).reward)
      assert.are.equal('5808', view(base, 'rewards', { address = CHARLS }).reward)
      -- claim Alice + Bob
      assert.are.equal('558', json.decode(outData(claimRewards(base, ALICE))))
      assert.are.equal('558', RelayRewards.Claimed[ALICE])
      assert.are.equal('3631', json.decode(outData(claimRewards(base, BOB))))
      assert.are.equal('3631', RelayRewards.Claimed[BOB])
      assert.are.equal('558', view(base, 'claimed', { address = ALICE }).claimed)
      assert.are.equal('3631', view(base, 'claimed', { address = BOB }).claimed)
      assert.is_nil(view(base, 'claimed', { address = CHARLS }).claimed)   -- never claimed
      -- second round (cumulative doubles)
      completeR(base, 21000, { [FP_A] = score1, [FP_B] = score2, [FP_C] = score3 })
      assert.are.equal('1116', view(base, 'rewards', { address = ALICE }).reward)
      assert.are.equal('7262', view(base, 'rewards', { address = BOB }).reward)
      assert.are.equal('11616', view(base, 'rewards', { address = CHARLS }).reward)
      assert.are.equal('1116', json.decode(outData(claimRewards(base, ALICE))))
      assert.are.equal('11616', json.decode(outData(claimRewards(base, CHARLS))))
      assert.are.equal('1116', view(base, 'claimed', { address = ALICE }).claimed)
      assert.are.equal('3631', view(base, 'claimed', { address = BOB }).claimed)   -- unchanged (not re-claimed)
      assert.are.equal('11616', view(base, 'claimed', { address = CHARLS }).claimed)
    end)
  end)

  -- =========================================================================
  -- view-init-state.spec.ts → migrate-on-spawn: a SEEDED base (module carries RelayRewards, no Init
  -- action) exposes the imported state through views. Reimport = seed a fresh base from a dump.
  -- =========================================================================
  describe('Seeded state (migrate-on-spawn ≙ Init import/reimport)', function()
    local function seed()
      return {
        Claimed = {},
        TotalAddressReward = { [ALICE] = '970102674393447307014' },
        TotalFingerprintReward = { [FP_A] = '46721406387021560357' },
        Configuration = fullConfig({ TokensPerSecond = '40509259200000000' }),
        PreviousRound = { Timestamp = 1741948079386, Period = 3600,
          Summary = { Ratings = { Network = '0', Uptime = '0', ExitBonus = '0' },
            Rewards = { Total = '0', Network = '0', Hardware = '0', Uptime = '0', ExitBonus = '0' } },
          Configuration = {} },
        PendingRounds = {},
      }
    end
    -- Migrate-on-spawn: the state root is planted directly, exactly as native.compute's seed
    -- path does. Through the setters — busted's per-file _ENV proxies _G, so `RelayRewards = …`
    -- here would be invisible to the runtime.
    local function seededBase(state)
      native.reset()
      native.setStateRoot(state)
      native.setACL({ roles = {} })
      return { process = { id = 'PID', commitments = commit(OWNER) } }
    end

    it('exposes imported reward + round state through views (import)', function()
      local base = seededBase(seed())
      assert.are.equal(1741948079386, view(base, 'last_round').Timestamp)
      assert.are.equal(3600, view(base, 'last_round').Period)
      assert.are.equal('40509259200000000', view(base, 'dump').Configuration.TokensPerSecond)
      assert.are.equal('970102674393447307014', view(base, 'rewards', { address = ALICE }).reward)
      assert.are.equal('46721406387021560357', view(base, 'rewards', { fingerprint = FP_A }).reward)
      assert.are.equal('40509259200000000', view(base, 'status').tokensPerSecond)
      assert.are.equal(1741948079386, view(base, 'status').lastRoundTimestamp)
    end)

    it('a further round continues on top of the seeded (migrated) balances (reimport-equivalent)', function()
      local base = seededBase(seed())
      -- dump → reseed a fresh base (the native analog of View-State → Init reimport)
      local dumped = view(base, 'dump')
      local base2 = seededBase({
        Claimed = dumped.Claimed, TotalAddressReward = dumped.TotalAddressReward,
        TotalFingerprintReward = dumped.TotalFingerprintReward, Configuration = dumped.Configuration,
        PreviousRound = dumped.PreviousRound, PendingRounds = {} })
      assert.are.equal('970102674393447307014', view(base2, 'rewards', { address = ALICE }).reward)
      assert.are.equal(1741948079386, view(base2, 'last_round').Timestamp)
      assert.are.equal(3600, view(base2, 'last_round').Period)
    end)
  end)

  -- =========================================================================
  -- Runtime safety (D8 axes) — the WASM harness never exercised these
  -- =========================================================================
  describe('Runtime safety (D8 axes)', function()
    it('Rejects an unsigned message (no committer)', function()
      local base = newBase()
      compute(base, assign('Add-Scores', nil, json.encode({ Scores = { [FP_A] = score(ALICE) } }), { ['Round-Timestamp'] = '1000' }))
      assert.is_true(has(outData(base), 'unsigned or unresolved committer'))
      assert.is_nil(RelayRewards.PendingRounds['1000'])
    end)
    it('Rejects an unknown action', function()
      local base = newBase()
      compute(base, assign('Frobnicate', OWNER, nil))
      assert.is_true(has(outData(base), 'unknown action'))
    end)
    it('Reverts state atomically when a handler errors', function()
      local base = newBase()
      addScores(base, { [FP_A] = score(ALICE) }, 1000); completeRound(base, 1000)
      -- deep-copy + structural compare: `pairs` order is not stable, so comparing json.encode
      -- strings is flaky as soon as the map has more than one key (revert also REPLACES the table).
      local tfrBefore = native.deepcopy(RelayRewards.TotalFingerprintReward)
      completeRound(base, 999999)
      assert.is_true(has(outData(base), 'No pending round for'))
      assert.are.same(tfrBefore, RelayRewards.TotalFingerprintReward)
    end)
  end)
end)
