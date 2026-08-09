--- Tier-1 busted spec — the allowlist on relay-rewards and staking-rewards.
---
--- These two get the allowlist entirely from the RUNTIME half: the process Owner and every ACL
--- role holder. They deliberately declare NO `writers` hook, and that omission is a decision
--- worth a test rather than an absence:
---
---   `Set-Delegate` and `Set-Share` write `ctx.from`'s own entry with NO precondition, so
---   `Configuration.Delegates` and `Shares` accumulate an entry for ANY address that has ever
---   called them — real operator or not. That is the unbounded-map vector, and seeding an
---   allowlist from those maps would launder every one of those addresses into permanent write
---   access. Real operators reach these contracts through operator-registry's allowlist instead
---   (the gate falls through to it), which is the only place operator status is actually
---   established.
---
--- So the assertions below are as much about what must NOT be listed as what must.

local HERE = debug.getinfo(1, 'S').source:match('^@(.*/)') or './'
local AO = HERE .. '../..'
local CT, RT = AO .. '/src/contracts', AO .. '/runtime'
local C, V   = CT .. '/common', RT .. '/vendor'

local function freshEnv(contractFile)
  for _, m in ipairs({ 'json', '.json', '.common.errors', '.common.utils', '.common.eip55',
                       '.common.bigint' }) do
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
  native.register(loadmod(CT .. '/native/' .. contractFile))
  native.reset()               -- state lives in globals; clear it per test
  return native
end

for _, contract in ipairs({ 'relay-rewards', 'staking-rewards' }) do
  describe('allowlist on ' .. contract, function()
    local native, json
    local OWNER = '0x' .. string.rep('1', 40)
    local ALICE = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'
    local RANDO = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'

    local function commit(c)
      return { c1 = { ['commitment-device'] = 'ans104@1.0', committer = c } }
    end
    local function assign(action, committer, data)
      return { body = {
        action = action, tags = { { name = 'Action', value = action } }, data = data,
        commitments = committer and commit(committer) or nil,
      } }
    end
    -- This file loops over BOTH reward contracts, so it cannot name the root global
    -- literally — native.stateRoot() dereferences whichever one is registered.
    local function newBase()
      native.reset()
      native.setACL({ roles = {} })
      return { process = { id = 'PID', commitments = commit(OWNER) } }
    end
    local function listed(b, a) return b.allowlistTable and b.allowlistTable[a] or nil end

    before_each(function()
      native = freshEnv(contract .. '.lua')
      json = require('json')
    end)

    it('declares no writers hook (state must not confer write access here)', function()
      assert.is_nil(native._contract.writers)
    end)

    it('seeds the process Owner', function()
      local b = newBase()
      native.compute(b, assign('Unknown-Action', OWNER))
      assert.equal('1', listed(b, OWNER))
    end)

    it('seeds ACL role holders from the migration envelope', function()
      local b = newBase()
      native.acl().roles = { ['Complete-Round'] = { [ALICE] = true },
                      ['Claim-Rewards']  = { [ALICE] = true } }
      native.compute(b, assign('Unknown-Action', OWNER))
      assert.equal('2', listed(b, ALICE))
    end)

    it('grants and revokes on Update-Roles like any other contract', function()
      local b = newBase()
      native.compute(b, assign('Update-Roles', OWNER,
        json.encode({ Grant = { [ALICE] = { 'admin' } } })))
      assert.equal('1', listed(b, ALICE))
      native.compute(b, assign('Update-Roles', OWNER,
        json.encode({ Revoke = { [ALICE] = { 'admin' } } })))
      assert.is_nil(listed(b, ALICE))
    end)

    it('does NOT list an address merely present in contract state', function()
      -- The decision this file exists for. An address with a Delegates/Shares entry got there by
      -- calling an open action with no precondition; it is not evidence of anything.
      local b = newBase()
      native.compute(b, assign('Unknown-Action', OWNER))   -- force init + seed
      if contract == 'relay-rewards' then
        native.stateRoot().Configuration.Delegates[RANDO] = { Address = ALICE, Share = 0.1 }
      else
        native.stateRoot().Shares[RANDO] = 0.1
      end
      native.compute(b, assign('Unknown-Action', OWNER))
      assert.is_nil(listed(b, RANDO))
    end)
  end)
end
