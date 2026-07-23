-- Tier-2 scenario: the D26 NATIVE-SHAPE operator-registry through real luerl (1.3.0 —
-- the exact VM HyperBEAM v0.9-FINAL vendors). FULL PARITY with the Tier-1 busted spec
-- (spec/native/operator-registry_spec.lua) and thus with the legacynet WASM harness.
-- busted can't run inside luerl, so this returns { pass, fail, failures }. State is
-- base-addressable (isolated per base); Owner/ao globals persist across computes in the
-- one luerl state, exercising cross-message persistence, json fidelity, string.find
-- patterns, and string.gmatch's replacement (A13) under the real device VM.
local json = require('json')
local pass, fail, failures = 0, 0, {}
local function check(name, cond)
  if cond then pass = pass + 1 else fail = fail + 1; failures[#failures + 1] = name end
end
local function same(a, b)
  if type(a) ~= type(b) then return false end
  if type(a) ~= 'table' then return a == b end
  for k, v in pairs(a) do if not same(v, b[k]) then return false end end
  for k in pairs(b) do if a[k] == nil then return false end end
  return true
end

local OWNER  = '0x' .. string.rep('1', 40)
-- Real mixed-case EIP-55 addresses, stored verbatim (no on-chain case fold). See the EIP-55
-- note in src/contracts/native/operator-registry.lua.
local ALICE  = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
local BOB    = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC'
local CHARLS = '0x90F79bf6EB2c4f870365E785982E1f101E93b906'
local FP_A, FP_B, FP_C = string.rep('A', 40), string.rep('B', 40), string.rep('C', 40)
local FP_D, FP_E, FP_F = string.rep('D', 40), string.rep('E', 40), string.rep('F', 40)

local function commit(c) return { c1 = { ['commitment-device'] = 'ans104@1.0', committer = c } } end
local function assign(action, committer, data, tags, extra)
  local taglist = { { name = 'Action', value = action } }
  if tags then for k, v in pairs(tags) do taglist[#taglist + 1] = { name = k, value = v } end end
  local body = { action = action, tags = taglist, data = data,
    commitments = committer and commit(committer) or nil }
  if extra then for k, v in pairs(extra) do body[k] = v end end
  return { body = body }
end
local function newBase() return { process = { id = 'PID', commitments = commit(OWNER) } } end
local function seededBase(o)
  o = o or {}
  local b = newBase()
  b.state = { claimable = o.claimable or {}, verified = o.verified or {}, blocked = o.blocked or {},
    verifiedHardware = o.verifiedHardware or {}, registrationCredits = o.registrationCredits or {},
    registrationCreditsRequired = o.registrationCreditsRequired or false }
  b.acl = { roles = {} }
  return b
end
local function outData(base) return base.results and base.results.output and base.results.output.data or '' end
local function has(s, sub) return type(s) == 'string' and string.find(s, sub, 1, true) ~= nil end
local function view(base, name, params) return native.view(base, name, params) end

local function certs(list) return json.encode(list) end
local function submitCerts(base, from, list) return compute(base, assign('Admin-Submit-Operator-Certificates', from, certs(list))) end
local function addOperatorCert(base, address, fp) return submitCerts(base, OWNER, { { f = fp, a = address } }) end
local function addRC(base, address, fp) return compute(base, assign('Add-Registration-Credit', OWNER, nil, { Address = address, Fingerprint = fp })) end
local function claim(base, operator, fp) return compute(base, assign('Submit-Fingerprint-Certificate', operator, nil, { ['Fingerprint-Certificate'] = fp })) end
local function grantRole(base, addr, roles) return compute(base, assign('Update-Roles', OWNER, json.encode({ Grant = { [addr] = roles } }))) end
local function setupClaimed(base, operator, fp) addOperatorCert(base, operator, fp); claim(base, operator, fp) end

local ALL = {
  { f = FP_A, a = ALICE }, { f = FP_B, a = BOB }, { f = FP_C, a = CHARLS },
  { f = FP_D, a = ALICE }, { f = FP_E, a = BOB }, { f = FP_F, a = CHARLS },
}
local EXPECTED = { [FP_A] = ALICE, [FP_B] = BOB, [FP_C] = CHARLS, [FP_D] = ALICE, [FP_E] = BOB, [FP_F] = CHARLS }

-- Submitting Operator Certificates
do local base = newBase(); submitCerts(base, OWNER, ALL)
  check('submit: owner accepts certs', same(EXPECTED, base.state.claimable))
  check('submit: no hardware set', same({}, base.state.verifiedHardware))
  check('submit: OK output', outData(base) == 'OK')
end
do local base = newBase(); submitCerts(base, OWNER, ALL)
  check('submit: operators view lists certs', same(EXPECTED, base.state.claimable))
end
do local base = newBase()
  submitCerts(base, OWNER, { { f = FP_A, a = ALICE, hw = true }, { f = FP_B, a = BOB },
    { f = FP_C, a = CHARLS, hw = true }, { f = FP_D, a = ALICE }, { f = FP_E, a = BOB, hw = true }, { f = FP_F, a = CHARLS } })
  check('submit hw: operators view', same(EXPECTED, base.state.claimable))
  check('submit hw: verifiedHardware view', same({ [FP_A] = true, [FP_C] = true, [FP_E] = true }, base.state.verifiedHardware))
end
do local base = newBase(); compute(base, assign('Admin-Submit-Operator-Certificates', OWNER, nil))
  check('submit validate: missing certs', has(outData(base), 'Operator Certificates required'))
end
do local base = newBase(); submitCerts(base, OWNER, { { f = FP_A, a = ALICE }, { f = 'invalid-fingerprint' } })
  check('submit validate: invalid fingerprint', has(outData(base), 'Invalid Fingerprint'))
  check('submit validate: invalid fingerprint reverts', base.state.claimable[FP_A] == nil)
end
do local base = newBase(); submitCerts(base, OWNER, { { f = FP_A, a = ALICE }, { f = FP_B, a = 'invalid-address' } })
  check('submit validate: invalid address', has(outData(base), 'Invalid Address'))
  check('submit validate: invalid address reverts', base.state.claimable[FP_A] == nil)
end
do local base = newBase(); compute(base, assign('Admin-Submit-Operator-Certificates', ALICE, 'mock-certs-data'))
  check('submit: non-owner denied', has(outData(base), 'Permission Denied'))
end

-- Fingerprint Certificates
do local base = newBase(); addOperatorCert(base, ALICE, FP_A); addRC(base, ALICE, FP_A); claim(base, ALICE, FP_A)
  check('claim: verified set', base.state.verified[FP_A] == ALICE)
  check('claim: claimable cleared', base.state.claimable[FP_A] == nil)
  check('claim: OK output', outData(base) == 'OK')
end
do local base = newBase()
  compute(base, assign('Submit-Fingerprint-Certificate', ALICE, nil, { ['Fingerprint-Certificate'] = string.rep('a', 40) }))
  check('claim: invalid-format fingerprint', has(outData(base), 'Invalid certificate'))
end
do local base = newBase()
  compute(base, assign('Submit-Fingerprint-Certificate', ALICE, nil, { ['Fingerprint-Certificate'] = FP_A }))
  check('claim: unknown fingerprint', has(outData(base), 'Invalid certificate'))
end
do local base = newBase(); setupClaimed(base, ALICE, FP_A)
  check('claim: certificates view', same({ [FP_A] = ALICE }, base.state.verified))
end

-- Renouncing
do local base = newBase(); setupClaimed(base, ALICE, FP_A)
  compute(base, assign('Renounce-Fingerprint-Certificate', ALICE, nil, { Fingerprint = FP_A }))
  check('renounce: verified cleared', base.state.verified[FP_A] == nil)
  check('renounce: OK output', outData(base) == 'OK')
  check('renounce: certificates empty', same({}, base.state.verified))
end
do local base = newBase(); compute(base, assign('Renounce-Fingerprint-Certificate', ALICE, nil))
  check('renounce: missing fingerprint', has(outData(base), 'Fingerprint required'))
end
do local base = newBase(); setupClaimed(base, ALICE, FP_A)
  compute(base, assign('Renounce-Fingerprint-Certificate', BOB, nil, { Fingerprint = FP_A }))
  check('renounce: non-operator denied', has(outData(base), 'Only the Relay Operator can renounce'))
  check('renounce: non-operator no mutation', base.state.verified[FP_A] == ALICE)
end
do local base = newBase(); compute(base, assign('Renounce-Fingerprint-Certificate', ALICE, nil, { Fingerprint = FP_A }))
  check('renounce: unknown fingerprint', has(outData(base), 'Only the Relay Operator can renounce'))
end

-- Removing Fingerprint Certificates
do local base = newBase(); setupClaimed(base, ALICE, FP_A)
  compute(base, assign('Remove-Fingerprint-Certificate', OWNER, nil, { Fingerprint = FP_A }))
  check('remove-fp: owner removes', base.state.verified[FP_A] == nil)
  check('remove-fp: OK output', outData(base) == 'OK')
  check('remove-fp: certificates empty', same({}, base.state.verified))
end
do local base = newBase(); setupClaimed(base, ALICE, FP_A)
  compute(base, assign('Remove-Fingerprint-Certificate', OWNER, nil))
  check('remove-fp: missing fingerprint', has(outData(base), 'Fingerprint required'))
end
do local base = newBase(); setupClaimed(base, ALICE, FP_A)
  compute(base, assign('Remove-Fingerprint-Certificate', BOB, nil, { Fingerprint = FP_A }))
  check('remove-fp: non-owner denied', has(outData(base), 'Permission Denied'))
  check('remove-fp: non-owner no mutation', base.state.verified[FP_A] == ALICE)
end

-- Blocking
do local base = newBase(); compute(base, assign('Block-Operator-Address', OWNER, nil, { Address = ALICE }))
  check('block: owner blocks', base.state.blocked[ALICE] == true)
  check('block: OK output', outData(base) == 'OK')
end
do local base = newBase(); compute(base, assign('Block-Operator-Address', OWNER, nil))
  check('block: missing address', has(outData(base), 'Address is required'))
end
do local base = newBase(); compute(base, assign('Block-Operator-Address', OWNER, nil, { Address = 'invalid-address' }))
  check('block: invalid address', has(outData(base), 'Invalid Address'))
end
do local base = newBase(); compute(base, assign('Block-Operator-Address', BOB, nil, { Address = ALICE }))
  check('block: non-owner denied', has(outData(base), 'Permission Denied'))
end
do local base = newBase()
  compute(base, assign('Block-Operator-Address', OWNER, nil, { Address = ALICE }))
  compute(base, assign('Submit-Fingerprint-Certificate', ALICE, nil, { ['Fingerprint-Certificate'] = FP_A }))
  check('block: prevents claim', has(outData(base), 'Address is blocked'))
end
do local base = newBase()
  for _, a in ipairs({ ALICE, BOB, CHARLS }) do compute(base, assign('Block-Operator-Address', OWNER, nil, { Address = a })) end
  check('block: lists blocked', same({ [ALICE] = true, [BOB] = true, [CHARLS] = true }, base.state.blocked))
end
do local base = newBase()
  compute(base, assign('Block-Operator-Address', OWNER, nil, { Address = ALICE }))
  compute(base, assign('Unblock-Operator-Address', OWNER, nil, { Address = ALICE }))
  check('unblock: owner unblocks', base.state.blocked[ALICE] == nil)
  check('unblock: OK output', outData(base) == 'OK')
  check('unblock: blocked empty', same({}, base.state.blocked))
end
do local base = newBase(); compute(base, assign('Unblock-Operator-Address', OWNER, nil))
  check('unblock: missing address', has(outData(base), 'Address is required'))
end
do local base = newBase(); compute(base, assign('Unblock-Operator-Address', OWNER, nil, { Address = 'invalid-address' }))
  check('unblock: invalid address', has(outData(base), 'Invalid Address'))
end
do local base = newBase(); compute(base, assign('Unblock-Operator-Address', OWNER, nil, { Address = ALICE }))
  check('unblock: not blocked', has(outData(base), 'Address is not blocked'))
end
do local base = newBase(); compute(base, assign('Unblock-Operator-Address', ALICE, nil, { Address = ALICE }))
  check('unblock: non-owner denied', has(outData(base), 'Permission Denied'))
end
do local base = newBase()
  addOperatorCert(base, ALICE, FP_A); addRC(base, ALICE, FP_A)
  compute(base, assign('Block-Operator-Address', OWNER, nil, { Address = ALICE }))
  compute(base, assign('Unblock-Operator-Address', OWNER, nil, { Address = ALICE }))
  claim(base, ALICE, FP_A)
  check('unblock: allows claim again', base.state.verified[FP_A] == ALICE)
  check('unblock: claim OK output', outData(base) == 'OK')
end

-- Registration Credits
do local base = newBase(); addRC(base, ALICE, FP_A)
  check('rc add: owner adds', same({ [FP_A] = ALICE }, base.state.registrationCredits))
  check('rc add: OK output', outData(base) == 'OK')
end
do local base = newBase(); compute(base, assign('Add-Registration-Credit', OWNER, nil, { Fingerprint = FP_A }))
  check('rc add: missing address', has(outData(base), 'Address is required'))
end
do local base = newBase(); compute(base, assign('Add-Registration-Credit', OWNER, nil, { Address = 'invalid-address', Fingerprint = FP_A }))
  check('rc add: invalid address', has(outData(base), 'Invalid Address'))
end
do local base = newBase(); compute(base, assign('Add-Registration-Credit', OWNER, nil, { Address = ALICE }))
  check('rc add: missing fingerprint', has(outData(base), 'Fingerprint required'))
end
do local base = newBase(); compute(base, assign('Add-Registration-Credit', OWNER, nil, { Address = ALICE, Fingerprint = 'invalid-fingerprint' }))
  check('rc add: invalid fingerprint', has(outData(base), 'Invalid Fingerprint'))
end
do local base = newBase(); addRC(base, ALICE, FP_A); addRC(base, ALICE, FP_A)
  check('rc add: duplicate', has(outData(base), 'Registration Credit already added'))
end
do local base = newBase(); compute(base, assign('Add-Registration-Credit', ALICE, nil, { Address = ALICE, Fingerprint = FP_A }))
  check('rc add: non-owner denied', has(outData(base), 'Permission Denied'))
end
do local base = newBase(); addOperatorCert(base, ALICE, FP_A); claim(base, ALICE, FP_A)
  check('rc disabled: claim without credit', base.state.verified[FP_A] == ALICE and outData(base) == 'OK')
end
do local base = newBase()
  local credits = { [FP_A] = ALICE, [FP_B] = BOB, [FP_C] = CHARLS, [FP_D] = ALICE }
  for fp, addr in pairs(credits) do addRC(base, addr, fp) end
  check('rc list', same(credits, base.state.registrationCredits))
end
do local base = newBase()
  for fp, addr in pairs({ [FP_A] = ALICE, [FP_B] = BOB, [FP_C] = CHARLS, [FP_D] = ALICE }) do addRC(base, addr, fp) end
  compute(base, assign('Remove-Registration-Credit', OWNER, nil, { Address = ALICE, Fingerprint = FP_D }))
  check('rc remove: owner removes', same({ [FP_A] = ALICE, [FP_B] = BOB, [FP_C] = CHARLS }, base.state.registrationCredits))
  check('rc remove: OK output', outData(base) == 'OK')
end
do local base = newBase(); compute(base, assign('Remove-Registration-Credit', OWNER, nil, { Fingerprint = FP_D }))
  check('rc remove: missing address', has(outData(base), 'Address is required'))
end
do local base = newBase(); compute(base, assign('Remove-Registration-Credit', OWNER, nil, { Address = 'invalid-address', Fingerprint = FP_D }))
  check('rc remove: invalid address', has(outData(base), 'Invalid Address'))
end
do local base = newBase(); compute(base, assign('Remove-Registration-Credit', OWNER, nil, { Address = ALICE }))
  check('rc remove: missing fingerprint', has(outData(base), 'Fingerprint required'))
end
do local base = newBase(); compute(base, assign('Remove-Registration-Credit', OWNER, nil, { Address = ALICE, Fingerprint = 'invalid-fingerprint' }))
  check('rc remove: invalid fingerprint', has(outData(base), 'Invalid Fingerprint'))
end
do local base = newBase(); compute(base, assign('Remove-Registration-Credit', OWNER, nil, { Address = ALICE, Fingerprint = FP_D }))
  check('rc remove: non-existent', has(outData(base), 'Registration Credit does not exist'))
end
do local base = newBase(); compute(base, assign('Remove-Registration-Credit', ALICE, nil, { Address = ALICE, Fingerprint = FP_D }))
  check('rc remove: non-owner denied', has(outData(base), 'Permission Denied'))
end

-- Verified Hardware (exercises string.gmatch replacement / A13 under luerl)
do local base = newBase(); compute(base, assign('Add-Verified-Hardware', OWNER, table.concat({ FP_A, FP_B, FP_C, FP_D }, ',')))
  check('vh add: owner adds', same({ [FP_A] = true, [FP_B] = true, [FP_C] = true, [FP_D] = true }, base.state.verifiedHardware))
  check('vh add: OK output', outData(base) == 'OK')
end
do local base = newBase(); compute(base, assign('Add-Verified-Hardware', OWNER, nil))
  check('vh add: missing fingerprints', has(outData(base), 'Fingerprints required'))
end
do local base = newBase(); compute(base, assign('Add-Verified-Hardware', OWNER, FP_A .. ',invalid-fingerprint'))
  check('vh add: invalid fingerprint', has(outData(base), 'Invalid Fingerprint'))
  check('vh add: invalid reverts', base.state.verifiedHardware[FP_A] == nil)
end
do local base = newBase()
  compute(base, assign('Add-Verified-Hardware', OWNER, table.concat({ FP_A, FP_B, FP_C }, ',')))
  compute(base, assign('Add-Verified-Hardware', OWNER, FP_D .. ',' .. FP_C))
  check('vh add: duplicate', has(outData(base), 'Duplicate Fingerprint'))
  check('vh add: duplicate reverts', base.state.verifiedHardware[FP_D] == nil)
end
do local base = newBase(); compute(base, assign('Add-Verified-Hardware', ALICE, FP_A))
  check('vh add: non-owner denied', has(outData(base), 'Permission Denied'))
end
do local base = newBase()
  addOperatorCert(base, ALICE, FP_A)
  compute(base, assign('Add-Verified-Hardware', OWNER, FP_A))
  claim(base, ALICE, FP_A)
  check('vh: does not require RC', base.state.verified[FP_A] == ALICE and outData(base) == 'OK')
end
do local base = newBase(); compute(base, assign('Add-Verified-Hardware', OWNER, table.concat({ FP_A, FP_B, FP_C, FP_D }, ',')))
  check('vh list', same({ [FP_A] = true, [FP_B] = true, [FP_C] = true, [FP_D] = true }, base.state.verifiedHardware))
end
do local base = newBase()
  compute(base, assign('Add-Verified-Hardware', OWNER, table.concat({ FP_A, FP_B, FP_C, FP_D }, ',')))
  compute(base, assign('Remove-Verified-Hardware', OWNER, FP_B .. ',' .. FP_C))
  check('vh remove: owner removes', same({ [FP_A] = true, [FP_D] = true }, base.state.verifiedHardware))
  check('vh remove: OK output', outData(base) == 'OK')
end
do local base = newBase(); compute(base, assign('Remove-Verified-Hardware', OWNER, nil))
  check('vh remove: missing fingerprints', has(outData(base), 'Fingerprints required'))
end
do local base = newBase(); compute(base, assign('Remove-Verified-Hardware', OWNER, FP_B .. ',' .. FP_C))
  check('vh remove: not added', has(outData(base), 'Unknown Fingerprint'))
end
do local base = newBase(); compute(base, assign('Remove-Verified-Hardware', ALICE, FP_B .. ',' .. FP_C))
  check('vh remove: non-owner denied', has(outData(base), 'Permission Denied'))
end

-- Status counts (replaces Info)
do local base = newBase()
  for _, r in ipairs({ { ALICE, FP_A }, { BOB, FP_B }, { CHARLS, FP_C } }) do
    addOperatorCert(base, r[1], r[2]); addRC(base, r[1], r[2]); claim(base, r[1], r[2])
  end
  for _, r in ipairs({ { ALICE, FP_D }, { BOB, FP_E }, { CHARLS, FP_F } }) do addOperatorCert(base, r[1], r[2]) end
  compute(base, assign('Add-Verified-Hardware', OWNER, FP_B .. ',' .. FP_E))
  local st = view(base, 'status')
  check('status: verified count', st.counts.verified == 3)
  check('status: hardware count', st.counts.hardware == 2)
  check('status: total', st.counts.claimable + st.counts.verified == 6)
end

-- Dump (full state)
do local base = newBase()
  for _, r in ipairs({ { ALICE, FP_A }, { BOB, FP_B }, { CHARLS, FP_C } }) do
    addOperatorCert(base, r[1], r[2]); addRC(base, r[1], r[2]); claim(base, r[1], r[2])
  end
  for _, r in ipairs({ { ALICE, FP_D }, { BOB, FP_E }, { CHARLS, FP_F } }) do addOperatorCert(base, r[1], r[2]) end
  compute(base, assign('Add-Verified-Hardware', OWNER, FP_B .. ',' .. FP_E))
  local s = view(base, 'dump')
  check('view-state: claimable', same({ [FP_D] = ALICE, [FP_E] = BOB, [FP_F] = CHARLS }, s.claimable))
  check('view-state: verified', same({ [FP_A] = ALICE, [FP_B] = BOB, [FP_C] = CHARLS }, s.verified))
  check('view-state: blocked', same({}, s.blocked))
  check('view-state: registrationCredits', same({ [FP_A] = ALICE, [FP_B] = BOB, [FP_C] = CHARLS }, s.registrationCredits))
  check('view-state: verifiedHardware', same({ [FP_B] = true, [FP_E] = true }, s.verifiedHardware))
end

-- (No Init action — migration state is the module's initial `state`, seeded at spawn and
-- validated in deploy tooling. Nothing to exercise at runtime. See D26.)

-- ACL — Enforcing Roles
do local base = newBase(); grantRole(base, ALICE, { 'admin' })
  submitCerts(base, ALICE, { { f = FP_A, a = ALICE }, { f = FP_B, a = BOB } })
  check('acl: admin submits certs', same({ [FP_A] = ALICE, [FP_B] = BOB }, base.state.claimable) and outData(base) == 'OK')
end
do local base = newBase(); grantRole(base, ALICE, { 'admin' })
  grantRole(base, BOB, { 'Admin-Submit-Operator-Certificates' })
  submitCerts(base, BOB, { { f = FP_A, a = ALICE } })
  check('acl: specific submit role', same({ [FP_A] = ALICE }, base.state.claimable) and outData(base) == 'OK')
end
do local base = newBase(); grantRole(base, ALICE, { 'admin' })
  setupClaimed(base, ALICE, FP_A)
  compute(base, assign('Remove-Fingerprint-Certificate', ALICE, nil, { Fingerprint = FP_A }))
  check('acl: admin removes fp', base.state.verified[FP_A] == nil and outData(base) == 'OK')
end
do local base = newBase(); grantRole(base, ALICE, { 'admin' })
  setupClaimed(base, ALICE, FP_A); grantRole(base, BOB, { 'Remove-Fingerprint-Certificate' })
  compute(base, assign('Remove-Fingerprint-Certificate', BOB, nil, { Fingerprint = FP_A }))
  check('acl: specific remove-fp role', base.state.verified[FP_A] == nil and outData(base) == 'OK')
end
do local base = newBase(); grantRole(base, ALICE, { 'admin' })
  compute(base, assign('Block-Operator-Address', ALICE, nil, { Address = CHARLS }))
  check('acl: admin blocks', base.state.blocked[CHARLS] == true and outData(base) == 'OK')
end
do local base = newBase(); grantRole(base, ALICE, { 'admin' })
  grantRole(base, BOB, { 'Block-Operator-Address' })
  compute(base, assign('Block-Operator-Address', BOB, nil, { Address = CHARLS }))
  check('acl: specific block role', base.state.blocked[CHARLS] == true and outData(base) == 'OK')
end
do local base = newBase(); grantRole(base, ALICE, { 'admin' })
  compute(base, assign('Add-Registration-Credit', ALICE, nil, { Address = CHARLS, Fingerprint = FP_A }))
  check('acl: admin adds RC', same({ [FP_A] = CHARLS }, base.state.registrationCredits) and outData(base) == 'OK')
end
do local base = newBase(); grantRole(base, ALICE, { 'admin' })
  grantRole(base, BOB, { 'Add-Registration-Credit' })
  compute(base, assign('Add-Registration-Credit', BOB, nil, { Address = CHARLS, Fingerprint = FP_A }))
  check('acl: specific RC role', same({ [FP_A] = CHARLS }, base.state.registrationCredits) and outData(base) == 'OK')
end
do local base = newBase(); grantRole(base, ALICE, { 'admin' })
  compute(base, assign('Add-Verified-Hardware', ALICE, table.concat({ FP_A, FP_B, FP_C, FP_D }, ',')))
  check('acl: admin adds VH', same({ [FP_A] = true, [FP_B] = true, [FP_C] = true, [FP_D] = true }, base.state.verifiedHardware) and outData(base) == 'OK')
end
do local base = newBase(); grantRole(base, ALICE, { 'admin' })
  grantRole(base, BOB, { 'Add-Verified-Hardware' })
  compute(base, assign('Add-Verified-Hardware', BOB, table.concat({ FP_A, FP_B }, ',')))
  check('acl: specific VH role', same({ [FP_A] = true, [FP_B] = true }, base.state.verifiedHardware) and outData(base) == 'OK')
end

-- Runtime safety (D8 axes) — native-runtime specific
do local base = newBase(); compute(base, assign('Admin-Submit-Operator-Certificates', nil, certs({ { f = FP_A, a = ALICE } })))
  check('safety: unsigned rejected', has(outData(base), 'unsigned') and base.state.claimable[FP_A] == nil)
end
do local base = newBase()
  compute(base, assign('Admin-Submit-Operator-Certificates', ALICE, certs({ { f = FP_A, a = ALICE } }), nil, { ['from-process'] = OWNER }))
  check('safety: A11 forged from-process denied', has(outData(base), 'Permission Denied') and base.state.claimable[FP_A] == nil)
end
do local base = newBase(); compute(base, assign('No-Such-Action', OWNER, ''))
  check('safety: unknown action', has(outData(base), 'unknown action'))
end
do local base = newBase()
  addOperatorCert(base, ALICE, FP_A)
  submitCerts(base, OWNER, { { f = FP_B, a = BOB }, { f = 'BAD', a = CHARLS } })
  check('safety: cross-action atomicity keeps prior commit', base.state.claimable[FP_A] == ALICE)
  check('safety: cross-action atomicity reverts failed batch', base.state.claimable[FP_B] == nil)
end

-- Consumption + visibility views (asserted against state)
do local base = newBase()
  submitCerts(base, OWNER, { { f = FP_A, a = ALICE, hw = true }, { f = FP_D, a = ALICE } })
  claim(base, ALICE, FP_A)
  local op = view(base, 'operator', { address = ALICE })
  check('operator view: address', op.address == ALICE)
  check('operator view: verified', same({ [FP_A] = true }, op.verified))
  check('operator view: claimable', same({ [FP_D] = true }, op.claimable))
  check('operator view: hardware', same({ [FP_A] = true }, op.hardware))
  check('operator view: not blocked', op.blocked == false)
  -- Any-case query canonicalizes to EIP-55 on-chain, so a lowercase address resolves the same.
  local op2 = view(base, 'operator', { address = string.lower(ALICE) })
  check('operator view: query canonicalized (lowercase matches)', same(op.verified, op2.verified))
end

-- EIP-55 on-chain ingress: canonicalize + checksum-validate every untrusted address.
do local base = newBase()
  submitCerts(base, OWNER, { { f = FP_A, a = string.lower(ALICE) } })
  check('eip55: lowercase admin addr → canonical in state', same({ [FP_A] = ALICE }, base.state.claimable))
end
do local base = newBase()
  submitCerts(base, OWNER, { { f = FP_A, a = '0x' .. string.upper(string.sub(ALICE, 3)) } })
  check('eip55: ALLCAPS admin addr → canonical in state', same({ [FP_A] = ALICE }, base.state.claimable))
end
do local base = newBase()
  -- ALICE with one checksummed letter flipped → mixed-case, non-canonical → rejected + reverted
  submitCerts(base, OWNER, { { f = FP_A, a = '0x70997970c51812dc3A010C7d01b50e0d17dc79C8' } })
  check('eip55: mixed-case bad checksum rejected', has(outData(base), 'checksum'))
  check('eip55: bad checksum reverts', same({}, base.state.claimable))
end
do local base = newBase()
  compute(base, assign('Block-Operator-Address', OWNER, nil, { Address = string.lower(ALICE) }))
  check('eip55: Block canonicalizes key', same({ [ALICE] = true }, base.state.blocked))
  compute(base, assign('Unblock-Operator-Address', OWNER, nil, { Address = '0x' .. string.upper(string.sub(ALICE, 3)) }))
  check('eip55: Unblock canonicalizes key', same({}, base.state.blocked))
end
do local base = seededBase({ verified = { [FP_A] = ALICE, [FP_B] = BOB, [FP_C] = ALICE },
    blocked = { [BOB] = true } })
  check('operators view: unique minus blocked', same({ [ALICE] = true }, view(base, 'operators')))
end
do local base = seededBase({ verified = { [FP_A] = ALICE, [FP_B] = BOB },
    verifiedHardware = { [FP_A] = true } })
  local sc = view(base, 'scoring')
  check('scoring view: verified', same({ [FP_A] = ALICE, [FP_B] = BOB }, sc.verified))
  check('scoring view: hardware', same({ [FP_A] = true }, sc.hardware))
end
do local base = newBase()
  addOperatorCert(base, ALICE, FP_A); claim(base, ALICE, FP_A)
  addOperatorCert(base, BOB, FP_B)
  local fps = view(base, 'fingerprints', { ids = FP_A .. ',' .. FP_B .. ',' .. FP_C })
  check('fingerprints view: verified entry', fps[FP_A].verified == ALICE and fps[FP_A].claimable == nil)
  check('fingerprints view: claimable entry', fps[FP_B].claimable == BOB and fps[FP_B].verified == nil)
  check('fingerprints view: unknown entry', fps[FP_C].verified == nil)
end
do local base = newBase()
  grantRole(base, ALICE, { 'admin' })
  check('roles view', view(base, 'roles').admin[ALICE] == true)
  local v = view(base, 'version')
  check('version view: contract', v.contract == 'operator-registry')
  addOperatorCert(base, ALICE, FP_A)
  local st = view(base, 'status')
  check('status view: enriched name', st.name == 'operator-registry')
  check('status view: enriched owner', st.owner == OWNER)
end

-- Read-path HB metadata contamination (Tier-3 regression) through real luerl. On the live
-- device every committed state map surfaces a spurious `commitments` table to Lua views;
-- the runtime strips it (native.stripMeta) so views iterate only real entries. Reproduce
-- that shape here so luerl proves the strip too. See D26-native-contract-shape.md.
do
  local function meta()
    return { commitments = { sig1 = { ['commitment-device'] = 'httpsig@1.0',
        committed = { 'a', 'b' }, keyid = 'constant:ao', signature = 'sig1',
        type = 'hmac-sha256' } }, device = 'json@1.0', ['ao-types'] = 'x="atom"' }
  end
  local function contaminate(t) for k, v in pairs(meta()) do t[k] = v end; return t end
  local function readPathBase(o)
    local b = seededBase(o)
    for _, k in ipairs({ 'claimable', 'verified', 'blocked',
        'verifiedHardware', 'registrationCredits' }) do contaminate(b.state[k]) end
    contaminate(b.state)
    b.acl.roles.admin = contaminate({ [CHARLS] = true })
    contaminate(b.acl.roles); contaminate(b.acl)
    return b
  end

  local base = readPathBase({
    claimable = { [FP_A] = ALICE, [FP_B] = BOB, [FP_D] = ALICE },
    verified = { [FP_C] = CHARLS }, blocked = { [BOB] = true },
    verifiedHardware = { [FP_A] = true, [FP_C] = true }, registrationCredits = { [FP_B] = BOB } })
  local st = view(base, 'status')
  check('meta: status claimable count', st.counts.claimable == 3)
  check('meta: status verified count', st.counts.verified == 1)
  check('meta: status blocked count', st.counts.blocked == 1)
  check('meta: status hardware count', st.counts.hardware == 2)
  check('meta: status credits count', st.counts.credits == 1)

  local ops = view(readPathBase({ verified = { [FP_A] = ALICE, [FP_B] = BOB },
    blocked = { [BOB] = true } }), 'operators')
  check('meta: operators clean (was 500)', same({ [ALICE] = true }, ops))

  local sc = view(readPathBase({ verified = { [FP_A] = ALICE },
    verifiedHardware = { [FP_A] = true } }), 'scoring')
  check('meta: scoring verified clean', same({ [FP_A] = ALICE }, sc.verified))
  check('meta: scoring hardware clean', same({ [FP_A] = true }, sc.hardware))

  local r = view(readPathBase({}), 'roles')
  check('meta: roles clean', same({ [CHARLS] = true }, r.admin))

  local op = view(readPathBase({ verified = { [FP_A] = ALICE }, claimable = { [FP_D] = ALICE },
    verifiedHardware = { [FP_A] = true } }), 'operator', { address = ALICE })
  check('meta: operator verified clean', same({ [FP_A] = true }, op.verified))
  check('meta: operator claimable clean', same({ [FP_D] = true }, op.claimable))

  local sb = readPathBase({ verified = { [FP_A] = ALICE } })
  view(sb, 'status')
  check('meta: strip is read-only', sb.state.commitments ~= nil and sb.state.verified.commitments ~= nil)
end

-- View-name collision guard (register) — a view named for a reserved HB base key is silently
-- shadowed on the read path; the runtime rejects it at register() time. (Runs LAST: it
-- re-registers throwaway contracts, replacing native._contract.)
do
  local badState = pcall(function() native.register({ state = {}, views = { state = function(s) return s end } }) end)
  check('guard: rejects reserved view name (state)', badState == false)
  local badName = pcall(function() native.register({ state = {}, views = { name = function(s) return s end } }) end)
  check('guard: rejects reserved view name (name)', badName == false)
  local badRoles = pcall(function() native.register({ state = {}, views = { roles = function(s) return s end } }) end)
  check('guard: rejects runtime-owned view name (roles)', badRoles == false)
  local okDump = pcall(function() native.register({ state = {}, views = { dump = function(s) return s end } }) end)
  check('guard: accepts non-colliding view name (dump)', okDump == true)
end

return { pass = pass, fail = fail, failures = failures }
