--- staking-rewards.lua — D26 NATIVE SHAPE.
---
--- Declares `{ state, actions, views }` for the native runtime (runtime/native.lua), which owns
--- identity, trust, ACL, Owner set-once, atomicity and dispatch. This module carries ONLY the
--- staking-rewards domain logic.
---
--- FROZEN reward math: the economic computation in `Complete-Round` is copied byte-for-byte from
--- the legacynet contract (src/contracts/staking-rewards.lua). The port only reshapes the WRAPPER
--- (Handlers → native actions; `StakingRewards.X` → `ctx.state.X`; `msg` → `ctx`) — the numbers
--- must not move.
---
--- SHAPE NOTE: every reward map here is logically a (hodler, operator) PAIR map. Legacynet
--- nested them two levels deep; D32 FLATTENED the storage to `[hodler .. '/' .. operator]`, and
--- `PreviousRound.Details` to parallel typed maps, because the nested form cost 3,336 live Lua
--- tables and luerl's GC mark phase is quadratic in that count. See the pair-key section below.
--- An operator's own earnings still live at the self-key, now `Rewarded[operator/operator]`.
---
--- The flattening is STORAGE ONLY. Every view reassembles the original nested shape, so the
--- legacynet read payloads are unchanged — pinned by `spec/fixtures/staking-view-golden.json`,
--- captured from the real dump and re-checked with `scripts/staking-view-golden.ts --check`.
---
--- DELIBERATE DEVIATIONS from legacynet:
---   * Addresses stored EIP-55 (was 0x+ALLCAPS via normalizeEvmAddress). Every untrusted address
---     ingress runs through `eip55.checksum` (validate + canonicalize), wrapped in pcall so the
---     legacynet error strings are preserved verbatim.
---   * `PreviousRound.Details` IS persisted here (decision 2026-07-25). Relay dropped its Details
---     because they were 3.6 MB of a 4 MB state; staking's whole state is ~322 KB (Details ~181 KB),
---     so the pressure does not exist and `Last-Snapshot`/`Last-Round-Data` stay plain views.
---   * A17: `PendingRounds` is keyed by the STRING timestamp (a large int key hangs the device VM).
---   * EMPTY HODLER ROWS ARE DROPPED (2026-08-09, deliberate — a consequence of the D32 pair-key
---     flattening). Legacynet's `Complete-Round` ran `if Rewarded[h] == nil then Rewarded[h] = {} end`
---     BEFORE the `bint.ispos` guard, so a hodler whose reward rounded to zero got an empty row
---     created and never filled. The live dump carries exactly 2 of them
---     (`0xD9595B16…`, `0x339075B3…`); neither appears in `Claimed` or `Details` — they hold
---     nothing. A map keyed by (hodler, operator) cannot represent a hodler with no pairs, so
---     they do not survive the migration. Two visible effects, both accepted:
---       · `status.counts.rewardedHodlers` reports 560 rather than 562
---       · `Claim-Rewards` on those 2 addresses now errors ('No rewards for …') instead of
---         returning an empty `{}` payload — they had nothing to claim either way
---     This code cannot create new ones: `Rewarded` is only written under `bint.ispos`.
---   * SHARE-DELAY UNIT FIX (2026-07-25, deliberate — NOT a frozen-math change): legacynet compared
---     `RequestedTimestamp + ChangeDelaySeconds <= roundTimestamp` where BOTH timestamps are
---     MILLISECONDS but the delay is denominated in SECONDS, making the 7-day (604800 s) default
---     elapse in 604800 ms ≈ 10.1 minutes. We multiply the delay to ms so the configured seconds are
---     honoured. Safe to fix in-place: the feature is dormant (live config `SetSharesEnabled=false`,
---     `Shares`/`PendingShareChanges` both empty, and `Set-Share` never appears in the live message
---     tail nor in any consumer repo). The config field keeps its name/units (seconds).
---   * Message time comes from `ctx.timestamp` (assignment `timestamp`, MILLISECONDS — the same unit
---     legacynet `msg.Timestamp` used). NEVER `block-timestamp` (Arweave seconds; 0 on a debug node).
---     See D8 "os.time / message time — RESOLVED".
---
--- ⚠ ACCEPTED LIMITATION — the share-delay clock (decision 2026-07-25, deliberate).
--- `RequestedTimestamp` is the SCHEDULER'S LOCAL WALL CLOCK (`erlang:system_time(millisecond)`;
--- "Local time on the SU, not Arweave"). It is signed into the assignment, so it is deterministic on
--- replay and cannot be forged by the sender — but it is NOT MONOTONIC (an NTP correction can step it
--- backwards, and the scheduler validates no ordering), and the delay gate in `Complete-Round`
--- compares it against `Round-Timestamp`, which comes from the CONTROLLER'S clock. So the gate spans
--- two independent clocks and host skew shifts the effective delay.
---
--- This is inherited from legacynet (which compared `msg.Timestamp` against `Round-Timestamp` the
--- same way), and it is kept ON PURPOSE to keep this a faithful port. The alternative — start the
--- delay at the first `Complete-Round` after the request and measure purely in round time, which the
--- backdating assert guarantees strictly increasing — was considered and NOT taken.
--- Why the residual risk is acceptable: we self-host the SU; a sender cannot influence the stamp;
--- the 7-day delay dwarfs any plausible host skew; and the feature is dormant today
--- (`SetSharesEnabled=false`). REVISIT the round-time design before enabling `SetSharesEnabled`.
---   * Dropped: Handlers registry + tag-matching, all `patch@1.0` sends, all `*-Response` sends,
---     `View-State` (base-addressing + `dump`), `Init` (migrate-on-spawn). Update-Roles/View-Roles
---     are runtime built-ins.

