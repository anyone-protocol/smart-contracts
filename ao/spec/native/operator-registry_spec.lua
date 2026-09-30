--- Tier-1 busted spec — FULL PARITY with the legacynet WASM harness
--- (test/spec/contracts/operator-registry.spec.ts), re-expressed for the D26 native
--- shape on the native runtime, driven under Lua 5.3 (luerl's language level).
---
--- Every active behavior the WASM harness covered is here; the assertions are native:
---   · state is read from `OperatorRegistry` (the single source of truth) — not patch@1.0 tags
---   · a successful action's reply is the compute output `'OK'` — not a `*-Response` message
---   · reads (List-*/View-State/Info) are `native.view(base, <name>)` — not messages
--- Plus a Runtime-safety block for the D8 axes the WASM harness never exercised
--- (unsigned/forged-committer rejection, unknown action, cross-action atomicity).
---
--- OWNER=0x11..1; ALICE/BOB/CHARLS are real mixed-case EIP-55 addresses stored VERBATIM
--- (no case fold on-device — so a stray upper/lower would break exact-match and fail here).
--- FINGERPRINT_A..F = 'A'..'F' × 40.

local HERE = debug.getinfo(1, 'S').source:match('^@(.*/)') or './'
local AO = HERE .. '../..'
local CT, RT = AO .. '/src/contracts', AO .. '/runtime'
local C, V   = CT .. '/common', RT .. '/vendor'

local function freshEnv()
  for _, m in ipairs({ 'json', '.json', '.common.errors', '.common.utils', '.common.eip55' }) do
    package.loaded[m] = nil
  end
  for _, g in ipairs({ 'ao', 'Owner', 'Send', 'compute' }) do _G[g] = nil end
  local function loadmod(p) return assert(loadfile(p))() end
  package.loaded['json']           = loadmod(V .. '/json.lua')
  package.loaded['.json']          = package.loaded['json']
  package.loaded['.common.errors'] = loadmod(C .. '/errors.lua')
  package.loaded['.common.utils']  = loadmod(C .. '/utils.lua')
  package.loaded['.common.eip55']  = loadmod(C .. '/eip55.lua')
  local native = loadmod(RT .. '/native.lua')
  native.install()
  native.register(loadmod(CT .. '/native/operator-registry.lua'))
  native.reset()               -- state lives in globals; clear it per test
  return native
end

describe('native operator-registry — full WASM-harness parity (Lua 5.3)', function()
  local native
  local json = nil

  -- WASM setup.ts fixtures
  local OWNER  = '0x' .. string.rep('1', 40)
  -- Real mixed-case EIP-55 addresses (well-known anvil/hardhat accounts). Mixed case is the
  -- point: stored verbatim, so an accidental string.upper/lower anywhere would surface as a
  -- mismatch. See the EIP-55 note in src/contracts/native/operator-registry.lua.
  local ALICE  = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
  local BOB    = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC'
  local CHARLS = '0x90F79bf6EB2c4f870365E785982E1f101E93b906'
  local FP_A, FP_B, FP_C = string.rep('A', 40), string.rep('B', 40), string.rep('C', 40)
  local FP_D, FP_E, FP_F = string.rep('D', 40), string.rep('E', 40), string.rep('F', 40)

  local function commit(committer)
    return { c1 = { ['commitment-device'] = 'ans104@1.0', committer = committer } }
  end
  --- assign(action, committer, data, tags?, extra?) → device request `{ body = ... }`.
  local function assign(action, committer, data, tags, extra)
    local taglist = { { name = 'Action', value = action } }
    if tags then for k, v in pairs(tags) do taglist[#taglist + 1] = { name = k, value = v } end end
    local body = {
      action = action, tags = taglist, data = data,
      commitments = committer and commit(committer) or nil,
    }
    if extra then for k, v in pairs(extra) do body[k] = v end end
    return { body = body }
  end
  -- Each call starts a FRESH contract: native.reset() clears the state root + ACL globals.
  -- Under globals there is one VM per process, so `base = newBase()` mid-test means
  -- "start over", which is exactly how these tests already used it.
  local function newBase()
    native.reset()
    return { process = { id = 'PID', commitments = commit(OWNER) } }
  end
  -- A base pre-seeded with a full state — reads go straight to the root global, no compute.
  local function seededBase(o)
    o = o or {}
    local b = newBase()
    -- Through the runtime setters, NOT `OperatorRegistry = ...`: busted runs this file under an
    -- _ENV that proxies _G, so a spec-side global write never reaches native.lua. Reads fall
    -- through fine, which is why the assertions below can still name the global directly.
    native.setStateRoot({
      claimable = o.claimable or {}, verified = o.verified or {}, blocked = o.blocked or {},
      verifiedHardware = o.verifiedHardware or {}, registrationCredits = o.registrationCredits or {},
      registrationCreditsRequired = o.registrationCreditsRequired or false,
    })
    native.setACL({ roles = {} })
    return b
  end
  local function outData(base) return base.results and base.results.output and base.results.output.data or '' end
  local function has(s, sub) return type(s) == 'string' and s:find(sub, 1, true) ~= nil end
  local function view(base, name, params) return native.view(base, name, params) end

  -- action helpers (mirror the WASM setup* helpers)
  local function certs(list) return json.encode(list) end
  local function submitCerts(base, from, list) return compute(base, assign('Admin-Submit-Operator-Certificates', from, certs(list))) end
  local function addOperatorCert(base, address, fingerprint) return submitCerts(base, OWNER, { { f = fingerprint, a = address } }) end
  local function addRC(base, address, fingerprint) return compute(base, assign('Add-Registration-Credit', OWNER, nil, { Address = address, Fingerprint = fingerprint })) end
  local function claim(base, operator, fingerprint) return compute(base, assign('Submit-Fingerprint-Certificate', operator, nil, { ['Fingerprint-Certificate'] = fingerprint })) end
  local function grantRole(base, addr, roles) return compute(base, assign('Update-Roles', OWNER, json.encode({ Grant = { [addr] = roles } }))) end
  local function setupClaimed(base, operator, fingerprint)
    addOperatorCert(base, operator, fingerprint)
    claim(base, operator, fingerprint)
  end

  before_each(function() native = freshEnv(); json = require('json') end)

  -- =========================================================================
  describe('Submitting Operator Certificates', function()
    local ALL = {
      { f = FP_A, a = ALICE }, { f = FP_B, a = BOB }, { f = FP_C, a = CHARLS },
      { f = FP_D, a = ALICE }, { f = FP_E, a = BOB }, { f = FP_F, a = CHARLS },
    }
    local EXPECTED = { [FP_A] = ALICE, [FP_B] = BOB, [FP_C] = CHARLS, [FP_D] = ALICE, [FP_E] = BOB, [FP_F] = CHARLS }

    it('Accepts Operator Certificates from Owner', function()
      local base = newBase()
      submitCerts(base, OWNER, ALL)
      assert.are.same(EXPECTED, OperatorRegistry.claimable)
      assert.are.same({}, OperatorRegistry.verifiedHardware)
      assert.are.equal('OK', outData(base))
    end)

    it('Lists Operator Certificates submitted by Owner', function()
      local base = newBase()
      submitCerts(base, OWNER, ALL)
      assert.are.same(EXPECTED, OperatorRegistry.claimable)
    end)

    it('Allows VerifiedHardware flag when submitting Op Certs', function()
      local base = newBase()
      submitCerts(base, OWNER, {
        { f = FP_A, a = ALICE, hw = true }, { f = FP_B, a = BOB },
        { f = FP_C, a = CHARLS, hw = true }, { f = FP_D, a = ALICE },
        { f = FP_E, a = BOB, hw = true }, { f = FP_F, a = CHARLS },
      })
      assert.are.same(EXPECTED, OperatorRegistry.claimable)
      assert.are.same({ [FP_A] = true, [FP_C] = true, [FP_E] = true }, OperatorRegistry.verifiedHardware)
      assert.are.equal('OK', outData(base))
    end)

    it('Validates Operator Certificates from Owner', function()
      local base = newBase()
      compute(base, assign('Admin-Submit-Operator-Certificates', OWNER, nil))
      assert.is_true(has(outData(base), 'Operator Certificates required'))

      base = newBase()
      submitCerts(base, OWNER, { { f = FP_A, a = ALICE }, { f = 'invalid-fingerprint' } })
      assert.is_true(has(outData(base), 'Invalid Fingerprint'))
      assert.is_nil(OperatorRegistry.claimable[FP_A])           -- atomic revert of the good item

      base = newBase()
      submitCerts(base, OWNER, { { f = FP_A, a = ALICE }, { f = FP_B, a = 'invalid-address' } })
      assert.is_true(has(outData(base), 'Invalid Address'))
      assert.is_nil(OperatorRegistry.claimable[FP_A])
    end)

    it('Rejects Operator Certificates from non-Owner', function()
      local base = newBase()
      compute(base, assign('Admin-Submit-Operator-Certificates', ALICE, 'mock-certs-data'))
      assert.is_true(has(outData(base), 'Permission Denied'))
    end)
  end)

  -- =========================================================================
  describe('Fingerprint Certificates', function()
    it('Accepts Fingerprint Certs', function()
      local base = newBase()
      addOperatorCert(base, ALICE, FP_A)
      addRC(base, ALICE, FP_A)
      claim(base, ALICE, FP_A)
      assert.are.equal(ALICE, OperatorRegistry.verified[FP_A])
      assert.is_nil(OperatorRegistry.claimable[FP_A])
      assert.are.equal('OK', outData(base))
    end)

    it('Rejects Fingerprint Certs of unknown Fingerprints', function()
      local base = newBase()
      compute(base, assign('Submit-Fingerprint-Certificate', ALICE, nil,
        { ['Fingerprint-Certificate'] = string.rep('a', 40) }))   -- lower-case ⇒ invalid format
      assert.is_true(has(outData(base), 'Invalid certificate'))

      base = newBase()                                             -- valid format, not claimable
      compute(base, assign('Submit-Fingerprint-Certificate', ALICE, nil, { ['Fingerprint-Certificate'] = FP_A }))
      assert.is_true(has(outData(base), 'Invalid certificate'))
    end)

    it('Lists Fingerprint & Operator Address Mappings', function()
      local base = newBase()
      setupClaimed(base, ALICE, FP_A)
      assert.are.same({ [FP_A] = ALICE }, OperatorRegistry.verified)
    end)
  end)

  -- =========================================================================
  describe('Operator Renouncing Fingerprint Certificates', function()
    it('Allows Operators to renounce Fingerprint Certificates', function()
      local base = newBase()
      setupClaimed(base, ALICE, FP_A)
      compute(base, assign('Renounce-Fingerprint-Certificate', ALICE, nil, { Fingerprint = FP_A }))
      assert.is_nil(OperatorRegistry.verified[FP_A])
      assert.are.equal('OK', outData(base))
      assert.are.same({}, OperatorRegistry.verified)
    end)

    it('Rejects renounces missing a Fingerprint', function()
      local base = newBase()
      compute(base, assign('Renounce-Fingerprint-Certificate', ALICE, nil))
      assert.is_true(has(outData(base), 'Fingerprint required'))
    end)

    it('Rejects renounces from non-Operators', function()
      local base = newBase()
      setupClaimed(base, ALICE, FP_A)
      compute(base, assign('Renounce-Fingerprint-Certificate', BOB, nil, { Fingerprint = FP_A }))
      assert.is_true(has(outData(base), 'Only the Relay Operator can renounce'))
      assert.are.equal(ALICE, OperatorRegistry.verified[FP_A])
    end)

    it('Rejects renounces of unknown Fingerprints', function()
      local base = newBase()
      compute(base, assign('Renounce-Fingerprint-Certificate', ALICE, nil, { Fingerprint = FP_A }))
      assert.is_true(has(outData(base), 'Only the Relay Operator can renounce'))
    end)
  end)

  -- =========================================================================
  describe('Removing Fingerprint Certificates', function()
    it('Allows Owner to remove Fingerprint Certificates', function()
      local base = newBase()
      setupClaimed(base, ALICE, FP_A)
      compute(base, assign('Remove-Fingerprint-Certificate', OWNER, nil, { Fingerprint = FP_A }))
      assert.is_nil(OperatorRegistry.verified[FP_A])
      assert.are.equal('OK', outData(base))
      assert.are.same({}, OperatorRegistry.verified)
    end)

    it('Rejects removing when missing a Fingerprint', function()
      local base = newBase()
      setupClaimed(base, ALICE, FP_A)
      compute(base, assign('Remove-Fingerprint-Certificate', OWNER, nil))
      assert.is_true(has(outData(base), 'Fingerprint required'))
    end)

    it('Rejects removing from non-Owner', function()
      local base = newBase()
      setupClaimed(base, ALICE, FP_A)
      compute(base, assign('Remove-Fingerprint-Certificate', BOB, nil, { Fingerprint = FP_A }))
      assert.is_true(has(outData(base), 'Permission Denied'))
      assert.are.equal(ALICE, OperatorRegistry.verified[FP_A])
    end)
  end)

  -- =========================================================================
  describe('Blocking Operator Addresses', function()
    it('Allows Owner to block addresses', function()
      local base = newBase()
      compute(base, assign('Block-Operator-Address', OWNER, nil, { Address = ALICE }))
      assert.is_true(OperatorRegistry.blocked[ALICE])
      assert.are.equal('OK', outData(base))
    end)

    it('Rejects blocking when missing addresses', function()
      local base = newBase()
      compute(base, assign('Block-Operator-Address', OWNER, nil))
      assert.is_true(has(outData(base), 'Address is required'))
    end)

    it('Rejects blocking when invalid addresses', function()
      local base = newBase()
      compute(base, assign('Block-Operator-Address', OWNER, nil, { Address = 'invalid-address' }))
      assert.is_true(has(outData(base), 'Invalid Address'))
    end)

    it('Rejects blocking addresses from non-Owner', function()
      local base = newBase()
      compute(base, assign('Block-Operator-Address', BOB, nil, { Address = ALICE }))
      assert.is_true(has(outData(base), 'Permission Denied'))
    end)

    it('Prevents blocked addresses from submitting Fingerprint Certificates', function()
      local base = newBase()
      compute(base, assign('Block-Operator-Address', OWNER, nil, { Address = ALICE }))
      compute(base, assign('Submit-Fingerprint-Certificate', ALICE, nil, { ['Fingerprint-Certificate'] = FP_A }))
      assert.is_true(has(outData(base), 'Address is blocked'))
    end)

    it('Lists Blocked Addresses', function()
      local base = newBase()
      for _, a in ipairs({ ALICE, BOB, CHARLS }) do
        compute(base, assign('Block-Operator-Address', OWNER, nil, { Address = a }))
      end
      assert.are.same({ [ALICE] = true, [BOB] = true, [CHARLS] = true }, OperatorRegistry.blocked)
    end)

    it('Allows Owner to unblock addresses', function()
      local base = newBase()
      compute(base, assign('Block-Operator-Address', OWNER, nil, { Address = ALICE }))
      compute(base, assign('Unblock-Operator-Address', OWNER, nil, { Address = ALICE }))
      assert.is_nil(OperatorRegistry.blocked[ALICE])
      assert.are.equal('OK', outData(base))
      assert.are.same({}, OperatorRegistry.blocked)
    end)

    it('Rejects unblocking when missing addresses', function()
      local base = newBase()
      compute(base, assign('Unblock-Operator-Address', OWNER, nil))
      assert.is_true(has(outData(base), 'Address is required'))
    end)

    it('Rejects unblocking when invalid addresses', function()
      local base = newBase()
      compute(base, assign('Unblock-Operator-Address', OWNER, nil, { Address = 'invalid-address' }))
      assert.is_true(has(outData(base), 'Invalid Address'))
    end)

    it('Rejects unblocking when address is not blocked', function()
      local base = newBase()
      compute(base, assign('Unblock-Operator-Address', OWNER, nil, { Address = ALICE }))
      assert.is_true(has(outData(base), 'Address is not blocked'))
    end)

    it('Rejects unblocking addresses from non-Owner', function()
      local base = newBase()
      compute(base, assign('Unblock-Operator-Address', ALICE, nil, { Address = ALICE }))
      assert.is_true(has(outData(base), 'Permission Denied'))
    end)

    it('Allows unblocked Addresses to submit Fingerprint Certificates again', function()
      local base = newBase()
      addOperatorCert(base, ALICE, FP_A)
      addRC(base, ALICE, FP_A)
      compute(base, assign('Block-Operator-Address', OWNER, nil, { Address = ALICE }))
      compute(base, assign('Unblock-Operator-Address', OWNER, nil, { Address = ALICE }))
      claim(base, ALICE, FP_A)
      assert.are.equal(ALICE, OperatorRegistry.verified[FP_A])
      assert.is_nil(OperatorRegistry.claimable[FP_A])
      assert.are.equal('OK', outData(base))
    end)
  end)

  -- =========================================================================
  describe('Registration Credits', function()
    describe('Adding', function()
      it('Allows Owner to add RC', function()
        local base = newBase()
        addRC(base, ALICE, FP_A)
        assert.are.same({ [FP_A] = ALICE }, OperatorRegistry.registrationCredits)
        assert.are.equal('OK', outData(base))
      end)

      it('Rejects adding RC when missing Address', function()
        local base = newBase()
        compute(base, assign('Add-Registration-Credit', OWNER, nil, { Fingerprint = FP_A }))
        assert.is_true(has(outData(base), 'Address is required'))
      end)

      it('Rejects adding RC when invalid Address', function()
        local base = newBase()
        compute(base, assign('Add-Registration-Credit', OWNER, nil, { Address = 'invalid-address', Fingerprint = FP_A }))
        assert.is_true(has(outData(base), 'Invalid Address'))
      end)

      it('Rejects adding RC when missing Fingerprint', function()
        local base = newBase()
        compute(base, assign('Add-Registration-Credit', OWNER, nil, { Address = ALICE }))
        assert.is_true(has(outData(base), 'Fingerprint required'))
      end)

      it('Rejects adding RC when invalid Fingerprint', function()
        local base = newBase()
        compute(base, assign('Add-Registration-Credit', OWNER, nil, { Address = ALICE, Fingerprint = 'invalid-fingerprint' }))
        assert.is_true(has(outData(base), 'Invalid Fingerprint'))
      end)

      it('Rejects adding duplicate RC', function()
        local base = newBase()
        addRC(base, ALICE, FP_A)
        addRC(base, ALICE, FP_A)
        assert.is_true(has(outData(base), 'Registration Credit already added'))
      end)

      it('Rejects adding RC from non-Owner', function()
        local base = newBase()
        compute(base, assign('Add-Registration-Credit', ALICE, nil, { Address = ALICE, Fingerprint = FP_A }))
        assert.is_true(has(outData(base), 'Permission Denied'))
      end)

      it('Does not require RC when mechanism is disabled', function()
        local base = newBase()
        addOperatorCert(base, ALICE, FP_A)
        claim(base, ALICE, FP_A)                    -- no RC added; registrationCreditsRequired defaults false
        assert.are.equal(ALICE, OperatorRegistry.verified[FP_A])
        assert.are.equal('OK', outData(base))
      end)
    end)

    describe('Listing', function()
      it('Lists Registration Credits', function()
        local base = newBase()
        local credits = { [FP_A] = ALICE, [FP_B] = BOB, [FP_C] = CHARLS, [FP_D] = ALICE }
        for fp, addr in pairs(credits) do addRC(base, addr, fp) end
        assert.are.same(credits, OperatorRegistry.registrationCredits)
      end)
    end)

    describe('Removing', function()
      it('Allows Owner to remove RC', function()
        local base = newBase()
        for fp, addr in pairs({ [FP_A] = ALICE, [FP_B] = BOB, [FP_C] = CHARLS, [FP_D] = ALICE }) do addRC(base, addr, fp) end
        compute(base, assign('Remove-Registration-Credit', OWNER, nil, { Address = ALICE, Fingerprint = FP_D }))
        assert.are.same({ [FP_A] = ALICE, [FP_B] = BOB, [FP_C] = CHARLS }, OperatorRegistry.registrationCredits)
        assert.are.equal('OK', outData(base))
      end)

      it('Rejects removing RC when missing Address', function()
        local base = newBase()
        compute(base, assign('Remove-Registration-Credit', OWNER, nil, { Fingerprint = FP_D }))
        assert.is_true(has(outData(base), 'Address is required'))
      end)

      it('Rejects removing RC when invalid Address', function()
        local base = newBase()
        compute(base, assign('Remove-Registration-Credit', OWNER, nil, { Address = 'invalid-address', Fingerprint = FP_D }))
        assert.is_true(has(outData(base), 'Invalid Address'))
      end)

      it('Rejects removing RC when missing Fingerprint', function()
        local base = newBase()
        compute(base, assign('Remove-Registration-Credit', OWNER, nil, { Address = ALICE }))
        assert.is_true(has(outData(base), 'Fingerprint required'))
      end)

      it('Rejects removing RC when invalid Fingerprint', function()
        local base = newBase()
        compute(base, assign('Remove-Registration-Credit', OWNER, nil, { Address = ALICE, Fingerprint = 'invalid-fingerprint' }))
        assert.is_true(has(outData(base), 'Invalid Fingerprint'))
      end)

      it('Rejects removing non-existant RC', function()
        local base = newBase()
        compute(base, assign('Remove-Registration-Credit', OWNER, nil, { Address = ALICE, Fingerprint = FP_D }))
        assert.is_true(has(outData(base), 'Registration Credit does not exist'))
      end)

      it('Rejects removing RC from non-Owner', function()
        local base = newBase()
        compute(base, assign('Remove-Registration-Credit', ALICE, nil, { Address = ALICE, Fingerprint = FP_D }))
        assert.is_true(has(outData(base), 'Permission Denied'))
      end)
    end)
  end)

  -- =========================================================================
  describe('Verified Hardware', function()
    describe('Adding', function()
      it('Allows Owner to add VH Fingerprints', function()
        local base = newBase()
        compute(base, assign('Add-Verified-Hardware', OWNER, table.concat({ FP_A, FP_B, FP_C, FP_D }, ',')))
        assert.are.same({ [FP_A] = true, [FP_B] = true, [FP_C] = true, [FP_D] = true }, OperatorRegistry.verifiedHardware)
        assert.are.equal('OK', outData(base))
      end)

      it('Rejects adding VH when missing fingerprints', function()
        local base = newBase()
        compute(base, assign('Add-Verified-Hardware', OWNER, nil))
        assert.is_true(has(outData(base), 'Fingerprints required'))
      end)

      it('Rejects adding VH when invalid fingerprints', function()
        local base = newBase()
        compute(base, assign('Add-Verified-Hardware', OWNER, FP_A .. ',invalid-fingerprint'))
        assert.is_true(has(outData(base), 'Invalid Fingerprint'))
        assert.is_nil(OperatorRegistry.verifiedHardware[FP_A])    -- atomic revert
      end)

      it('Rejects adding duplicate VH fingerprints', function()
        local base = newBase()
        compute(base, assign('Add-Verified-Hardware', OWNER, table.concat({ FP_A, FP_B, FP_C }, ',')))
        compute(base, assign('Add-Verified-Hardware', OWNER, FP_D .. ',' .. FP_C))
        assert.is_true(has(outData(base), 'Duplicate Fingerprint'))
        assert.is_nil(OperatorRegistry.verifiedHardware[FP_D])    -- atomic revert
      end)

      it('Rejects adding VH from non-Owner', function()
        local base = newBase()
        compute(base, assign('Add-Verified-Hardware', ALICE, FP_A))
        assert.is_true(has(outData(base), 'Permission Denied'))
      end)

      it('Does not require Registration Credits for VH', function()
        local base = newBase()
        addOperatorCert(base, ALICE, FP_A)
        compute(base, assign('Add-Verified-Hardware', OWNER, FP_A))
        claim(base, ALICE, FP_A)
        assert.are.equal(ALICE, OperatorRegistry.verified[FP_A])
        assert.is_nil(OperatorRegistry.claimable[FP_A])
        assert.are.equal('OK', outData(base))
      end)
    end)

    describe('Listing', function()
      it('Lists VH Fingerprints', function()
        local base = newBase()
        compute(base, assign('Add-Verified-Hardware', OWNER, table.concat({ FP_A, FP_B, FP_C, FP_D }, ',')))
        assert.are.same({ [FP_A] = true, [FP_B] = true, [FP_C] = true, [FP_D] = true }, OperatorRegistry.verifiedHardware)
      end)
    end)

    describe('Removing', function()
      it('Allows Owner to remove VH Fingerprints', function()
        local base = newBase()
        compute(base, assign('Add-Verified-Hardware', OWNER, table.concat({ FP_A, FP_B, FP_C, FP_D }, ',')))
        compute(base, assign('Remove-Verified-Hardware', OWNER, FP_B .. ',' .. FP_C))
        assert.are.same({ [FP_A] = true, [FP_D] = true }, OperatorRegistry.verifiedHardware)
        assert.are.equal('OK', outData(base))
      end)

      it('Rejects removing VH when missing Fingerprints', function()
        local base = newBase()
        compute(base, assign('Remove-Verified-Hardware', OWNER, nil))
        assert.is_true(has(outData(base), 'Fingerprints required'))
      end)

      it('Rejects removing VH when not added', function()
        local base = newBase()
        compute(base, assign('Remove-Verified-Hardware', OWNER, FP_B .. ',' .. FP_C))
        assert.is_true(has(outData(base), 'Unknown Fingerprint'))
      end)

      it('Rejects non-Owner removing VH', function()
        local base = newBase()
        compute(base, assign('Remove-Verified-Hardware', ALICE, FP_B .. ',' .. FP_C))
        assert.is_true(has(outData(base), 'Permission Denied'))
      end)
    end)
  end)

  -- =========================================================================
  describe('Status view (replaces Info counts)', function()
    it('reports counts equivalent to the legacynet Info reply', function()
      local base = newBase()
      for _, r in ipairs({ { ALICE, FP_A }, { BOB, FP_B }, { CHARLS, FP_C } }) do
        addOperatorCert(base, r[1], r[2]); addRC(base, r[1], r[2]); claim(base, r[1], r[2])
      end
      for _, r in ipairs({ { ALICE, FP_D }, { BOB, FP_E }, { CHARLS, FP_F } }) do
        addOperatorCert(base, r[1], r[2])
      end
      compute(base, assign('Add-Verified-Hardware', OWNER, FP_B .. ',' .. FP_E))
      local st = view(base, 'status')
      assert.are.equal(3, st.counts.verified)                       -- Info.claimed
      assert.are.equal(2, st.counts.hardware)                       -- Info.hardware
      assert.are.equal(6, st.counts.claimable + st.counts.verified) -- Info.total
    end)
  end)

  -- =========================================================================
  describe('Dump (full state)', function()
    it('Provides reply to View-State messages', function()
      local base = newBase()
      for _, r in ipairs({ { ALICE, FP_A }, { BOB, FP_B }, { CHARLS, FP_C } }) do
        addOperatorCert(base, r[1], r[2]); addRC(base, r[1], r[2]); claim(base, r[1], r[2])
      end
      for _, r in ipairs({ { ALICE, FP_D }, { BOB, FP_E }, { CHARLS, FP_F } }) do
        addOperatorCert(base, r[1], r[2])
      end
      compute(base, assign('Add-Verified-Hardware', OWNER, FP_B .. ',' .. FP_E))

      local s = view(base, 'dump')
      assert.are.same({ [FP_D] = ALICE, [FP_E] = BOB, [FP_F] = CHARLS }, s.claimable)
      assert.are.same({ [FP_A] = ALICE, [FP_B] = BOB, [FP_C] = CHARLS }, s.verified)
      assert.are.same({}, s.blocked)
      assert.are.same({ [FP_A] = ALICE, [FP_B] = BOB, [FP_C] = CHARLS }, s.registrationCredits)
      assert.are.same({ [FP_B] = true, [FP_E] = true }, s.verifiedHardware)
    end)
  end)

  -- (No `Init` action: migration state is seeded as the module's initial `state` at
  -- spawn and validated in deploy tooling — nothing to test at runtime. See D26.)

  -- =========================================================================
  describe('ACL - Enforcing Roles', function()
    local base
    before_each(function()
      base = newBase()
      grantRole(base, ALICE, { 'admin' })     -- ALICE is admin for each test below
    end)

    it('Submit Operator Certificates — Allows Admin Role', function()
      submitCerts(base, ALICE, { { f = FP_A, a = ALICE }, { f = FP_B, a = BOB } })
      assert.are.same({ [FP_A] = ALICE, [FP_B] = BOB }, OperatorRegistry.claimable)
      assert.are.equal('OK', outData(base))
    end)

    it('Submit Operator Certificates — Allows Admin-Submit-Operator-Certificates Role', function()
      grantRole(base, BOB, { 'Admin-Submit-Operator-Certificates' })
      submitCerts(base, BOB, { { f = FP_A, a = ALICE } })
      assert.are.same({ [FP_A] = ALICE }, OperatorRegistry.claimable)
      assert.are.equal('OK', outData(base))
    end)

    it('Removing Fingerprint Certificates — Allows Admin Role', function()
      setupClaimed(base, ALICE, FP_A)
      compute(base, assign('Remove-Fingerprint-Certificate', ALICE, nil, { Fingerprint = FP_A }))
      assert.is_nil(OperatorRegistry.verified[FP_A])
      assert.are.equal('OK', outData(base))
    end)

    it('Removing Fingerprint Certificates — Allows Remove-Fingerprint-Certificate Role', function()
      setupClaimed(base, ALICE, FP_A)
      grantRole(base, BOB, { 'Remove-Fingerprint-Certificate' })
      compute(base, assign('Remove-Fingerprint-Certificate', BOB, nil, { Fingerprint = FP_A }))
      assert.is_nil(OperatorRegistry.verified[FP_A])
      assert.are.equal('OK', outData(base))
    end)

    it('Blocking Operator Addresses — Allows Admin Role', function()
      compute(base, assign('Block-Operator-Address', ALICE, nil, { Address = CHARLS }))
      assert.is_true(OperatorRegistry.blocked[CHARLS])
      assert.are.equal('OK', outData(base))
    end)

    it('Blocking Operator Addresses — Allows Block-Operator-Address Role', function()
      grantRole(base, BOB, { 'Block-Operator-Address' })
      compute(base, assign('Block-Operator-Address', BOB, nil, { Address = CHARLS }))
      assert.is_true(OperatorRegistry.blocked[CHARLS])
      assert.are.equal('OK', outData(base))
    end)

    it('Registration Credits — Allows Admin Role', function()
      compute(base, assign('Add-Registration-Credit', ALICE, nil, { Address = CHARLS, Fingerprint = FP_A }))
      assert.are.same({ [FP_A] = CHARLS }, OperatorRegistry.registrationCredits)
      assert.are.equal('OK', outData(base))
    end)

    it('Registration Credits — Allows Add-Registration-Credit Role', function()
      grantRole(base, BOB, { 'Add-Registration-Credit' })
      compute(base, assign('Add-Registration-Credit', BOB, nil, { Address = CHARLS, Fingerprint = FP_A }))
      assert.are.same({ [FP_A] = CHARLS }, OperatorRegistry.registrationCredits)
      assert.are.equal('OK', outData(base))
    end)

    it('Verified Hardware — Allows Admin Role', function()
      compute(base, assign('Add-Verified-Hardware', ALICE, table.concat({ FP_A, FP_B, FP_C, FP_D }, ',')))
      assert.are.same({ [FP_A] = true, [FP_B] = true, [FP_C] = true, [FP_D] = true }, OperatorRegistry.verifiedHardware)
      assert.are.equal('OK', outData(base))
    end)

    it('Verified Hardware — Allows Add-Verified-Hardware Role', function()
      grantRole(base, BOB, { 'Add-Verified-Hardware' })
      compute(base, assign('Add-Verified-Hardware', BOB, table.concat({ FP_A, FP_B }, ',')))
      assert.are.same({ [FP_A] = true, [FP_B] = true }, OperatorRegistry.verifiedHardware)
      assert.are.equal('OK', outData(base))
    end)
  end)

  -- =========================================================================
  -- EIP-55 on-chain: every untrusted address ingress is canonicalized + checksum-validated.
  describe('EIP-55 address ingress (on-chain keccak)', function()
    local ALICE_LOWER  = string.lower(ALICE)
    local ALICE_UPPER  = '0x' .. string.upper(string.sub(ALICE, 3))
    -- ALICE with one checksummed letter's case flipped → mixed-case, non-canonical → must reject.
    local ALICE_BADSUM = '0x70997970c51812dc3A010C7d01b50e0d17dc79C8'

    it('canonicalizes a lowercase admin address to EIP-55 in state', function()
      local base = newBase()
      submitCerts(base, OWNER, { { f = FP_A, a = ALICE_LOWER } })
      assert.are.equal('OK', outData(base))
      assert.are.same({ [FP_A] = ALICE }, OperatorRegistry.claimable)
    end)

    it('canonicalizes an ALLCAPS admin address to EIP-55 in state', function()
      local base = newBase()
      submitCerts(base, OWNER, { { f = FP_A, a = ALICE_UPPER } })
      assert.are.same({ [FP_A] = ALICE }, OperatorRegistry.claimable)
    end)

    it('rejects a mixed-case bad checksum and reverts', function()
      local base = newBase()
      submitCerts(base, OWNER, { { f = FP_A, a = ALICE_BADSUM } })
      assert.is_true(has(outData(base), 'checksum'))
      assert.are.same({}, OperatorRegistry.claimable)
    end)

    it('Block/Unblock canonicalize the address key', function()
      local base = newBase()
      compute(base, assign('Block-Operator-Address', OWNER, nil, { Address = ALICE_LOWER }))
      assert.are.same({ [ALICE] = true }, OperatorRegistry.blocked)
      compute(base, assign('Unblock-Operator-Address', OWNER, nil, { Address = ALICE_UPPER }))
      assert.are.same({}, OperatorRegistry.blocked)
    end)
  end)

  -- =========================================================================
  -- Consumption + visibility views (D26 read surface). Asserted against state so a view
  -- can never drift from the underlying data.
  describe('Views (consumption + visibility)', function()
    it('operator(address) returns one operator\'s whole footprint (query canonicalized)', function()
      local base = newBase()
      submitCerts(base, OWNER, { { f = FP_A, a = ALICE, hw = true }, { f = FP_D, a = ALICE } })
      claim(base, ALICE, FP_A)
      local op = view(base, 'operator', { address = ALICE })
      assert.are.equal(ALICE, op.address)
      assert.is_false(op.blocked)
      assert.are.same({ [FP_A] = true }, op.verified)
      assert.are.same({ [FP_D] = true }, op.claimable)
      assert.are.same({ [FP_A] = true }, op.hardware)
      -- Any-case query canonicalizes to EIP-55 on-chain, so a lowercase address resolves the same.
      local op2 = view(base, 'operator', { address = string.lower(ALICE) })
      assert.are.equal(ALICE, op2.address)
      assert.are.same(op.verified, op2.verified)
    end)

    it('operators() returns unique verified addresses minus blocked', function()
      local base = seededBase({ verified = { [FP_A] = ALICE, [FP_B] = BOB, [FP_C] = ALICE },
                                blocked = { [BOB] = true } })
      assert.are.same({ [ALICE] = true }, view(base, 'operators'))
    end)

    it('scoring() returns exactly the verified + hardware maps', function()
      local base = seededBase({ verified = { [FP_A] = ALICE, [FP_B] = BOB },
                                verifiedHardware = { [FP_A] = true } })
      local sc = view(base, 'scoring')
      assert.are.same({ [FP_A] = ALICE, [FP_B] = BOB }, sc.verified)
      assert.are.same({ [FP_A] = true }, sc.hardware)
    end)

    it('fingerprints(csv) batch-looks-up records in one read', function()
      local base = newBase()
      addOperatorCert(base, ALICE, FP_A); claim(base, ALICE, FP_A)   -- FP_A verified
      addOperatorCert(base, BOB, FP_B)                               -- FP_B claimable only
      local fps = view(base, 'fingerprints', { ids = FP_A .. ',' .. FP_B .. ',' .. FP_C })
      assert.are.equal(ALICE, fps[FP_A].verified)
      assert.is_nil(fps[FP_A].claimable)
      assert.are.equal(BOB, fps[FP_B].claimable)
      assert.is_nil(fps[FP_B].verified)
      assert.is_nil(fps[FP_C].verified)             -- unknown fingerprint
    end)

    it('roles() reflects the runtime-owned ACL', function()
      local base = newBase()
      grantRole(base, ALICE, { 'admin' })
      assert.is_true(view(base, 'roles').admin[ALICE] == true)
    end)

    it('version() reports runtime + contract identity', function()
      local base = newBase()
      local v = view(base, 'version')
      assert.are.equal('operator-registry', v.contract)
      assert.is_string(v.runtime)
    end)

    it('status() is enriched by the runtime with owner/version/name (liveness probe)', function()
      local base = newBase()
      addOperatorCert(base, ALICE, FP_A)
      local st = view(base, 'status')
      assert.are.equal('operator-registry', st.name)
      assert.are.equal(OWNER, st.owner)
      assert.is_string(st.version)
      assert.are.equal(1, st.counts.claimable)
    end)
  end)

  -- =========================================================================
  -- STATE IS NOT ON THE MESSAGE (D31/D32). This block replaces the old "read-path metadata
  -- contamination" suite, which pinned `native.stripMeta` against A16/A18. Both bugs were
  -- `dev_lua:decode` corrupting state as it passed through the process message; state now
  -- lives in the `OperatorRegistry` global and never enters the message, so the mechanism
  -- has nothing to act on and stripMeta is gone.
  --
  -- What is worth pinning instead is the INVARIANT that makes that true: compute must leave
  -- no state-shaped key on `base`. Reintroducing one silently brings A16 back (keys added to
  -- a string map after slot 1 vanish, handler still returns OK), and Tier-1/2 cannot see that
  -- happen. This test fails the moment someone writes state to the message again.
  describe('State placement invariant (globals, not the message)', function()
    it('compute leaves no state or acl key on the process message', function()
      local base = newBase()
      addOperatorCert(base, ALICE, FP_A)
      assert.is_nil(base.state)
      assert.is_nil(base.acl)
      -- ...and the state really is at the declared root global.
      assert.are.equal(ALICE, OperatorRegistry.claimable[FP_A])
      assert.are.same({ roles = {} }, ACL)
    end)

    it('only results and the allowlist id ride on base', function()
      local base = newBase()
      addOperatorCert(base, ALICE, FP_A)
      -- `allowlistId`/`allowlistTable` are deliberate: the p4 write gate reads
      -- compute/allowlistId/~trie@1.0/<addr> without executing contract code, so it cannot
      -- see a Lua global. Everything else here is HyperBEAM's own envelope.
      local allowed = { process = true, results = true, allowlistId = true,
                        allowlistTable = true, allowlistSeeded = true }
      for k in pairs(base) do
        assert.is_true(allowed[k] == true, 'unexpected key on base: ' .. tostring(k))
      end
    end)

    it('state survives across computes in the global, not via base', function()
      local base = newBase()
      addOperatorCert(base, ALICE, FP_A)
      -- A DIFFERENT message table, as the device hands us on the next slot.
      local next_ = { process = base.process }
      addOperatorCert(next_, BOB, FP_B)
      assert.are.equal(ALICE, OperatorRegistry.claimable[FP_A])
      assert.are.equal(BOB, OperatorRegistry.claimable[FP_B])
    end)

    it('native.reset() clears the root so each case starts fresh', function()
      local base = newBase()
      addOperatorCert(base, ALICE, FP_A)
      assert.is_not_nil(OperatorRegistry)
      newBase()
      assert.is_nil(OperatorRegistry)
      assert.is_nil(ACL)
    end)
  end)

  -- =========================================================================
  -- View-name collision guard (register). A view whose name equals a reserved HB base key is
  -- SILENTLY shadowed on the read path (Tier-1/2 can't see it — no path resolution here), so
  -- the runtime rejects it at register() time. This turns a node-only footgun into a load-time
  -- failure that every tier + every contract spawn catches. See native.RESERVED / D26.
  describe('View-name collision guard (register)', function()
    local function reg(views, root)
      return { state = {}, root = root or 'TestRoot', views = views }
    end
    it('rejects a view name that shadows a reserved HB key (e.g. state)', function()
      assert.has_error(function()
        native.register(reg({ state = function(s) return s end }))
      end)
    end)
    it('rejects other reserved names (name/results/process/device)', function()
      for _, bad in ipairs({ 'name', 'results', 'process', 'device' }) do
        assert.has_error(function()
          native.register(reg({ [bad] = function(s) return s end }))
        end)
      end
    end)
    it('rejects a runtime-owned view name (roles/version/dump)', function()
      for _, bad in ipairs({ 'roles', 'version', 'dump' }) do
        assert.has_error(function()
          native.register(reg({ [bad] = function(s) return s end }))
        end)
      end
    end)
    it('accepts non-colliding view names (status/operator)', function()
      assert.has_no.errors(function()
        native.register(reg({ status = function(s) return s end,
                              operator = function(s) return s end }))
      end)
    end)
  end)

  -- =========================================================================
  -- State-root guard (register, D32). The root names a GLOBAL, and installViews writes view
  -- wrappers into the same namespace — so a bad root does not fail loudly at spawn, it
  -- quietly overwrites something. `compute` is the worst case: the device entrypoint would
  -- be replaced by a state table and the process would wedge on its first slot.
  describe('State-root guard (register)', function()
    it('requires a root that is a Lua identifier', function()
      for _, bad in ipairs({ 'operator-registry', '1Registry', 'has space', '' }) do
        assert.has_error(function()
          native.register({ state = {}, root = bad, views = {} })
        end)
      end
      assert.has_error(function() native.register({ state = {}, views = {} }) end)
    end)
    it('rejects a root that would clobber a runtime global', function()
      for _, bad in ipairs({ 'compute', 'ao', 'Owner', 'Send', 'ACL', 'native' }) do
        assert.has_error(function()
          native.register({ state = {}, root = bad, views = {} })
        end)
      end
    end)
    it('rejects a view named after the root (installViews would replace the state)', function()
      assert.has_error(function()
        native.register({ state = {}, root = 'MyRoot',
                          views = { MyRoot = function(s) return s end } })
      end)
    end)
    it('reports the root on the version view', function()
      assert.are.equal('OperatorRegistry', view(newBase(), 'version').root)
    end)
  end)

  -- =========================================================================
  -- The runtime owns `dump` (D31 §4 / D32 §1). Under globals, state has no HTTP path of its
  -- own — it is an opaque blob in `priv` — so extraction runs through contract Lua. If the
  -- export view were a contract concern, a deploy that broke it would leave state with no
  -- supported way out. Owning it here means it is present and correct whatever a contract
  -- declares, which is why register() now REJECTS a contract-declared `dump`.
  describe('Runtime-owned dump view', function()
    it('returns the whole state root without the contract declaring it', function()
      local base = newBase()
      addOperatorCert(base, ALICE, FP_A)
      compute(base, assign('Add-Verified-Hardware', OWNER, FP_A))
      local s = view(base, 'dump')
      assert.are.same({ [FP_A] = ALICE }, s.claimable)
      assert.are.same({ [FP_A] = true }, s.verifiedHardware)
    end)
    -- HyperBEAM computes LAZILY, so a spawned process holds no state at all until something
    -- forces a slot — and `as/` does not drive slot 0 (only a message or a `now/` read does).
    -- Every view must survive that window: `status` is the liveness probe deploy tooling polls,
    -- so crashing there means it can never observe the process coming up. Views fall back to
    -- the contract's DECLARED shape, and `status.initialized` is what distinguishes
    -- "seeded and genuinely empty" from "has never computed" — the counts cannot.
    it('answers from the declared shape on an uninitialized process', function()
      local base = newBase()
      assert.is_nil(native.stateRoot())
      assert.are.same({}, view(base, 'dump').claimable)
      local st = view(base, 'status')
      assert.are.equal(0, st.counts.claimable)
      assert.is_false(st.initialized)
    end)

    it('reports initialized once a slot has run', function()
      local base = newBase()
      addOperatorCert(base, ALICE, FP_A)
      assert.is_true(view(base, 'status').initialized)
    end)

    it('every view survives an uninitialized process (no nil-index crash)', function()
      local base = newBase()
      for _, name in ipairs({ 'dump', 'roles', 'version', 'status', 'operators', 'scoring' }) do
        assert.has_no.errors(function() view(base, name) end)
      end
      assert.has_no.errors(function() view(base, 'operator', { address = ALICE }) end)
      assert.has_no.errors(function() view(base, 'fingerprints', { ids = FP_A }) end)
    end)
  end)

  -- =========================================================================
  -- Runtime safety (D8 axes) — NOT covered by the WASM harness; native-runtime specific.
  describe('Runtime safety (D8 axes)', function()
    it('rejects an unsigned message before dispatch (Axis 1)', function()
      local base = newBase()
      compute(base, assign('Admin-Submit-Operator-Certificates', nil, certs({ { f = FP_A, a = ALICE } })))
      assert.is_true(has(outData(base), 'unsigned'))
      assert.is_nil(OperatorRegistry.claimable[FP_A])
    end)

    it('rejects a forged from-process impersonating the Owner (A11 / Axis 2)', function()
      local base = newBase()
      compute(base, assign('Admin-Submit-Operator-Certificates', ALICE,
        certs({ { f = FP_A, a = ALICE } }), nil, { ['from-process'] = OWNER }))
      assert.is_true(has(outData(base), 'Permission Denied'))
      assert.is_nil(OperatorRegistry.claimable[FP_A])
    end)

    it('rejects an unknown action', function()
      local base = newBase()
      compute(base, assign('No-Such-Action', OWNER, ''))
      assert.is_true(has(outData(base), 'unknown action'))
    end)

    it('reverts all state on a mid-batch failure, across the whole managed tree (Axis 6)', function()
      local base = newBase()
      addOperatorCert(base, ALICE, FP_A)              -- committed
      submitCerts(base, OWNER, { { f = FP_B, a = BOB }, { f = 'BAD', a = CHARLS } })  -- fails mid-batch
      assert.is_true(has(outData(base), 'Invalid'))
      assert.are.equal(ALICE, OperatorRegistry.claimable[FP_A])  -- prior commit intact
      assert.is_nil(OperatorRegistry.claimable[FP_B])            -- failed batch fully reverted
    end)
  end)
end)
