--- operator-registry.lua — D26 NATIVE SHAPE (pilot).
---
--- Declares `{ state, actions, views }` for the native runtime (runtime/native.lua),
--- which owns identity, trust, ACL, Owner set-once, atomicity and dispatch. This module
--- carries ONLY the operator-registry domain logic.
---
--- Frozen from the legacynet contract (byte-for-byte behavior preserved): every
--- validation assert, error message, the registration-credit flow, and the "don't remove
--- reg credits on claim" behavior are identical to src/contracts/operator-registry.lua.
--- DELIBERATE DEVIATION — address form: legacynet stored `0x`+ALLCAPS (a keccak-free case
--- fold, dev-velocity tech debt). We now store EIP-55 checksummed addresses. Every UNTRUSTED
--- address ingress (admin cert `a`, Block/Unblock/credit `Address`) is run through
--- `eip55.checksum` (on-chain keccak): it validates format, REJECTS a mixed-case bad checksum
--- (on-chain typo detection), and returns the canonical form — so state is uniformly EIP-55 and
--- comparisons are exact string matches. `ctx.from` is trusted verbatim (the node hands it
--- already EIP-55, D6). This unifies the previously-inconsistent Block form. Reshaped (dropped): the Handlers
--- registry + tag-matching, the `patch@1.0` sends, the `*-Response` sends, and the
--- View-*/List-*/Get-* read handlers (now `views`). Update-Roles/View-Roles moved to the
--- runtime built-ins (they were byte-identical across all contracts).
---
--- Ledger (legacynet Action → native): see docs/hyperbeam-migration/D26-native-contract-shape.md.

local utils  = require('.common.utils')
local errors = require('.common.errors')
local eip55  = require('.common.eip55')
local json   = require('json')

--- Frozen from OperatorRegistry._addVerifiedHardwareFingerprint.
local function addVerifiedHardwareFingerprint(state, fingerprint)
  utils.assertValidFingerprint(fingerprint)
  assert(state.verifiedHardware[fingerprint] == nil, errors.DuplicateFingerprint)
  state.verifiedHardware[fingerprint] = true
end