local utils  = require('.common.utils')
local errors = require('.common.errors')
local eip55  = require('.common.eip55')
local json   = require('json')
local bint   = require('.common.bigint')(256)

-- ===========================================================================
-- Pair keys — the D32 flattening (storage only; nothing consumer-visible moves)
-- ===========================================================================
--
-- Every reward map here used to be `[hodler][operator]`, which costs ONE LIVE LUA TABLE PER
-- HODLER. Under the globals state model that whole tree is marked on every GC, and luerl's mark
-- phase is quadratic in live table count, so this contract alone carried 3,336 tables against 6
-- for operator-registry. Measured on the real seed:
--
--     Rewarded        563 tables  ->  1     (562 hodler maps; values are strings)
--     Claimed         401 tables  ->  1     (400 hodler maps)
--     PreviousRound  2,365 tables ->  ~9    (451 hodler maps + 636 pair + 636 Score + 636 Reward)
--
-- `Rewarded`/`Claimed` are the ones that matter most: they grow FOREVER with the hodler x
-- operator pair count. `Details` is bounded to one round but was the largest single block,
-- because a composite key alone cannot remove the per-pair VALUE tables — hence the parallel
-- typed maps below rather than `Details[h/o] = { ... }`.
--
-- ⚠ The separator is safe because both halves are EIP-55 addresses (`0x` + 40 hex), which
-- cannot contain `/`. Do not reuse this scheme for a key that could.
--
-- ⚠ NOTHING a consumer sees changes. Every view reassembles the original nested shape, and
-- `spec/fixtures/staking-view-golden.json` pins that against the real legacynet dump.
local SEP = '/'

local function pairKey(hodler, operator) return hodler .. SEP .. operator end

local function splitPair(key)
  local i = string.find(key, SEP, 1, true)   -- plain find: luerl's pattern classes are a gap (A13)
  if not i then return nil end
  return string.sub(key, 1, i - 1), string.sub(key, i + 1)
end

--- Every entry for one hodler, as the `[operator] = value` map the legacy shape had.
--- Returns nil (not {}) when the hodler has none, because callers distinguish those:
--- `Claim-Rewards` asserts on it and the `claimed` view returns it verbatim.
local function forHodler(flat, hodler)
  local prefix = hodler .. SEP
  local plen = #prefix
  local out, found = {}, false
  for k, v in pairs(flat) do
    if string.sub(k, 1, plen) == prefix then
      out[string.sub(k, plen + 1)] = v
      found = true
    end
  end
  if not found then return nil end
  return out
end

--- Distinct hodlers in a flat map. `status.counts` reported HODLERS before the flattening and
--- must keep doing so — counting keys would silently start reporting PAIRS.
local function countHodlers(flat)
  local seen, n = {}, 0
  for k in pairs(flat) do
    local h = splitPair(k)
    if h ~= nil and not seen[h] then seen[h] = true; n = n + 1 end
  end
  return n
end

--- `PreviousRound.Details` is stored as parallel typed maps so a round costs a fixed ~7 tables
--- instead of 3 per pair. Values keep their Lua TYPES — `Running`/`Share` stay numbers rather
--- than being packed into a string, because float -> string -> float is not guaranteed to
--- round-trip identically under luerl and this port must stay byte-identical.
local function emptyDetails()
  return { Staked = {}, Restaked = {}, Running = {}, Share = {},
           Rating = {}, RewardHodler = {}, RewardOperator = {} }
end

--- Rebuild one pair's `{ Score, Rating, Reward }` record — the legacy shape, verbatim.
local function detailRecord(d, key)
  return {
    Score = { Staked = d.Staked[key], Restaked = d.Restaked[key],
              Running = d.Running[key], Share = d.Share[key] },
    Rating = d.Rating[key],
    Reward = { Hodler = d.RewardHodler[key], Operator = d.RewardOperator[key] },
  }
end

--- `Details[hodler]` as it used to look, or nil when the hodler was not in the round.
local function detailsForHodler(d, hodler)
  if type(d) ~= 'table' or type(d.Rating) ~= 'table' then return nil end
  local prefix = hodler .. SEP
  local plen = #prefix
  local out, found = {}, false
  for k in pairs(d.Rating) do
    if string.sub(k, 1, plen) == prefix then
      out[string.sub(k, plen + 1)] = detailRecord(d, k)
      found = true
    end
  end
  if not found then return nil end
  return out
