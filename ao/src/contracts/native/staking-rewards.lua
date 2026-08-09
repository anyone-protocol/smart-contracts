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
--- SHAPE NOTE: unlike relay-rewards, every reward map here is TWO levels deep —
--- `Rewarded[hodler][operator]`, `Claimed[hodler][operator]`, `PendingRounds[ts][hodler][operator]`,
--- `PreviousRound.Details[hodler][operator]`. An operator's own earnings live at the self-key
--- `Rewarded[operator][operator]`.
---
--- DELIBERATE DEVIATIONS from legacynet:
---   * Addresses stored EIP-55 (was 0x+ALLCAPS via normalizeEvmAddress). Every untrusted address
---     ingress runs through `eip55.checksum` (validate + canonicalize), wrapped in pcall so the
---     legacynet error strings are preserved verbatim.
---   * `PreviousRound.Details` IS persisted here (decision 2026-07-25). Relay dropped its Details
---     because they were 3.6 MB of a 4 MB state; staking's whole state is ~322 KB (Details ~181 KB),
---     so the pressure does not exist and `Last-Snapshot`/`Last-Round-Data` stay plain views.
---   * A17: `PendingRounds` is keyed by the STRING timestamp (a large int key hangs the device VM).
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
  -- 🔴 FLATTENING DEBT (D31 §2, D32 §2). The `[hodler][operator]` maps below cost ONE LIVE TABLE
  -- PER OUTER KEY — 3,336 of them in the real seed, against 6 for operator-registry and 31 for
  -- relay-rewards. luerl's GC mark phase is quadratic in live tables, so this contract pays far
  -- more per collect than the other two, and it grows with the hodler x operator pair count.
  -- The fix is composite keys (`[hodler .. '/' .. operator]`), which takes it to ~10 tables. It
  -- is correctness-neutral but touches the round math, so it lands as its own change gated on
  -- the bint golden — NOT as part of the state-root move.
  state = {
    Claimed             = {},   -- [hodler][operator] = "bigint" (high-water mark at claim time)
    Rewarded            = {},   -- [hodler][operator] = "bigint" (cumulative; operator self-key = own cut)
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
      Details = {},   -- [hodler][operator] = { Score, Rating, Reward } — PERSISTED (see header)
    },
    PendingRounds = {},   -- [tostring(Timestamp)][hodler][operator] = { Staked, Running, Share }
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
            assert(state.PendingRounds[tsKey][nHodlerAddress] == nil, 'Duplicated score for ' .. nHodlerAddress)
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

        if state.PendingRounds[tsKey] == nil then
          state.PendingRounds[tsKey] = {}
        end

        for hodlerAddress, scores in pairs(request.Scores) do
          local nHodlerAddress = canon[hodlerAddress].hodler
          state.PendingRounds[tsKey][nHodlerAddress] = {}
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
            state.PendingRounds[tsKey][nHodlerAddress][nOperatorAddress] = {
              Staked = tostring(bint(score.Staked)), Running = score.Running, Share = share,
            }
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

        for hodlerAddress, scores in pairs(state.PendingRounds[tsKey]) do
          roundData[hodlerAddress] = {}
          for operatorAddress, score in pairs(scores) do
            local staked = bint(score.Staked)
            local restaked = bint(0)
            local rating = bint(0)
            if score.Running >= state.Configuration.Requirements.Running then
              if state.Rewarded[hodlerAddress] ~= nil and
                  state.Rewarded[hodlerAddress][operatorAddress] ~= nil then
                if state.Claimed[hodlerAddress] ~= nil and
                    state.Claimed[hodlerAddress][operatorAddress] ~= nil then
                  restaked = bint(state.Rewarded[hodlerAddress][operatorAddress]) - bint(state.Claimed[hodlerAddress][operatorAddress])
                else
                  restaked = bint(state.Rewarded[hodlerAddress][operatorAddress])
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

        local dataWithStrings = {}
        for hodlerAddress, ratedData in pairs(roundData) do
          dataWithStrings[hodlerAddress] = {}
          for operatorAddress, data in pairs(ratedData) do
            if state.Rewarded[hodlerAddress] == nil then
              state.Rewarded[hodlerAddress] = {}
            end
            local previousHodlerReward = bint(0)
            if state.Rewarded[hodlerAddress][operatorAddress] ~= nil then
              previousHodlerReward = bint(state.Rewarded[hodlerAddress][operatorAddress])
            end
            local hodlerReward = data.Reward.Hodler + previousHodlerReward
            if bint.ispos(hodlerReward) then
              state.Rewarded[hodlerAddress][operatorAddress] = tostring(hodlerReward)
            end

            if state.Rewarded[operatorAddress] == nil then
              state.Rewarded[operatorAddress] = {}
            end
            local previousOperatorReward = bint(0)
            if state.Rewarded[operatorAddress][operatorAddress] ~= nil then
              previousOperatorReward = bint(state.Rewarded[operatorAddress][operatorAddress])
            end
            local operatorReward = data.Reward.Operator + previousOperatorReward
            if bint.ispos(operatorReward) then
              state.Rewarded[operatorAddress][operatorAddress] = tostring(operatorReward)
            end

            dataWithStrings[hodlerAddress][operatorAddress] = {
              Score = {
                Staked = tostring(data.Score.Staked),
                Restaked = tostring(data.Score.Restaked),
                Running = data.Score.Running,
                Share = data.Score.Share
              },
              Rating = tostring(data.Rating),
              Reward = { Hodler = tostring(data.Reward.Hodler), Operator = tostring(data.Reward.Operator) }
            }
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
          Details = dataWithStrings
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
        local rewarded = state.Rewarded[hodlerAddress]
        assert(rewarded, 'No rewards for ' .. hodlerAddress)

        if state.Claimed[hodlerAddress] == nil then
          state.Claimed[hodlerAddress] = {}
        end
        for operatorAddress, _ in pairs(rewarded) do
          state.Claimed[hodlerAddress][operatorAddress] = state.Rewarded[hodlerAddress][operatorAddress]
        end

        return json.encode(rewarded)
      end,
    },
  },

  -- ------------------------------------------------------------------------
  -- READS — point lookups come FREE from base-addressing
  -- (now/state/Rewarded/<hodler>/<operator>, now/state/Claimed/<hodler>/<operator>).
  -- These are the computed/bundled reads.
  -- ------------------------------------------------------------------------
  views = {
    -- legacynet Get-Rewards: both maps for one hodler.
    rewards = function(s, p)
      if not (p and p.address) then return nil end
      local ok, addr = pcall(eip55.checksum, p.address)
      if not ok then return nil end
      return { Rewarded = s.Rewarded[addr] or {}, Claimed = s.Claimed[addr] or {} }
    end,

    -- legacynet Get-Claimed.
    claimed = function(s, p)
      if not (p and p.address) then return nil end
      local ok, addr = pcall(eip55.checksum, p.address)
      if not ok then return nil end
      return { address = addr, claimed = s.Claimed[addr] }
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
      local details = s.PreviousRound.Details and s.PreviousRound.Details[addr]
      if not details then return nil end
      return { Timestamp = s.PreviousRound.Timestamp, Period = s.PreviousRound.Period, Details = details }
    end,

    -- legacynet Last-Snapshot: the whole previous round, Details included (persisted — see header).
    last_snapshot = function(s) return s.PreviousRound end,

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
          rewardedHodlers = count(s.Rewarded),
          claimedHodlers = count(s.Claimed),
          shares = count(s.Shares),
          pendingShareChanges = count(s.PendingShareChanges),
          pendingRounds = count(s.PendingRounds),
        },
      }
    end,

    -- NB: no `dump` view here — the runtime owns it (native.view / D32 §1).
  },
}
