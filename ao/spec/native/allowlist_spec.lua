--- Tier-1 busted spec — the runtime `allowlist` (write gate source of truth).
---
--- The allowlist is what the node-side p4 gate reads to decide whether a message may be
--- SCHEDULED AT ALL. Getting it wrong is not a cosmetic bug in either direction:
---   · too permissive -> the DoS hole the gate exists to close stays open
---   · too restrictive -> a legitimate operator is silently locked out of the contract, and the
---     failure appears at the node as an opaque 400 with nothing in contract state explaining it
---
--- The refcount is the part that bites. An address can be listed for several INDEPENDENT
--- reasons at once (an ACL role, an operator fingerprint, being the owner), so a boolean would
--- delist someone the moment any ONE reason went away. These tests pin that.
---
--- Persistence is deliberately NOT exercised here: `ao.resolve` does not exist in Tier-1 (the
--- harness clears the `ao` global), so the store falls back to an in-memory table. The refcount
--- ARITHMETIC — `native.allowlist.apply` — is shared by both stores and is what is under test.
--- The trie-backed store is Tier-3's job.

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

describe('runtime allowlist', function()
  local native, json
  local OWNER = '0x' .. string.rep('1', 40)
  local ALICE = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'
  local BOB   = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'

  local function commit(c)
    return { c1 = { ['commitment-device'] = 'ans104@1.0', committer = c } }
  end
  local function assign(action, committer, data, tags)
    local taglist = { { name = 'Action', value = action } }
    if tags then for k, v in pairs(tags) do taglist[#taglist + 1] = { name = k, value = v } end end
    return { body = {
      action = action, tags = taglist, data = data,
      commitments = committer and commit(committer) or nil,
    } }
  end
  -- native.reset() first: state lives in the `OperatorRegistry` global now, so without it
  -- each case would inherit the previous one's registry.
  local function newBase()
    native.reset()
    local b = { process = { id = 'PID', commitments = commit(OWNER) } }
    -- Setters, not direct assignment: busted's per-file _ENV proxies _G and swallows writes.
    native.setStateRoot({ claimable = {}, verified = {}, blocked = {},
                verifiedHardware = {}, registrationCredits = {},
                registrationCreditsRequired = false })
    native.setACL({ roles = {} })
    return b
  end
  --- What the gate would see for `addr`: the persisted count, or nil.
  local function listed(base, addr)
    return base.allowlistTable and base.allowlistTable[addr] or nil
  end
  local function roleUpdate(grant, revoke)
    return json.encode({ Grant = grant, Revoke = revoke })
  end

  before_each(function()
    native = freshEnv()
    json = require('json')
  end)

  -- --- the pure arithmetic ------------------------------------------------------------
  describe('apply (pure refcount)', function()
    it('adds an address that was not listed', function()
      assert.same({ [ALICE] = '1' }, native.allowlist.apply({}, { [ALICE] = 1 }))
    end)

    it('accumulates independent reasons', function()
      assert.same({ [ALICE] = '3' }, native.allowlist.apply({ [ALICE] = 1 }, { [ALICE] = 2 }))
    end)

    it('KEEPS an address that loses one of several reasons', function()
      -- The whole point of refcounting. A boolean list would drop ALICE here even though she
      -- still holds another reason to be allowed.
      assert.same({ [ALICE] = '1' }, native.allowlist.apply({ [ALICE] = 2 }, { [ALICE] = -1 }))
    end)

    it('deletes only when the last reason goes', function()
      assert.same({ [ALICE] = false }, native.allowlist.apply({ [ALICE] = 1 }, { [ALICE] = -1 }))
    end)

    it('clamps at zero rather than carrying a negative', function()
      -- A double-revoke is a contract bug. Carrying -1 would mean the NEXT grant leaves the
      -- address still unlisted, i.e. one silent lockout compounding into another.
      assert.same({ [ALICE] = false }, native.allowlist.apply({ [ALICE] = 1 }, { [ALICE] = -3 }))
      assert.same({ [ALICE] = false }, native.allowlist.apply({}, { [ALICE] = -1 }))
    end)

    it('ignores zero deltas so an untouched address is not rewritten', function()
      assert.same({}, native.allowlist.apply({ [ALICE] = 2 }, { [ALICE] = 0 }))
    end)

    -- Counts are emitted as integer-formatted STRINGS. Under luerl `tonumber('2')` is a float,
    -- so returning a raw number would persist '1.0'/'B2.0' — values the gate reads as allowed
    -- and that the delete path can never clear. Tier-2 caught that; this pins the shape.
    it('reads existing counts stored as strings (the trie stores strings)', function()
      assert.same({ [ALICE] = '3' }, native.allowlist.apply({ [ALICE] = '2' }, { [ALICE] = 1 }))
    end)

    it('handles many addresses in one batch', function()
      local out = native.allowlist.apply(
        { [ALICE] = 1, [BOB] = 1 }, { [ALICE] = 1, [BOB] = -1, [OWNER] = 1 })
      assert.same({ [ALICE] = '2', [BOB] = false, [OWNER] = '1' }, out)
    end)
  end)

  -- --- driven by ACL roles ------------------------------------------------------------
  describe('maintained from ACL roles', function()
    it('a granted role lists the address', function()
      local b = newBase()
      native.compute(b, assign('Update-Roles', OWNER, roleUpdate({ [ALICE] = { 'admin' } })))
      assert.equal('1', listed(b, ALICE))
    end)

    it('re-granting a role already held does NOT double-count', function()
      -- If it did, the matching single revoke would leave a phantom count and ALICE would stay
      -- allowed forever after losing the role.
      local b = newBase()
      native.compute(b, assign('Update-Roles', OWNER, roleUpdate({ [ALICE] = { 'admin' } })))
      native.compute(b, assign('Update-Roles', OWNER, roleUpdate({ [ALICE] = { 'admin' } })))
      assert.equal('1', listed(b, ALICE))
      native.compute(b, assign('Update-Roles', OWNER, nil, nil))
      native.compute(b, assign('Update-Roles', OWNER,
        roleUpdate(nil, { [ALICE] = { 'admin' } })))
      assert.is_nil(listed(b, ALICE))
    end)

    it('two distinct roles count twice, and losing one keeps the address listed', function()
      local b = newBase()
      native.compute(b, assign('Update-Roles', OWNER,
        roleUpdate({ [ALICE] = { 'admin', 'Add-Verified-Hardware' } })))
      assert.equal('2', listed(b, ALICE))
      native.compute(b, assign('Update-Roles', OWNER,
        roleUpdate(nil, { [ALICE] = { 'admin' } })))
      assert.equal('1', listed(b, ALICE))
    end)

    it('revoking a role the address never held does not decrement', function()
      local b = newBase()
      native.compute(b, assign('Update-Roles', OWNER, roleUpdate({ [ALICE] = { 'admin' } })))
      native.compute(b, assign('Update-Roles', OWNER,
        roleUpdate(nil, { [ALICE] = { 'Add-Verified-Hardware' } })))
      assert.equal('1', listed(b, ALICE))
    end)

    it('losing the last role delists the address', function()
      local b = newBase()
      native.compute(b, assign('Update-Roles', OWNER, roleUpdate({ [ALICE] = { 'admin' } })))
      native.compute(b, assign('Update-Roles', OWNER,
        roleUpdate(nil, { [ALICE] = { 'admin' } })))
      assert.is_nil(listed(b, ALICE))
    end)

    it('tracks several addresses independently in one message', function()
      local b = newBase()
      native.compute(b, assign('Update-Roles', OWNER,
        roleUpdate({ [ALICE] = { 'admin' }, [BOB] = { 'admin', 'Remove-Fingerprint-Certificate' } })))
      assert.equal('1', listed(b, ALICE))
      assert.equal('2', listed(b, BOB))
    end)
  end)

  -- --- atomicity ----------------------------------------------------------------------
  describe('revert', function()
    it('a failed handler leaves the allowlist untouched', function()
      -- Without allowlistId/allowlistTable in the snapshot this fails: the address stays
      -- allowed to write to a contract whose state has no record of why.
      local b = newBase()
      native.compute(b, assign('Update-Roles', OWNER, roleUpdate({ [ALICE] = { 'admin' } })))
      local before = listed(b, ALICE)

      -- Permission Denied: ALICE is not allowed to grant BOB anything.
      native.compute(b, assign('Update-Roles', BOB, roleUpdate({ [BOB] = { 'admin' } })))
      assert.is_nil(listed(b, BOB))
      assert.equal(before, listed(b, ALICE))
    end)

    it('a malformed Update-Roles payload reverts rather than half-applying', function()
      local b = newBase()
      native.compute(b, assign('Update-Roles', OWNER, 'not json at all'))
      assert.is_nil(listed(b, ALICE))
      assert.same({}, native.acl().roles)
    end)
  end)

  -- --- driven by contract state (operator fingerprints) --------------------------------
  describe('maintained from operator fingerprints', function()
    local FP_A = string.rep('A', 40)
    local FP_B = string.rep('B', 40)

    it('an admin-assigned CLAIMABLE fingerprint already lists the operator', function()
      -- The bootstrapping path. If claimable did not count, the operator could never make the
      -- Submit-Fingerprint-Certificate write that turns it verified — locked out at first use.
      local b = newBase()
      native.compute(b, assign('Admin-Submit-Operator-Certificates', OWNER,
        json.encode({ { f = FP_A, a = ALICE } })))
      assert.equal('1', listed(b, ALICE))
    end)

    it('claiming it keeps the count unchanged (the reason moves, it does not double)', function()
      local b = newBase()
      native.compute(b, assign('Admin-Submit-Operator-Certificates', OWNER,
        json.encode({ { f = FP_A, a = ALICE } })))
      native.compute(b, assign('Submit-Fingerprint-Certificate', ALICE, nil,
        { ['Fingerprint-Certificate'] = FP_A }))
      assert.equal(ALICE, native.stateRoot().verified[FP_A])
      assert.equal('1', listed(b, ALICE))
    end)

    it('two fingerprints count twice; renouncing one keeps the operator listed', function()
      -- Exactly the case a boolean list gets wrong.
      local b = newBase()
      native.compute(b, assign('Admin-Submit-Operator-Certificates', OWNER,
        json.encode({ { f = FP_A, a = ALICE }, { f = FP_B, a = ALICE } })))
      assert.equal('2', listed(b, ALICE))
      native.compute(b, assign('Submit-Fingerprint-Certificate', ALICE, nil,
        { ['Fingerprint-Certificate'] = FP_A }))
      native.compute(b, assign('Renounce-Fingerprint-Certificate', ALICE, nil,
        { Fingerprint = FP_A }))
      assert.equal('1', listed(b, ALICE))
    end)

    it('renouncing the last fingerprint delists the operator', function()
      local b = newBase()
      native.compute(b, assign('Admin-Submit-Operator-Certificates', OWNER,
        json.encode({ { f = FP_A, a = ALICE } })))
      native.compute(b, assign('Submit-Fingerprint-Certificate', ALICE, nil,
        { ['Fingerprint-Certificate'] = FP_A }))
      native.compute(b, assign('Renounce-Fingerprint-Certificate', ALICE, nil,
        { Fingerprint = FP_A }))
      assert.is_nil(listed(b, ALICE))
    end)

    it('an admin removing a certificate delists its holder', function()
      local b = newBase()
      native.compute(b, assign('Admin-Submit-Operator-Certificates', OWNER,
        json.encode({ { f = FP_A, a = ALICE } })))
      native.compute(b, assign('Submit-Fingerprint-Certificate', ALICE, nil,
        { ['Fingerprint-Certificate'] = FP_A }))
      native.compute(b, assign('Remove-Fingerprint-Certificate', OWNER, nil,
        { Fingerprint = FP_A }))
      assert.is_nil(listed(b, ALICE))
    end)

    it('re-assigning a claimable fingerprint MOVES the reason to the new operator', function()
      -- Otherwise the previous holder keeps write access to a certificate they no longer have.
      local b = newBase()
      native.compute(b, assign('Admin-Submit-Operator-Certificates', OWNER,
        json.encode({ { f = FP_A, a = ALICE } })))
      native.compute(b, assign('Admin-Submit-Operator-Certificates', OWNER,
        json.encode({ { f = FP_A, a = BOB } })))
      assert.is_nil(listed(b, ALICE))
      assert.equal('1', listed(b, BOB))
    end)

    it('re-assigning to the SAME operator does not double-count', function()
      local b = newBase()
      native.compute(b, assign('Admin-Submit-Operator-Certificates', OWNER,
        json.encode({ { f = FP_A, a = ALICE } })))
      native.compute(b, assign('Admin-Submit-Operator-Certificates', OWNER,
        json.encode({ { f = FP_A, a = ALICE } })))
      assert.equal('1', listed(b, ALICE))
    end)
  end)

  -- --- migration seeding ---------------------------------------------------------------
  describe('seeding a migrated contract', function()
    it('lists owner, role holders and existing operators on the first slot', function()
      -- Without this every migrated operator is locked out until something happens to grant
      -- them, which for most of them is never.
      local b = newBase()
      native.stateRoot().verified[string.rep('C', 40)] = ALICE
      native.stateRoot().claimable[string.rep('D', 40)] = BOB
      native.acl().roles = { admin = { [OWNER] = true } }
      native.compute(b, assign('Unknown-Action', OWNER))
      assert.equal('1', listed(b, ALICE))
      assert.equal('1', listed(b, BOB))
      assert.equal('2', listed(b, OWNER))   -- owner + admin role
    end)

    it('seeds a blocked operator as denied, not merely absent', function()
      local b = newBase()
      native.stateRoot().verified[string.rep('C', 40)] = ALICE
      native.stateRoot().blocked[ALICE] = true
      native.compute(b, assign('Unknown-Action', OWNER))
      assert.equal('B1', listed(b, ALICE))
    end)

    it('seeds once, not on every slot', function()
      local b = newBase()
      native.stateRoot().verified[string.rep('C', 40)] = ALICE
      native.compute(b, assign('Unknown-Action', OWNER))
      native.compute(b, assign('Unknown-Action', OWNER))
      native.compute(b, assign('Unknown-Action', OWNER))
      assert.equal('1', listed(b, ALICE))
    end)
  end)

  -- --- blocked is a VETO ---------------------------------------------------------------
  describe('blocked', function()
    it('denies an address that still holds live reasons', function()
      -- The case a decrement gets wrong: ALICE has two reasons, so `-1` would leave her
      -- allowed. Blocking has to win regardless of the count.
      local b = newBase()
      native.compute(b, assign('Update-Roles', OWNER,
        roleUpdate({ [ALICE] = { 'admin', 'Add-Verified-Hardware' } })))
      assert.equal('2', listed(b, ALICE))
      native.compute(b, assign('Block-Operator-Address', OWNER, nil,
        { Address = ALICE }))
      assert.equal('B2', listed(b, ALICE))
    end)

    it('unblocking restores the exact prior reason count', function()
      local b = newBase()
      native.compute(b, assign('Update-Roles', OWNER,
        roleUpdate({ [ALICE] = { 'admin', 'Add-Verified-Hardware' } })))
      native.compute(b, assign('Block-Operator-Address', OWNER, nil, { Address = ALICE }))
      native.compute(b, assign('Unblock-Operator-Address', OWNER, nil, { Address = ALICE }))
      assert.equal('2', listed(b, ALICE))
    end)

    it('a grant while blocked does NOT silently unblock', function()
      local b = newBase()
      native.compute(b, assign('Update-Roles', OWNER, roleUpdate({ [ALICE] = { 'admin' } })))
      native.compute(b, assign('Block-Operator-Address', OWNER, nil, { Address = ALICE }))
      native.compute(b, assign('Update-Roles', OWNER,
        roleUpdate({ [ALICE] = { 'Add-Verified-Hardware' } })))
      assert.equal('B2', listed(b, ALICE))
    end)

    it('the block flag survives losing every reason', function()
      local b = newBase()
      native.compute(b, assign('Update-Roles', OWNER, roleUpdate({ [ALICE] = { 'admin' } })))
      native.compute(b, assign('Block-Operator-Address', OWNER, nil, { Address = ALICE }))
      native.compute(b, assign('Update-Roles', OWNER,
        roleUpdate(nil, { [ALICE] = { 'admin' } })))
      assert.equal('B0', listed(b, ALICE))
    end)
  end)

  -- --- contract-driven ----------------------------------------------------------------
  describe('ctx.allow / ctx.disallow', function()
    it('a contract can list an address implied by state, independently of roles', function()
      local b = newBase()
      native.compute(b, assign('Update-Roles', OWNER, roleUpdate({ [ALICE] = { 'admin' } })))
      -- Simulate a contract handler adding a state-derived writer for the same address.
      native._contract.actions['Spec-Allow'] = function(ctx) ctx.allow(ALICE); return 'OK' end
      native.compute(b, assign('Spec-Allow', OWNER))
      assert.equal('2', listed(b, ALICE))

      -- Losing the ROLE must not delist her: the state-derived reason still stands.
      native.compute(b, assign('Update-Roles', OWNER,
        roleUpdate(nil, { [ALICE] = { 'admin' } })))
      assert.equal('1', listed(b, ALICE))
      native._contract.actions['Spec-Allow'] = nil
    end)

    it('grants outside a slot are ignored rather than leaking into the next message', function()
      local b = newBase()
      native.allowlist.grant(ALICE)     -- no slot in flight
      native.compute(b, assign('Update-Roles', OWNER, roleUpdate({ [BOB] = { 'admin' } })))
      assert.is_nil(listed(b, ALICE))
      assert.equal('1', listed(b, BOB))
    end)
  end)
end)