end

--- The whole `Details` map in its original two-level shape, for `last_snapshot`.
local function detailsNested(d)
  if type(d) ~= 'table' or type(d.Rating) ~= 'table' then return {} end
  local out = {}
  for k in pairs(d.Rating) do
    local h, o = splitPair(k)
    if h ~= nil then
      if out[h] == nil then out[h] = {} end
      out[h][o] = detailRecord(d, k)
    end
  end
  return out
end

--- The per-operator relay counts as `{ [operator] = { Expected, Running, Found } }`.
---
--- Driven by `Expected`, not by the union of all three: an operator is in the round because the
--- registry expected relays of them, and a missing `Running`/`Found` means zero rather than
--- unknown. `or 0` therefore reports a real count instead of leaving a hole a consumer has to
--- guess at.
local function networkNested(n)
  if type(n) ~= 'table' or type(n.Expected) ~= 'table' then return {} end
  local out = {}
  for operator, expected in pairs(n.Expected) do
    out[operator] = {
      Expected = expected,
      Running = (n.Running or {})[operator] or 0,
      Found = (n.Found or {})[operator] or 0,
    }
  end
  return out
end

--- Validate + canonicalize an address, preserving a caller-supplied legacynet error message.
local function checksum(addr, message)
  local ok, out = pcall(eip55.checksum, addr)
  assert(ok, message)
  return out
end

--- Frozen from StakingRewards._updateConfiguration.
local function updateConfiguration(config, request)
  if request.TokensPerSecond then
    assert(type(request.TokensPerSecond) == 'string', 'TokensPerSecond must be a string number')
    local safeTokens = bint.tobint(request.TokensPerSecond)
    assert(safeTokens ~= nil, 'TokensPerSecond must be an integer')
    assert(bint.ispos(safeTokens), 'TokensPerSecond must be a positive value')
    config.TokensPerSecond = tostring(safeTokens)
  end
  if request.Requirements then
    if request.Requirements.Running then
      utils.assertNumber(request.Requirements.Running, 'Requirements.Running')
      assert(request.Requirements.Running >= 0, 'Requirements.Running has to be >= 0')
      assert(request.Requirements.Running <= 1, 'Requirements.Running has to be <= 1')
      config.Requirements.Running = request.Requirements.Running
    end
  end
  return config
end

--- Frozen from StakingRewards._updateSharesConfiguration. Validates Min/Max/Default/SetSharesEnabled/
--- ChangeDelaySeconds, cross-validates Min <= Default <= Max, then RETROACTIVELY CLAMPS every already
--- set operator share into the new bounds. Returns the map of shares it modified.
local function updateSharesConfiguration(config, request, shares)
  if request.SetSharesEnabled ~= nil then
    assert(type(request.SetSharesEnabled) == 'boolean', 'SetSharesEnabled must be a boolean')
    config.Shares.SetSharesEnabled = request.SetSharesEnabled
  end

  if request.ChangeDelaySeconds ~= nil then
    utils.assertInteger(request.ChangeDelaySeconds, 'ChangeDelaySeconds')
    assert(request.ChangeDelaySeconds >= 0, 'ChangeDelaySeconds has to be >= 0')
    config.Shares.ChangeDelaySeconds = request.ChangeDelaySeconds
  end

  local newMin = config.Shares.Min
  local newMax = config.Shares.Max
  local newDefault = config.Shares.Default

  if request.Min ~= nil then
    utils.assertNumber(request.Min, 'Min')
    assert(request.Min >= 0, 'Min has to be >= 0')
    assert(request.Min <= 1, 'Min has to be <= 1')
    newMin = request.Min
  end

  if request.Max ~= nil then
    utils.assertNumber(request.Max, 'Max')
    assert(request.Max >= 0, 'Max has to be >= 0')
    assert(request.Max <= 1, 'Max has to be <= 1')
    newMax = request.Max
  end

  if request.Default ~= nil then
    utils.assertNumber(request.Default, 'Default')
    assert(request.Default >= 0, 'Default has to be >= 0')
    assert(request.Default <= 1, 'Default has to be <= 1')
    newDefault = request.Default
  end

  assert(newMin <= newMax, 'Min must be <= Max')
  assert(newDefault >= newMin, 'Default must be >= Min')
  assert(newDefault <= newMax, 'Default must be <= Max')

  config.Shares.Min = newMin
  config.Shares.Max = newMax
  config.Shares.Default = newDefault

  local modifiedShares = {}
  for operatorAddress, share in pairs(shares) do
    local clampedShare = share
    if clampedShare < newMin then clampedShare = newMin end
    if clampedShare > newMax then clampedShare = newMax end
    if clampedShare ~= share then
      shares[operatorAddress] = clampedShare
      modifiedShares[operatorAddress] = clampedShare
    end
  end

  return modifiedShares
end

