-- Tier-2 scenario: the runtime `allowlist` through real luerl (1.3.0 — the exact VM HyperBEAM
-- v0.9-FINAL vendors). Parity with spec/native/allowlist_spec.lua.
--
-- Why this tier matters for THIS feature specifically. The allowlist is the write gate's source
-- of truth, and two of its mechanics are exactly the kind that behave differently under luerl
-- than under stock Lua 5.3:
--   · `pairs` over maps whose keys are 42-char addresses — A17 territory, and the seed path
--     iterates every claimable/verified entry at once
--   · string concat/compare on the 'B<count>' block encoding, where a silent type coercion
--     would turn a denial into an admission
-- Tier-1 proves the arithmetic; this proves it survives the VM the node actually runs.
local json = require('json')
local pass, fail, failures = 0, 0, {}
local function check(name, cond)
  if cond then pass = pass + 1 else fail = fail + 1; failures[#failures + 1] = name end
end

local OWNER = '0x' .. string.rep('1', 40)
local ALICE = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
local BOB   = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC'
local FP_A, FP_B = string.rep('A', 40), string.rep('B', 40)

local function commit(c) return { c1 = { ['commitment-device'] = 'ans104@1.0', committer = c } } end
local function assign(action, committer, data, tags)
  local taglist = { { name = 'Action', value = action } }
  if tags then for k, v in pairs(tags) do taglist[#taglist + 1] = { name = k, value = v } end end
  return { body = { action = action, tags = taglist, data = data,
                    commitments = committer and commit(committer) or nil } }
end
-- State lives in the `OperatorRegistry` global now (D31/D32), so each case must reset it or
-- it inherits the previous one's registry. Seeded through the runtime setters, which is also
-- what the Tier-1 harness does (busted proxies _G there; here it is just consistency).
local function newBase()
  native.reset()
  native.setStateRoot({ claimable = {}, verified = {}, blocked = {}, verifiedHardware = {},
              registrationCredits = {}, registrationCreditsRequired = false })
  native.setACL({ roles = {} })
  return { process = { id = 'PID', commitments = commit(OWNER) } }
end
local function S() return native.stateRoot() end
local function listed(b, a) return b.allowlistTable and b.allowlistTable[a] or nil end
local function roleUpdate(g, r) return json.encode({ Grant = g, Revoke = r }) end

-- --- refcount arithmetic, under the device VM -------------------------------------------
do
  check('apply: adds', native.allowlist.apply({}, { [ALICE] = 1 })[ALICE] == '1')
  check('apply: accumulates', native.allowlist.apply({ [ALICE] = 1 }, { [ALICE] = 2 })[ALICE] == '3')
  check('apply: keeps on partial loss',
    native.allowlist.apply({ [ALICE] = 2 }, { [ALICE] = -1 })[ALICE] == '1')
  check('apply: deletes on last loss',
    native.allowlist.apply({ [ALICE] = 1 }, { [ALICE] = -1 })[ALICE] == false)
  check('apply: clamps negative',
    native.allowlist.apply({ [ALICE] = 1 }, { [ALICE] = -5 })[ALICE] == false)
  -- The trie stores strings, so counts come back as strings on every real read.
  check('apply: parses string counts',
    native.allowlist.apply({ [ALICE] = '2' }, { [ALICE] = 1 })[ALICE] == '3')
end

-- --- ACL-driven -------------------------------------------------------------------------
do
  local b = newBase()
  native.compute(b, assign('Update-Roles', OWNER, roleUpdate({ [ALICE] = { 'admin' } })))
  check('roles: grant lists', listed(b, ALICE) == '1')
  native.compute(b, assign('Update-Roles', OWNER, roleUpdate({ [ALICE] = { 'admin' } })))
  check('roles: re-grant does not double', listed(b, ALICE) == '1')
  native.compute(b, assign('Update-Roles', OWNER, roleUpdate(nil, { [ALICE] = { 'admin' } })))
  check('roles: last revoke delists', listed(b, ALICE) == nil)
end

-- --- fingerprint lifecycle ---------------------------------------------------------------
do
  local b = newBase()
  native.compute(b, assign('Admin-Submit-Operator-Certificates', OWNER,
    json.encode({ { f = FP_A, a = ALICE }, { f = FP_B, a = ALICE } })))
  check('fp: claimable lists operator (bootstrap)', listed(b, ALICE) == '2')
  native.compute(b, assign('Submit-Fingerprint-Certificate', ALICE, nil,
    { ['Fingerprint-Certificate'] = FP_A }))
  check('fp: claim keeps count', listed(b, ALICE) == '2')
  check('fp: claim verified', S().verified[FP_A] == ALICE)
  native.compute(b, assign('Renounce-Fingerprint-Certificate', ALICE, nil, { Fingerprint = FP_A }))
  check('fp: renounce one keeps listed', listed(b, ALICE) == '1')

  local b2 = newBase()
  native.compute(b2, assign('Admin-Submit-Operator-Certificates', OWNER,
    json.encode({ { f = FP_A, a = ALICE } })))
  native.compute(b2, assign('Admin-Submit-Operator-Certificates', OWNER,
    json.encode({ { f = FP_A, a = BOB } })))
  check('fp: reassign moves reason off old holder', listed(b2, ALICE) == nil)
  check('fp: reassign lists new holder', listed(b2, BOB) == '1')
end

-- --- blocked is a veto -------------------------------------------------------------------
do
  local b = newBase()
  native.compute(b, assign('Update-Roles', OWNER,
    roleUpdate({ [ALICE] = { 'admin', 'Add-Verified-Hardware' } })))
  native.compute(b, assign('Block-Operator-Address', OWNER, nil, { Address = ALICE }))
  check('block: vetoes despite live reasons', listed(b, ALICE) == 'B2')
  native.compute(b, assign('Update-Roles', OWNER,
    roleUpdate({ [ALICE] = { 'Remove-Fingerprint-Certificate' } })))
  check('block: a grant does not silently unblock', listed(b, ALICE) == 'B3')
  native.compute(b, assign('Unblock-Operator-Address', OWNER, nil, { Address = ALICE }))
  check('block: unblock restores exact count', listed(b, ALICE) == '3')
end

-- --- migration seeding, at a size where luerl's pairs behaviour matters -------------------
do
  local b = newBase()
  for i = 1, 250 do
    S().verified[string.format('%040X', i)] = ALICE
    S().claimable[string.format('%040X', i + 100000)] = BOB
  end
  native.acl().roles = { admin = { [OWNER] = true } }
  S().blocked[BOB] = true
  native.compute(b, assign('Unknown-Action', OWNER))
  check('seed: verified operator counted per fingerprint', listed(b, ALICE) == '250')
  check('seed: blocked operator seeded as denied', listed(b, BOB) == 'B250')
  check('seed: owner counted for owner + role', listed(b, OWNER) == '2')
  local before = listed(b, ALICE)
  native.compute(b, assign('Unknown-Action', OWNER))
  check('seed: runs once only', listed(b, ALICE) == before)
end

-- --- atomicity ----------------------------------------------------------------------------
do
  local b = newBase()
  native.compute(b, assign('Update-Roles', OWNER, roleUpdate({ [ALICE] = { 'admin' } })))
  -- ALICE has no right to grant, so this must revert with no allowlist trace.
  -- BOB holds no role, so this must be denied. (ALICE would NOT work — she was granted
  -- 'admin' above, and Update-Roles accepts admin.)
  native.compute(b, assign('Update-Roles', BOB, roleUpdate({ [BOB] = { 'admin' } })))
  check('revert: denied handler leaves no entry', listed(b, BOB) == nil)
  check('revert: existing entry untouched', listed(b, ALICE) == '1')
end

return { pass = pass, fail = fail, failures = failures }
