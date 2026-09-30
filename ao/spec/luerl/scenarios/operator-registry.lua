-- Tier-2 scenario: operator-registry through real luerl. Mirrors the Tier-1 busted
-- specs, but returns a result table (busted can't run inside luerl). State is NOT
-- reset between checks (distinct fingerprints avoid collisions), so this also
-- exercises cross-message persistence in the luerl state.
local json = require('json')
local pass, fail, failures = 0, 0, {}
local function check(name, cond)
  if cond then pass = pass + 1 else fail = fail + 1; failures[#failures + 1] = name end
end

local OWNER, ATTACKER = '0x' .. string.rep('C', 40), '0x' .. string.rep('B', 40)
local ADDR, ADDR_STORED = '0x' .. string.rep('a', 40), '0x' .. string.rep('A', 40)

local function commit(c) return { c1 = { ['commitment-device'] = 'ans104@1.0', committer = c } } end
local function assign(action, committer, data, extra)
  local body = { action = action, tags = { { name = 'Action', value = action } },
    data = data, commitments = committer and commit(committer) or nil }
  if extra then for k, v in pairs(extra) do body[k] = v end end
  return { body = body }
end
local function newBase() return { process = { id = 'PID', commitments = commit(OWNER) }, state = {} } end
local function certs(list) return json.encode(list) end
local function fp(ch) return string.rep(ch, 40) end
local function claimable(f) return OperatorRegistry.ClaimableFingerprintsToOperatorAddresses[f] end
local function outData(base) return base.results and base.results.output and base.results.output.data or '' end
local function has(s, sub) return type(s) == 'string' and string.find(s, sub, 1, true) ~= nil end

do local FP, base = fp('A'), newBase()
  compute(base, assign('Admin-Submit-Operator-Certificates', OWNER, certs({ { f = FP, a = ADDR, hw = false } })))
  check('owner submit mutates state', claimable(FP) == ADDR_STORED)
  check('reply + patch projected onto base', base.claimable_fingerprints_to_operator_addresses ~= nil)
end

do local FP, base = fp('D'), newBase()
  compute(base, assign('Admin-Submit-Operator-Certificates', ATTACKER, certs({ { f = FP, a = ADDR, hw = false } })))
  check('non-owner denied', has(outData(base), 'Permission Denied'))
  check('non-owner no mutation', claimable(FP) == nil)
end

do local FP, base = fp('E'), newBase()
  compute(base, assign('Admin-Submit-Operator-Certificates', ATTACKER,
    certs({ { f = FP, a = ADDR, hw = false } }), { ['from-process'] = OWNER }))
  check('A11 forged from-process denied', has(outData(base), 'Permission Denied'))
  check('A11 no mutation', claimable(FP) == nil)
end

do local GOOD, base = fp('1'), newBase()
  compute(base, assign('Admin-Submit-Operator-Certificates', OWNER,
    certs({ { f = GOOD, a = ADDR, hw = false }, { f = 'BAD', a = ADDR, hw = false } })))
  check('atomicity: batch errors', has(outData(base), 'Invalid'))
  check('atomicity: partial mutation reverted', claimable(GOOD) == nil)
end

do local FP, base = fp('F'), newBase()
  compute(base, assign('Admin-Submit-Operator-Certificates', nil, certs({ { f = FP, a = ADDR } })))
  check('unsigned rejected', has(outData(base), 'unsigned'))
end

return { pass = pass, fail = fail, failures = failures }