return {
  name = 'staking-rewards',
  -- State root: the Lua global holding state (D31/D32). Restores the legacynet global name.
  root = 'StakingRewards',

  -- Single source of truth at the `StakingRewards` global. Read ONLY through views (`as/<view>`);
  -- the base-addressed point reads this comment used to advertise
  -- (now/state/Rewarded/<hodler>/<operator>) no longer exist.
  --
  -- FLATTENED (D32) — see the pair-key section at the top of this file. Every reward map is
  -- keyed `hodler .. '/' .. operator` and `PreviousRound.Details` is parallel typed maps, so
  -- the whole contract holds a FIXED handful of live tables instead of 3,336 growing ones.
  -- Storage only: the views reassemble the original nested shape.
  state = {
    Claimed             = {},   -- [hodler/operator] = "bigint" (high-water mark at claim time)
    Rewarded            = {},   -- [hodler/operator] = "bigint" (cumulative; self-key = own cut)
    Shares              = {},   -- [operator] = float (only when the operator set one)
    PendingShareChanges = {},   -- [operator] = { Share = float, RequestedTimestamp = ms }
    Configuration = {
      TokensPerSecond = '100000000',
      Requirements = { Running = 0.5 },
      Shares = {
        Enabled = false,
        SetSharesEnabled = false,
        Min = 0.0,
        Max = 1.0,
        Default = 0.05,             -- 5% share default
        ChangeDelaySeconds = 604800, -- 7 days, in SECONDS (converted to ms at the gate)
      },
    },
    PreviousRound = {
      Timestamp = 0,
      Period = 0,
      Summary = { Rewards = '0', Ratings = '0', Stakes = '0' },
      Configuration = {},
      -- PERSISTED (see header). Parallel typed maps keyed [hodler/operator]; `last_snapshot`
      -- and `last_round_data` rebuild the `{ Score, Rating, Reward }` records.
      Details = { Staked = {}, Restaked = {}, Running = {}, Share = {},
                  Rating = {}, RewardHodler = {}, RewardOperator = {} },
      -- Per-OPERATOR relay counts for the round, keyed by operator address. Parallel typed maps
      -- for the same reason as `Details` above, though the pressure is far lower here: this is
      -- per operator, not per hodler/operator pair.
      --
      -- The controller already computes these to derive each pair's `Running` share, but that
      -- share is a lossy quotient — it cannot answer "3 of 5 relays up", and it is absent for an
      -- operator nobody has staked to. Carrying the counts in the round makes the network state
      -- part of the signed record instead of a side-channel, and it replaces the `staking/snapshot`
      -- Arweave publication the dashboard used to read.
      Network = { Expected = {}, Running = {}, Found = {} },
    },
    -- [tostring(Timestamp)] = { Staked/Running/Share = { [hodler/operator] = v } }. The
    -- timestamp stays the outer key (rounds in flight are few, and Cancel/Complete drop one by
    -- key); A17 still applies — it must be a STRING, never a large integer.
    PendingRounds = {},
  },

  -- ------------------------------------------------------------------------
  -- WRITES. `ctx.from` = verified committer; `ctx.state` = mutable state; `ctx.tags` = title-case
  -- tags; `ctx.data` = raw message data; `ctx.timestamp` = assignment time in ms. A thrown assert
  -- reverts state atomically (runtime).
  -- ------------------------------------------------------------------------
  actions = {
    ['Update-Configuration'] = {
      roles = { 'owner', 'admin', 'Update-Configuration' },
      handler = function(ctx)
        assert(ctx.data, errors.MessageDataRequired)
        local request = json.decode(ctx.data)
        assert(request, 'Failed to parse data')
        ctx.state.Configuration = updateConfiguration(ctx.state.Configuration, request)
        return 'OK'
      end,
    },

    ['Update-Shares-Configuration'] = {
      roles = { 'owner', 'admin', 'Update-Shares-Configuration' },
      handler = function(ctx)
        assert(ctx.data, errors.MessageDataRequired)
        local request = json.decode(ctx.data)
        assert(request, 'Failed to parse data')
        updateSharesConfiguration(ctx.state.Configuration, request, ctx.state.Shares)
        return 'OK'
      end,
    },

    ['Toggle-Feature-Shares'] = {
      roles = { 'owner', 'admin', 'Toggle-Feature-Shares' },
      handler = function(ctx)
        assert(ctx.data, errors.MessageDataRequired)
        local request = json.decode(ctx.data)
        assert(request, 'Failed to parse data')
        assert(type(request.Enabled) == 'boolean', 'Enabled must be a boolean')
        ctx.state.Configuration.Shares.Enabled = request.Enabled
        return 'OK'
      end,
    },

    -- Permissionless self-service: an operator (ctx.from) sets the Share of staking rewards they
    -- take from their delegators. Gated by BOTH feature flags. No ACL role (matches legacynet).
    ['Set-Share'] = function(ctx)
      local state = ctx.state
      assert(state.Configuration.Shares.Enabled, 'Shares feature is disabled')
      assert(state.Configuration.Shares.SetSharesEnabled, 'Operator share setting is disabled')
      local operatorAddress = ctx.from   -- node-verified committer, already EIP-55 (D6)

      assert(ctx.data, errors.MessageDataRequired)
      local request = json.decode(ctx.data)
      assert(request, 'Failed to parse data')

      utils.assertNumber(request.Share, 'Share')
      local minShare = state.Configuration.Shares.Min
      local maxShare = state.Configuration.Shares.Max
      assert(request.Share >= minShare, 'Share has to be >= ' .. minShare)
      assert(request.Share <= maxShare, 'Share has to be <= ' .. maxShare)

      local changeDelaySeconds = state.Configuration.Shares.ChangeDelaySeconds or 0
      if changeDelaySeconds > 0 then
        -- Queue the change, stamped with the assignment time (ms — see header/D8). NB: this is the
        -- SU's non-monotonic wall clock, and Complete-Round gates it against the controller's
        -- Round-Timestamp — two clocks. Faithful to legacynet, accepted deliberately; see the
        -- "ACCEPTED LIMITATION" note in the header before enabling SetSharesEnabled.
        state.PendingShareChanges[operatorAddress] = {
          Share = request.Share,
          RequestedTimestamp = ctx.timestamp,
        }
      else
        state.Shares[operatorAddress] = request.Share
      end

      return 'OK'
    end,

    ['Add-Scores'] = {
      roles = { 'owner', 'admin', 'Add-Scores' },
      handler = function(ctx)
        local state = ctx.state
        assert(ctx.data, errors.MessageDataRequired)
        local request = json.decode(ctx.data)
        assert(request, 'Failed to parse data')

        local timestamp = utils.parseInt(ctx.tags['Round-Timestamp'])
        assert(timestamp, 'Round-Timestamp tag must be a number')
        utils.assertInteger(timestamp, 'Round-Timestamp tag')
        assert(timestamp > 0, 'Round-Timestamp has to be > 0')
        assert(timestamp > state.PreviousRound.Timestamp, 'Round-Timestamp is backdated')
        local tsKey = tostring(timestamp)   -- A17: never a large int as a table key

        assert(type(request.Scores) == 'table', 'Scores have to be a table')

        -- validate-before-mutate: validate everything (canonicalizing addresses once) and only then
        -- stage. A thrown assert reverts, so a bad batch stages nothing.
        local canon = {}
        for hodlerAddress, scores in pairs(request.Scores) do
          local nHodlerAddress = checksum(hodlerAddress, 'Invalid Hodler Address:' .. tostring(hodlerAddress))
          if state.PendingRounds[tsKey] then
            -- Same rule as before the flattening — one Add-Scores per hodler per round. The
            -- hodler no longer has a map of their own, so this asks whether ANY pair of theirs
            -- is already staged.
            assert(forHodler(state.PendingRounds[tsKey].Staked, nHodlerAddress) == nil,
              'Duplicated score for ' .. nHodlerAddress)
          end
          canon[hodlerAddress] = { hodler = nHodlerAddress, ops = {} }
          for operatorAddress, score in pairs(scores) do
            local nOperatorAddress = checksum(operatorAddress,
              'Invalid Operator address: Scores[' .. hodlerAddress .. '][' .. operatorAddress .. ']')
            canon[hodlerAddress].ops[operatorAddress] = nOperatorAddress

            assert(type(score.Staked) == 'string', 'Scores[' .. hodlerAddress .. '][' .. operatorAddress .. '].Staked must be a string number')
            local staked = bint.tobint(score.Staked)
            assert(staked ~= nil, 'Scores[' .. hodlerAddress .. '][' .. operatorAddress .. '].Staked failed parsing to bint')
            assert(bint.ispos(staked), 'Scores[' .. hodlerAddress .. '][' .. operatorAddress .. '].Staked must be positive value')

            utils.assertNumber(score.Running, 'Scores[' .. hodlerAddress .. '][' .. operatorAddress .. '].Running')
            assert(score.Running >= 0, 'Scores[' .. hodlerAddress .. '][' .. operatorAddress .. '].Running has to be >= 0')
            assert(score.Running <= 1, 'Scores[' .. hodlerAddress .. '][' .. operatorAddress .. '].Running has to be <= 1')
          end
        end

        -- OPTIONAL per-operator relay counts. Optional on purpose: a round submitted by an older
        -- controller stages exactly as before rather than failing, so contract and controller can
        -- deploy in either order.
        --
        -- Keyed by OPERATOR, so unlike Scores it is not nested under a hodler — an operator with
        -- no stake at all still has relay counts worth recording, which is precisely the case the
        -- old `Running` quotient could not express.
        local canonNet = {}
        if request.Network ~= nil then
          assert(type(request.Network) == 'table', 'Network has to be a table')
          for operatorAddress, counts in pairs(request.Network) do
            local nOperatorAddress = checksum(operatorAddress,
              'Invalid Operator address: Network[' .. tostring(operatorAddress) .. ']')
            assert(type(counts) == 'table', 'Network[' .. operatorAddress .. '] must be a table')
            for _, field in ipairs({ 'Expected', 'Running', 'Found' }) do
              local label = 'Network[' .. operatorAddress .. '].' .. field
              utils.assertNumber(counts[field], label)
              -- parseInt, NOT assertInteger: luerl decodes JSON `5` as the FLOAT 5.0, and
              -- assertInteger rejects floats outright — so asserting integerness directly would
              -- fail on-device while passing under 5.3. parseInt folds a whole-valued float back
              -- to an integer and returns nil for a genuinely fractional count.
              local n = utils.parseInt(counts[field])
              assert(n ~= nil, label .. ' must be an integer')
              assert(n >= 0, label .. ' has to be >= 0')
            end
            canonNet[operatorAddress] = nOperatorAddress
          end
        end

        if state.PendingRounds[tsKey] == nil then
          state.PendingRounds[tsKey] = {
            Staked = {}, Running = {}, Share = {},
            NetExpected = {}, NetRunning = {}, NetFound = {},
          }
        end
        local pending = state.PendingRounds[tsKey]
        -- A round staged before this field existed has no Net* maps; create them on demand so an
        -- in-flight round upgraded mid-flight still completes.
        if pending.NetExpected == nil then
          pending.NetExpected, pending.NetRunning, pending.NetFound = {}, {}, {}
        end

        -- Last writer wins per operator, matching how a re-sent batch behaves elsewhere. These
        -- are counts of the same underlying relays, so a second submission is a correction rather
        -- than something to accumulate.
        for operatorAddress, counts in pairs(request.Network or {}) do
          local op = canonNet[operatorAddress]
          pending.NetExpected[op] = utils.parseInt(counts.Expected)
          pending.NetRunning[op]  = utils.parseInt(counts.Running)
          pending.NetFound[op]    = utils.parseInt(counts.Found)
        end

        for hodlerAddress, scores in pairs(request.Scores) do
          local nHodlerAddress = canon[hodlerAddress].hodler
          for operatorAddress, score in pairs(scores) do
            local nOperatorAddress = canon[hodlerAddress].ops[operatorAddress]
            -- Share is SNAPSHOTTED at scoring time: the operator's own share when they have set one
            -- and setting is enabled, else the configured Default. Never persisted into `Shares`.
            local share = 0.0
            if state.Configuration.Shares.Enabled then
              if state.Configuration.Shares.SetSharesEnabled and state.Shares[nOperatorAddress] ~= nil then
                share = state.Shares[nOperatorAddress]
              else
                share = state.Configuration.Shares.Default
              end
            end
            local key = pairKey(nHodlerAddress, nOperatorAddress)
            pending.Staked[key] = tostring(bint(score.Staked))
            pending.Running[key] = score.Running
            pending.Share[key] = share
          end
        end

        return 'OK'
      end,
    },

    -- The settlement. FROZEN reward math (verbatim from legacynet Complete-Round), plus the
    -- share-delay unit fix (see header).
    ['Complete-Round'] = {
      roles = { 'owner', 'admin', 'Complete-Round' },
      handler = function(ctx)
        local state = ctx.state
        local timestamp = utils.parseInt(ctx.tags['Round-Timestamp'])
        utils.assertInteger(timestamp, 'Round-Timestamp tag')
        local tsKey = tostring(timestamp)   -- A17
        assert(state.PendingRounds[tsKey], 'No pending round for ' .. timestamp)

        local summary = { Rewards = bint(0), Ratings = bint(0), Stakes = bint(0) }
        local roundData = {}

        -- Reads the flat pending maps and rebuilds the per-pair `score` the frozen math expects,
        -- so the arithmetic below is untouched. `roundData` stays NESTED on purpose: it is
        -- compute-local (garbage by the next collect), and keeping it means the two settlement
        -- loops that follow are byte-identical to legacynet.
        --
        -- ⚠ ITERATION ORDER CHANGES (one flat map instead of nested `pairs`), and that is safe
        -- ONLY because every accumulation here is exact bigint addition — commutative and
        -- associative, so the sums and the per-pair writes land on the same values whatever the
        -- order. Do not introduce a float accumulation or an order-sensitive step into this loop.
        local pending = state.PendingRounds[tsKey]
        for key, stakedStr in pairs(pending.Staked) do
          local hodlerAddress, operatorAddress = splitPair(key)
          local score = { Staked = stakedStr, Running = pending.Running[key], Share = pending.Share[key] }
          if roundData[hodlerAddress] == nil then roundData[hodlerAddress] = {} end

          local staked = bint(score.Staked)
          local restaked = bint(0)
          local rating = bint(0)
          if score.Running >= state.Configuration.Requirements.Running then
            local rewardedPrior = state.Rewarded[key]
            if rewardedPrior ~= nil then
              local claimedPrior = state.Claimed[key]
              if claimedPrior ~= nil then
                restaked = bint(rewardedPrior) - bint(claimedPrior)
              else
                restaked = bint(rewardedPrior)
              end
            end
            rating = staked + restaked
          end

          summary.Stakes = summary.Stakes + bint(score.Staked) + restaked
          summary.Ratings = summary.Ratings + rating

          roundData[hodlerAddress][operatorAddress] = {
            Score = {
              Staked = bint(score.Staked),
              Restaked = restaked,
              Running = score.Running,
              Share = score.Share
            },
            Rating = rating
          }
        end

        local roundLength = bint(0)
        if state.PreviousRound.Timestamp > 0 then
          local msInSec = 1000
          roundLength = bint((timestamp - state.PreviousRound.Timestamp) // msInSec)
        end

        local tokensPerSecond = bint(state.Configuration.TokensPerSecond)
        local totalRewardsPerRound = tokensPerSecond * roundLength
        local sharePrecision = bint(1000)
        for holderAddress, ratedData in pairs(roundData) do
          for operatorAddress, data in pairs(ratedData) do
            local reward = bint(0)
            if not bint.iszero(summary.Ratings) then
              reward = (totalRewardsPerRound * data.Rating) // summary.Ratings
            end
            local r = bint.trunc(data.Score.Share * bint.tonumber(sharePrecision)) * reward
            local operatorReward = r // sharePrecision

            roundData[holderAddress][operatorAddress].Reward = {
              Hodler = reward - operatorReward, Operator = operatorReward
            }

            summary.Rewards = summary.Rewards + reward
          end
        end

        -- Settle. Cumulative balances are keyed by pair now; the operator's own cut still lands
        -- on the SELF-KEY (`operator/operator`) and still accumulates across every hodler who
        -- staked with them, which is why this must read state fresh on each iteration.
        local details = emptyDetails()
        for hodlerAddress, ratedData in pairs(roundData) do
          for operatorAddress, data in pairs(ratedData) do
            local hodlerKey = pairKey(hodlerAddress, operatorAddress)
            local previousHodlerReward = bint(0)
            if state.Rewarded[hodlerKey] ~= nil then
              previousHodlerReward = bint(state.Rewarded[hodlerKey])
            end
            local hodlerReward = data.Reward.Hodler + previousHodlerReward
            if bint.ispos(hodlerReward) then
              state.Rewarded[hodlerKey] = tostring(hodlerReward)
            end

            local operatorKey = pairKey(operatorAddress, operatorAddress)
            local previousOperatorReward = bint(0)
            if state.Rewarded[operatorKey] ~= nil then
              previousOperatorReward = bint(state.Rewarded[operatorKey])
            end
            local operatorReward = data.Reward.Operator + previousOperatorReward
            if bint.ispos(operatorReward) then
              state.Rewarded[operatorKey] = tostring(operatorReward)
            end

            details.Staked[hodlerKey] = tostring(data.Score.Staked)
            details.Restaked[hodlerKey] = tostring(data.Score.Restaked)
            details.Running[hodlerKey] = data.Score.Running
            details.Share[hodlerKey] = data.Score.Share
            details.Rating[hodlerKey] = tostring(data.Rating)
            details.RewardHodler[hodlerKey] = tostring(data.Reward.Hodler)
            details.RewardOperator[hodlerKey] = tostring(data.Reward.Operator)
          end
        end

        state.PreviousRound = {
          Timestamp = timestamp,
          Period = bint.tonumber(roundLength),
          Summary = {
            Stakes = tostring(summary.Stakes),
            Ratings = tostring(summary.Ratings),
            Rewards = tostring(summary.Rewards)
          },
          Configuration = state.Configuration,
          Details = details,
          -- Carried verbatim from the pending round. `or {}` keeps a round staged by a controller
          -- that does not send Network completing normally, with empty counts rather than nil.
          Network = {
            Expected = pending.NetExpected or {},
            Running  = pending.NetRunning or {},
            Found    = pending.NetFound or {},
          },
        }

        for roundStamp, _ in pairs(state.PendingRounds) do
          if tonumber(roundStamp) <= timestamp then   -- roundStamp is a string key (A17)
            state.PendingRounds[roundStamp] = nil
          end
        end

        -- Apply pending share changes whose delay has elapsed. UNIT FIX: ChangeDelaySeconds is in
        -- SECONDS while both timestamps are MILLISECONDS — convert, or a 7-day delay elapses in
        -- ~10 minutes (see header).
        local changeDelayMs = (state.Configuration.Shares.ChangeDelaySeconds or 0) * 1000
        for operatorAddress, pendingChange in pairs(state.PendingShareChanges) do
          if (pendingChange.RequestedTimestamp or 0) + changeDelayMs <= timestamp then
            state.Shares[operatorAddress] = pendingChange.Share
            state.PendingShareChanges[operatorAddress] = nil
          end
        end

        return 'OK'
      end,
    },

    ['Cancel-Round'] = {
      roles = { 'owner', 'admin', 'Cancel-Round' },
      handler = function(ctx)
        local timestamp = utils.parseInt(ctx.tags['Round-Timestamp'])
        utils.assertInteger(timestamp, 'Round-Timestamp tag')
        local tsKey = tostring(timestamp)   -- A17
        assert(ctx.state.PendingRounds[tsKey], 'No pending round for ' .. timestamp)
        ctx.state.PendingRounds[tsKey] = nil
        return 'OK'
      end,
    },

    -- Freezes the hodler's claimable high-water mark: Claimed[hodler][op] = Rewarded[hodler][op]
    -- for every operator they staked with. Returns the rewarded map (legacynet payload).
    ['Claim-Rewards'] = {
      roles = { 'owner', 'admin', 'Claim-Rewards' },
      handler = function(ctx)
        local state = ctx.state
        local hodlerAddress = checksum(ctx.tags['Address'], 'Address tag')
        -- `forHodler` returns nil (not {}) when there is nothing, so the legacynet error text
        -- fires on exactly the same condition as before.
        local rewarded = forHodler(state.Rewarded, hodlerAddress)
        assert(rewarded, 'No rewards for ' .. hodlerAddress)

        for operatorAddress, amount in pairs(rewarded) do
          state.Claimed[pairKey(hodlerAddress, operatorAddress)] = amount
        end

        -- The legacynet payload: the hodler's `[operator] = amount` map, unchanged.
        return json.encode(rewarded)
      end,
    },
  },

  -- ------------------------------------------------------------------------
  -- READS. Every view reassembles the pre-flattening nested shape, so nothing a consumer sees
  -- changed with D32. `spec/fixtures/staking-view-golden.json` pins that against the real
  -- legacynet dump; `scripts/staking-view-golden.ts --check` is the gate.
  -- ------------------------------------------------------------------------
  views = {
    -- legacynet Get-Rewards: both maps for one hodler.
    rewards = function(s, p)
      if not (p and p.address) then return nil end
      local ok, addr = pcall(eip55.checksum, p.address)
      if not ok then return nil end
      -- Reassembled from the flat maps into the exact legacy `[operator] = amount` shape.
      return { Rewarded = forHodler(s.Rewarded, addr) or {}, Claimed = forHodler(s.Claimed, addr) or {} }
    end,

    -- legacynet Get-Claimed.
    claimed = function(s, p)
      if not (p and p.address) then return nil end
      local ok, addr = pcall(eip55.checksum, p.address)
      if not ok then return nil end
      -- nil (absent), not {}, when the hodler has never claimed — same as before.
      return { address = addr, claimed = forHodler(s.Claimed, addr) }
    end,

    -- Operator share state (set shares + queued changes awaiting their delay).
    shares = function(s, p)
      if p and p.address then
        local ok, addr = pcall(eip55.checksum, p.address)
        if not ok then return nil end
        return { address = addr, share = s.Shares[addr], pending = s.PendingShareChanges[addr] }
      end
      return { Shares = s.Shares, PendingShareChanges = s.PendingShareChanges }
    end,

    -- legacynet Last-Round-Metadata.
    last_round = function(s)
      return {
        Timestamp = s.PreviousRound.Timestamp,
        Period = s.PreviousRound.Period,
        Configuration = s.PreviousRound.Configuration,
        Summary = s.PreviousRound.Summary,
      }
    end,

    -- legacynet Last-Round-Data: one hodler's per-operator breakdown of the last round.
    last_round_data = function(s, p)
      if not (p and p.address) then return nil end
      local ok, addr = pcall(eip55.checksum, p.address)
      if not ok then return nil end
      local details = detailsForHodler(s.PreviousRound.Details, addr)
      if not details then return nil end
      return { Timestamp = s.PreviousRound.Timestamp, Period = s.PreviousRound.Period, Details = details }
    end,

    -- legacynet Last-Snapshot: the whole previous round, Details included (persisted — see
    -- header). Details is rebuilt into its original two-level shape here; storage is flat.
    last_snapshot = function(s)
      return {
        Timestamp = s.PreviousRound.Timestamp,
        Period = s.PreviousRound.Period,
        Summary = s.PreviousRound.Summary,
        Configuration = s.PreviousRound.Configuration,
        Details = detailsNested(s.PreviousRound.Details),
        Network = networkNested(s.PreviousRound.Network),
      }
    end,

    -- Operational visibility + liveness/wedge probe.
    status = function(s)
      local function count(t) local n = 0; for _ in pairs(t) do n = n + 1 end; return n end
      return {
        tokensPerSecond = s.Configuration.TokensPerSecond,
        runningRequirement = s.Configuration.Requirements.Running,
        sharesEnabled = s.Configuration.Shares.Enabled,
        setSharesEnabled = s.Configuration.Shares.SetSharesEnabled,
        lastRoundTimestamp = s.PreviousRound.Timestamp,
        counts = {
          -- HODLERS, not pairs. Counting keys would silently change what this reports.
          rewardedHodlers = countHodlers(s.Rewarded),
          claimedHodlers = countHodlers(s.Claimed),
          shares = count(s.Shares),
          pendingShareChanges = count(s.PendingShareChanges),
          pendingRounds = count(s.PendingRounds),
        },
      }
    end,

    -- NB: no `dump` view here — the runtime owns it (native.view / D32 §1).
  },
}