return {
  name = 'operator-registry',
  -- State root: the Lua global holding state (D31/D32). Restores the legacynet global name.
  root = 'OperatorRegistry',

  -- Single source of truth at the `OperatorRegistry` global. Read ONLY through views
  -- (`as/<view>`) — a data global is not reachable by path.
  state = {
    claimable                   = {},     -- [fingerprint] = operatorAddress (assigned, unclaimed)
    verified                    = {},     -- [fingerprint] = operatorAddress (claimed)
    blocked                     = {},     -- [address]     = true
    verifiedHardware            = {},     -- [fingerprint] = true
    registrationCredits         = {},     -- [fingerprint] = operatorAddress
    registrationCreditsRequired = false,
  },

  -- ------------------------------------------------------------------------
  -- WRITES. `ctx.from` = verified committer; `ctx.state` = mutable state tree;
  -- `ctx.tags` = title-case tags; `ctx.data` = raw message data. Handler return is the
  -- compute output. A thrown assert reverts state atomically (runtime).
  -- ------------------------------------------------------------------------
  actions = {
    ['Admin-Submit-Operator-Certificates'] = {
      roles = { 'owner', 'admin', 'Admin-Submit-Operator-Certificates' },
      handler = function(ctx)
        assert(ctx.data, errors.OperatorCertificatesRequired)
        local certs = json.decode(ctx.data)
        for _, cert in ipairs(certs) do
          local fingerprint = cert['f']
          local address     = cert['a']
          local hw          = cert['hw']

          utils.assertValidFingerprint(fingerprint)
          -- Validate + canonicalize to EIP-55 on-chain (rejects a mixed-case bad checksum).
          local addr = eip55.checksum(address)
          -- A fingerprint is ONE reason to be allowed. Re-assigning it to a different operator
          -- moves that reason rather than creating a second one, or the previous holder keeps
          -- write access to a certificate they no longer have.
          local prev = ctx.state.claimable[fingerprint]
          if prev ~= addr then
            if prev then ctx.disallow(prev) end
            ctx.allow(addr)
          end
          ctx.state.claimable[fingerprint] = addr

          if hw then
            addVerifiedHardwareFingerprint(ctx.state, fingerprint)
          end
        end
        return 'OK'
      end,
    },

    -- Open action (any signed operator); gated by state, not a role.
    ['Submit-Fingerprint-Certificate'] = function(ctx)
      assert(ctx.state.blocked[ctx.from] == nil, errors.AddressIsBlocked)

      local fingerprint = ctx.tags['Fingerprint-Certificate']
      utils.assertValidFingerprint(fingerprint, errors.InvalidCertificate)

      -- ctx.from is the node-verified committer, already EIP-55 checksummed (D6). Use it
      -- verbatim; claimable holds the admin-assigned EIP-55 address, so this is an exact match.
      local address = ctx.from

      assert(
        ctx.state.claimable[fingerprint] == address,
        errors.InvalidCertificate
      )

      if (
        ctx.state.registrationCreditsRequired == true and
        ctx.state.verifiedHardware[fingerprint] ~= true
      ) then
        assert(
          ctx.state.registrationCredits[fingerprint] == address,
          errors.RegistrationCreditRequired
        )
      end

      ctx.state.verified[fingerprint] = address
      -- NB: Don't remove registration credits on claim.
      ctx.state.claimable[fingerprint] = nil
      -- The fingerprint moves claimable -> verified for the SAME address, so the reason count
      -- is unchanged. Written explicitly rather than skipped so every fingerprint transition
      -- goes through the same paired revoke/grant and none can be forgotten.
      ctx.disallow(address)
      ctx.allow(address)

      return 'OK'
    end,

    ['Renounce-Fingerprint-Certificate'] = function(ctx)
      local fingerprint = ctx.tags['Fingerprint']
      assert(type(fingerprint) == 'string', errors.FingerprintRequired)
      utils.assertValidFingerprint(fingerprint)
      local address = ctx.from   -- node-verified committer, already EIP-55 (D6)
      assert(
        ctx.state.verified[fingerprint] == address,
        errors.OnlyRelayOperatorCanRenounce
      )

      ctx.state.verified[fingerprint] = nil
      ctx.disallow(address)
      return 'OK'
    end,

    ['Remove-Fingerprint-Certificate'] = {
      roles = { 'owner', 'admin', 'Remove-Fingerprint-Certificate' },
      handler = function(ctx)
        local fingerprint = ctx.tags['Fingerprint']
        assert(type(fingerprint) == 'string', errors.FingerprintRequired)
        assert(string.len(fingerprint) == 40, errors.InvalidCertificate)

        -- Read the holder BEFORE clearing — afterwards there is nothing to revoke against,
        -- and the operator would keep write access to a certificate they no longer hold.
        local prev = ctx.state.verified[fingerprint]
        ctx.state.verified[fingerprint] = nil
        if prev then ctx.disallow(prev) end
        return 'OK'
      end,
    },

    ['Block-Operator-Address'] = {
      roles = { 'owner', 'admin', 'Block-Operator-Address' },
      handler = function(ctx)
        local address = ctx.tags['Address']
        assert(type(address) == 'string', errors.AddressRequired)

        local addr = eip55.checksum(address)
        ctx.state.blocked[addr] = true
        -- Blocking must also close the WRITE GATE. A veto, not a revoke: the address may still
        -- hold roles or verified fingerprints, and decrementing would leave it able to write.
        ctx.block(addr)
        return 'OK'
      end,
    },

    ['Unblock-Operator-Address'] = {
      roles = { 'owner', 'admin', 'Unblock-Operator-Address' },
      handler = function(ctx)
        local address = ctx.tags['Address']
        assert(type(address) == 'string', errors.AddressRequired)
        local addr = eip55.checksum(address)
        assert(ctx.state.blocked[addr] ~= nil, errors.AddressIsNotBlocked)

        ctx.state.blocked[addr] = nil
        ctx.unblock(addr)
        return 'OK'
      end,
    },

    ['Add-Registration-Credit'] = {
      roles = { 'owner', 'admin', 'Add-Registration-Credit' },
      handler = function(ctx)
        assert(type(ctx.tags['Address']) == 'string', errors.AddressRequired)
        local address = eip55.checksum(ctx.tags['Address'])   -- validate + canonicalize

        local fingerprint = ctx.tags['Fingerprint']
        assert(type(fingerprint) == 'string', errors.FingerprintRequired)
        utils.assertValidFingerprint(fingerprint)

        assert(
          ctx.state.registrationCredits[fingerprint] == nil,
          errors.RegistrationCreditAlreadyAdded
        )

        ctx.state.registrationCredits[fingerprint] = address
        return 'OK'
      end,
    },

    ['Remove-Registration-Credit'] = {
      roles = { 'owner', 'admin', 'Remove-Registration-Credit' },
      handler = function(ctx)
        local address = ctx.tags['Address']
        assert(type(address) == 'string', errors.AddressRequired)
        eip55.checksum(address)   -- validate format + checksum (removal is by fingerprint)

        local fingerprint = ctx.tags['Fingerprint']
        assert(type(fingerprint) == 'string', errors.FingerprintRequired)
        utils.assertValidFingerprint(fingerprint)

        assert(
          ctx.state.registrationCredits[fingerprint] ~= nil,
          errors.RegistrationCreditDoesNotExist
        )

        ctx.state.registrationCredits[fingerprint] = nil
        return 'OK'
      end,
    },

    ['Add-Verified-Hardware'] = {
      roles = { 'owner', 'admin', 'Add-Verified-Hardware' },
      handler = function(ctx)
        local fingerprints = ctx.data
        assert(type(fingerprints) == 'string', errors.FingerprintsRequired)

        for _, fingerprint in ipairs(utils.split(fingerprints, ',')) do
          addVerifiedHardwareFingerprint(ctx.state, fingerprint)
        end
        return 'OK'
      end,
    },

    ['Remove-Verified-Hardware'] = {
      roles = { 'owner', 'admin', 'Remove-Verified-Hardware' },
      handler = function(ctx)
        local fingerprints = ctx.data
        assert(type(fingerprints) == 'string', errors.FingerprintsRequired)

        for _, fingerprint in ipairs(utils.split(fingerprints, ',')) do
          utils.assertValidFingerprint(fingerprint)
          assert(
            ctx.state.verifiedHardware[fingerprint] ~= nil,
            errors.UnknownFingerprint
          )
          ctx.state.verifiedHardware[fingerprint] = nil
        end
        return 'OK'
      end,
    },

    -- NB: no `Init` action. Migration state is seeded as the module's declared initial
    -- `state` at spawn (migrate-on-spawn), validated in deploy tooling — there is no
    -- runtime bulk-load/set-once step. See docs/hyperbeam-migration/D26.
  },

  -- ------------------------------------------------------------------------
  -- READS — consumption-shaped views, served at `now/as/<name>?<params>` (GET-first).
  -- Per-entity direct reads (`now/verified/<fp>`, `now/blocked/<addr>`,
  -- `now/hardware/<fp>`) and whole maps (`now/verified`) come FREE from base-addressing
  -- and need no function here. These are the computed/bundled reads consumers actually
  -- use (see the consumer read-surface survey), replacing the legacynet List-*/Info
  -- round-trips and the full-`View-State` over-fetch.
  -- ------------------------------------------------------------------------
  -- Migration seed for the write gate's allowlist. Called ONCE, on the first slot, alongside
  -- the runtime's own seeding of the Owner and ACL role holders.
  --
  -- A fingerprint held in `claimable` counts exactly as much as one in `verified`: an operator's
  -- FIRST action is Submit-Fingerprint-Certificate against a claimable fingerprint an admin
  -- assigned them, so if claimable did not count they could never make that first write and
  -- could never become verified. That is the whole bootstrapping path.
  writers = function(state, al)
    for _, addr in pairs(state.claimable or {}) do al.allow(addr) end
    for _, addr in pairs(state.verified or {}) do al.allow(addr) end
    -- Blocked is a veto that survives however many fingerprints the address holds.
    for addr in pairs(state.blocked or {}) do al.block(addr) end
  end,

  views = {
    -- One operator's whole footprint by address — replaces downloading the entire
    -- registry just to filter to one address (the dashboard's hottest over-fetch).
    -- Returns fingerprint SETs ({[fp]=true}), not arrays: HyperBEAM's message model is
    -- map-oriented, so a returned bare Lua array serializes to nothing on-device.
    operator = function(s, p)
      -- Canonicalize the query to EIP-55 so any-case input matches stored (canonical) addresses.
      -- pcall: a malformed/bad-checksum query yields an empty footprint, not a view error.
      if not (p and p.address) then return nil end
      local ok, addr = pcall(eip55.checksum, p.address)
      if not ok then return nil end
      local out = { address = addr, blocked = s.blocked[addr] == true,
                    verified = {}, claimable = {}, hardware = {}, registrationCredits = {} }
      for fp, a in pairs(s.verified) do
        if a == addr then out.verified[fp] = true
          if s.verifiedHardware[fp] then out.hardware[fp] = true end end
      end
      for fp, a in pairs(s.claimable) do
        if a == addr then out.claimable[fp] = true
          if s.verifiedHardware[fp] then out.hardware[fp] = true end end
      end
      -- ADDED for the dashboard (2026-08-09). Its `get_relay_info_for_address` returns
      -- claimable/verified/registrationCredits/verifiedHardware for one operator; this view
      -- already covered the first three under different names, so only credits were missing.
      -- Additive on purpose — nothing that reads this view today sees a changed shape.
      for fp, a in pairs(s.registrationCredits) do
        if a == addr then out.registrationCredits[fp] = true end
      end
      return out
    end,

    -- Active operator addresses as a SET ({[addr]=true}, naturally deduped): unique
    -- verified minus blocked. Serves api-service's `/operators` (compute moved server-side).
    operators = function(s)
      local out = {}
      for _, a in pairs(s.verified) do
        if s.blocked[a] ~= true then out[a] = true end
      end
      return out
    end,

    -- The exact slice the reward runners + verifier need each round (was a full
    -- View-State pull that used only 2 of 5 maps).
    scoring = function(s)
      return { verified = s.verified, hardware = s.verifiedHardware }
    end,

    -- Batch fingerprint lookup (comma-separated) — one signed read instead of N.
    -- NB: the param is `ids`, NOT `fingerprints`. A query param whose name equals the view
    -- name shadows the on-device path resolution (`now/~lua@5.3a/fingerprints?fingerprints=…`
    -- returns the raw param string instead of invoking the view) — see D26. A view param must
    -- never share the view's name.
    fingerprints = function(s, p)
      local out = {}
      if p and p.ids then
        for _, fp in ipairs(utils.split(p.ids, ',')) do
          out[fp] = { verified = s.verified[fp], claimable = s.claimable[fp],
                      hardware = s.verifiedHardware[fp] == true }
        end
      end
      return out
    end,

    -- Operational visibility. Also the liveness/wedge probe: if this answers, the
    -- process is alive and computing. Runtime enriches with owner/version/name.
    status = function(s)
      local function count(t) local n = 0; for _ in pairs(t) do n = n + 1 end; return n end
      return {
        registrationCreditsRequired = s.registrationCreditsRequired,
        counts = {
          claimable = count(s.claimable),
          verified  = count(s.verified),
          blocked   = count(s.blocked),
          hardware  = count(s.verifiedHardware),
          credits   = count(s.registrationCredits),
        },
      }
    end,

    -- NB: no `dump` view here. The runtime owns it (native.view / D32 §1) so the admin +
    -- seed-diff escape hatch exists even if a bad deploy breaks the contract's own views —
    -- under globals there is no base-addressed path to fall back on. register() rejects a
    -- contract that declares one.
  },
}
