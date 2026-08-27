--- Tier-1 busted spec — runtime/write-gate.lua, the node-side write gate.
---
--- The gate's decision logic deserves unit tests independently of a node, because every one of
--- its failure modes looks identical from outside: dev_p4 reports "Could not estimate price of
--- request." -> HTTP 400 whether the gate legitimately refused, threw, or failed to load. An
--- end-to-end run tells you the gate said no; only these tell you it said no for the right
--- reason.
---
--- Covered here: committer extraction, target selection, the allowlist value grammar, and the
--- bundler carve-out. The
--- resolve-backed parts (`isOwner`, `listed`) need a node and are Tier-3's job — see
--- scripts/probe/allowlist-tier3.ts and scripts/probe/p4-gate-e2e.ts.

local HERE = debug.getinfo(1, 'S').source:match('^@(.*/)') or './'
local RT = HERE .. '../../runtime'

local function load_gate()
  for _, g in ipairs({ 'ao', 'estimate', 'price' }) do _G[g] = nil end
  return assert(loadfile(RT .. '/write-gate.lua'))()
end

describe('write-gate', function()
  local gate
  local PID_A = 'X64wpqyeyCHkIZPpPoJ6j7vTHfAXVXlcu7vcDnG3XhU'
  local PID_B = 'cY3QLnZKZOX-r9vNQguQvD3-Ek9Y5duCbIBUgOXsLVk'
  local ALICE = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'

  before_each(function() gate = load_gate() end)

  describe('committersOf', function()
    it('takes the committer from an ans104 commitment', function()
      local s, n = gate.committersOf({ commitments = {
        c1 = { ['commitment-device'] = 'ans104@1.0', committer = ALICE } } })
      assert.equal(1, n)
      assert.equal(ALICE, s[1])
    end)

    it('SKIPS an hmac commitment, which carries no committer', function()
      -- Every message picks up an hmac-sha256 commitment. Counting it as a signer would make an
      -- unsigned request look signed — and the unsigned path is the one that must deny.
      local s, n = gate.committersOf({ commitments = {
        h = { ['commitment-device'] = 'httpsig@1.0', type = 'hmac-sha256' } } })
      assert.equal(0, n)
    end)

    it('ignores a self-declared owner/from field', function()
      -- Only the node-verified `committer` counts. This is the A11 forgery.
      local s, n = gate.committersOf({ owner = ALICE, from = ALICE, commitments = {} })
      assert.equal(0, n)
    end)

    it('returns every signer on a multiply-signed request', function()
      local s, n = gate.committersOf({ commitments = {
        a = { ['commitment-device'] = 'ans104@1.0', committer = ALICE },
        b = { ['commitment-device'] = 'ans104@1.0', committer = '0xdead' } } })
      assert.equal(2, n)
    end)

    it('treats a message with no commitments as unsigned', function()
      assert.equal(0, select(2, gate.committersOf({})))
      assert.equal(0, select(2, gate.committersOf(nil)))
    end)
  end)

  describe('configuredIds', function()
    it('reads a list from node config', function()
      local ids = gate.configuredIds({ ['gated-processes'] = { PID_A, PID_B } })
      assert.is_true(ids[PID_A] and ids[PID_B])
    end)

    it('accepts a bare string for a single-contract node', function()
      assert.is_true(gate.configuredIds({ ['gated-processes'] = PID_A })[PID_A])
    end)

    it('is empty when unconfigured, which refuses everything', function()
      -- Fail-closed by construction: a missing config denies rather than admits.
      assert.same({}, gate.configuredIds({}))
      assert.same({}, gate.configuredIds(nil))
    end)
  end)

  describe('targetOf', function()
    local ids
    before_each(function() ids = { [PID_A] = true, [PID_B] = true } end)

    it('matches a gated id at the start of the path', function()
      assert.equal(PID_A, gate.targetOf('/' .. PID_A .. '~process@1.0/push', ids))
    end)

    it('matches without a leading slash', function()
      assert.equal(PID_A, gate.targetOf(PID_A .. '~process@1.0/push', ids))
    end)

    it('does NOT match an id that merely appears later in the path', function()
      -- A substring test would select a contract here, aiming the gate at the wrong allowlist.
      assert.is_nil(gate.targetOf('/other~process@1.0/push?ref=' .. PID_A, ids))
    end)

    it('does not match an ungated process', function()
      assert.is_nil(gate.targetOf('/' .. 'Sa0iBLPNyJQrwpTTG-tWLQU-1QeUAJlxuTakXQhSPMU'
        .. '~process@1.0/push', ids))
    end)

    it('returns nil for a non-string path rather than throwing', function()
      -- estimate() must never throw: dev_p4 turns any error into the same opaque 400.
      assert.is_nil(gate.targetOf(nil, ids))
      assert.is_nil(gate.targetOf(42, ids))
    end)
  end)

  describe('admits (allowlist value grammar)', function()
    it('admits a positive refcount', function()
      assert.is_true(gate.admits('1'))
      assert.is_true(gate.admits('415'))
    end)

    it('refuses the empty string, which is how a delete is stored', function()
      -- dev_trie has no delete, so a revoked address is written as ''. Reading that as present
      -- would mean revocation silently does not revoke.
      assert.is_false(gate.admits(''))
    end)

    it('refuses a blocked address however many reasons it holds', function()
      assert.is_false(gate.admits('B1'))
      assert.is_false(gate.admits('B415'))
      assert.is_false(gate.admits('B0'))
    end)

    it('refuses a zero count', function()
      assert.is_false(gate.admits('0'))
    end)

    it('refuses a missing value', function()
      assert.is_false(gate.admits(nil))
      assert.is_false(gate.admits(false))
    end)

    it('refuses a non-numeric value rather than admitting on truthiness', function()
      assert.is_false(gate.admits('yes'))
      assert.is_false(gate.admits('true'))
    end)
  end)

  describe('bundler carve-out', function()
    local NODE = 'pjg-wjvIRYF6EWaJHliNFMAIiD2HnZpg34FZdilLj2M'
    local OTHER = 'EbD49sHTtVM3POcTmJBHBvuVzVJjwY6_rW2y0WvWPK0'

    describe('isBundlerPath', function()
      it('matches the device, with or without a leading slash', function()
        assert.is_true(gate.isBundlerPath('/~bundler@1.0/tx'))
        assert.is_true(gate.isBundlerPath('~bundler@1.0/tx'))
        assert.is_true(gate.isBundlerPath('/~bundler@1.0'))
      end)

      it('does NOT match the device appearing later in the path', function()
        -- A substring match here would let any request select the carve-out by naming the device
        -- in a query parameter or a nested segment, which is the whole point of prefix-comparing.
        assert.is_false(gate.isBundlerPath('/' .. PID_A .. '~process@1.0/push?x=~bundler@1.0/tx'))
        assert.is_false(gate.isBundlerPath('/foo/~bundler@1.0/tx'))
      end)

      it('does not match a different device with the same prefix', function()
        assert.is_false(gate.isBundlerPath('/~bundler@1.0x/tx'))
        assert.is_false(gate.isBundlerPath('/~bundlerX@1.0/tx'))
      end)

      it('is false for a non-string path', function()
        assert.is_false(gate.isBundlerPath(nil))
        assert.is_false(gate.isBundlerPath(42))
      end)
    end)

    local function estimateFor(base, path, committers)
      local commitments = {}
      for i, c in ipairs(committers) do
        commitments['c' .. i] = { ['commitment-device'] = 'ans104@1.0', committer = c }
      end
      return select(2, estimate(base, { request = { path = path, commitments = commitments } }, {}))
    end

    it('admits a listed bundler wallet on the bundler path', function()
      local base = { ['bundler-wallets'] = { NODE }, ['gated-processes'] = { PID_A } }
      assert.equal(0, estimateFor(base, '/~bundler@1.0/tx', { NODE }))
    end)

    it('REFUSES a bundler wallet anywhere else', function()
      -- The entire reason this is not `deploy-wallets`: the node key must not gain contract
      -- write access as a side effect of being allowed to upload its own data.
      local base = { ['bundler-wallets'] = { NODE }, ['gated-processes'] = { PID_A } }
      assert.equal('infinity', estimateFor(base, '/' .. PID_A .. '~process@1.0/push', { NODE }))
      assert.equal('infinity', estimateFor(base, '/push', { NODE }))
    end)

    it('REFUSES a stranger on the bundler path', function()
      local base = { ['bundler-wallets'] = { NODE }, ['gated-processes'] = { PID_A } }
      assert.equal('infinity', estimateFor(base, '/~bundler@1.0/tx', { OTHER }))
    end)

    it('REFUSES when a stranger co-signs alongside a listed wallet', function()
      local base = { ['bundler-wallets'] = { NODE }, ['gated-processes'] = { PID_A } }
      assert.equal('infinity', estimateFor(base, '/~bundler@1.0/tx', { NODE, OTHER }))
    end)

    it('REFUSES the bundler path when the key is absent entirely', function()
      -- Unset must not fail open: stage and live carry no `bundler-wallets` today.
      assert.equal('infinity', estimateFor({ ['gated-processes'] = { PID_A } }, '/~bundler@1.0/tx', { NODE }))
    end)

    it('still refuses an UNSIGNED bundler request', function()
      local base = { ['bundler-wallets'] = { NODE } }
      assert.equal('infinity', estimateFor(base, '/~bundler@1.0/tx', {}))
    end)

    it('leaves deploy-wallets passing everywhere, unchanged', function()
      local base = { ['deploy-wallets'] = { ALICE }, ['gated-processes'] = { PID_A } }
      assert.equal(0, estimateFor(base, '/~bundler@1.0/tx', { ALICE }))
      assert.equal(0, estimateFor(base, '/push', { ALICE }))
    end)
  end)

end)
