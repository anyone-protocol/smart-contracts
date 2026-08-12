--- relay-rewards.lua — D26 NATIVE SHAPE.
---
--- Declares `{ state, actions, views }` for the native runtime (runtime/native.lua), which owns
--- identity, trust, ACL, Owner set-once, atomicity and dispatch. This module carries ONLY the
--- relay-rewards domain logic.
---
--- FROZEN reward math: the economic computation in `Complete-Round` is copied byte-for-byte from
--- the legacynet contract (src/contracts/relay-rewards.lua), which was already proven bint→
--- `.common.bigint` byte-identical (Tier-2 golden). The port only reshapes the WRAPPER
--- (Handlers → native actions; `RelayRewards.X` → `ctx.state.X`; `msg` → `ctx`) — the numbers
--- must not move. See docs/hyperbeam-migration/D27-relay-rewards-native-port.md.
---
--- DELIBERATE DEVIATIONS from legacynet (same as operator-registry, see D26/D27):
---   * Addresses stored EIP-55 (was 0x+ALLCAPS via normalizeEvmAddress). Every untrusted address
---     ingress (Add-Scores `score.Address`, Set-Delegate, Claim/Get `Address`) runs through
---     `eip55.checksum` (validate + canonicalize; rejects a mixed-case bad checksum). `Complete-Round`
---     then uses the already-canonical stored addresses verbatim.
---   * `PreviousRound.Details` (the per-fingerprint breakdown, 3.25 MB / 6,010 entries in the live
---     dump) IS persisted — but as a PRE-ENCODED JSON STRING, `PreviousRound.DetailsJson`, never as
---     a Lua table. D27 originally dropped it because a live table cost ~30,000 Lua tables that every
---     slot re-serializes; a string costs ONE value, stores each fingerprint key once, and needs no
---     `json.encode` on read. Nothing computes on Details (the reward math uses the LOCAL `roundData`
---     built during settlement), so a string loses nothing. Served by the `last_round_details` view,
---     which returns it as the response body verbatim. See `Complete-Round` for the full rationale.
---   * `Complete-Round` ALSO still returns the whole snapshot (incl. Details) as its OUTPUT, for
---     archival consumers that want the entire round (controller persistRound). `PreviousRound.Slot`
---     records the settle slot so that payload stays findable in one read (`last_round` →
---     `compute&slot=<Slot>/results/output/data`). Note you cannot base-address INTO that output —
---     `.../data` is the whole JSON, `.../data/Details` 404s (D29 §2b).
---   * Dropped: the Handlers registry + tag-matching, all `patch@1.0` sends, all `*-Response` sends,
---     the `Get-*/View-*/Last-*` read handlers (now `views` / base-addressing). Update-Roles/View-Roles
---     are runtime built-ins.
---
--- Round protocol is legacynet VERBATIM (no rename): staged `Add-Scores` × N → `Complete-Round`.

local utils  = require('.common.utils')
local errors = require('.common.errors')
local eip55  = require('.common.eip55')
local json   = require('json')
local bint   = require('.common.bigint')(256)

--- Frozen from RelayRewards._updateConfiguration (validation + assignment), reshaped to take/return
--- the config table. normalizeEvmAddress → eip55.checksum for the Delegates map.
local function updateConfiguration(config, request)
  if request.TokensPerSecond then
    assert(type(request.TokensPerSecond) == 'string', 'TokensPerSecond must be a string number')
    local safeTokens = bint.tobint(request.TokensPerSecond)
    assert(safeTokens ~= nil, 'TokensPerSecond must be an integer')
    assert(bint.ispos(safeTokens), 'TokensPerSecond must be a positive value')
    config.TokensPerSecond = request.TokensPerSecond
  end
  if request.Modifiers then
    if request.Modifiers.Network then
      utils.assertNumber(request.Modifiers.Network.Share, 'Modifiers.Network.Share')
      assert(request.Modifiers.Network.Share >= 0, 'Modifiers.Network.Share has to be >= 0')
      assert(request.Modifiers.Network.Share <= 1, 'Modifiers.Network.Share has to be <= 1')
      config.Modifiers.Network.Share = request.Modifiers.Network.Share
    end
    if request.Modifiers.Hardware then
      assert(type(request.Modifiers.Hardware.Enabled) == 'boolean', errors.BooleanValueRequired .. ' for Modifiers.Hardware.Enabled')
      utils.assertNumber(request.Modifiers.Hardware.Share, 'Modifiers.Hardware.Share')
      assert(request.Modifiers.Hardware.Share >= 0, 'Modifiers.Hardware.Share has to be >= 0')
      assert(request.Modifiers.Hardware.Share <= 1, 'Modifiers.Hardware.Share has to be <= 1')
      config.Modifiers.Hardware.Enabled = request.Modifiers.Hardware.Enabled
      config.Modifiers.Hardware.Share = request.Modifiers.Hardware.Share
      if request.Modifiers.Hardware.UptimeInfluence then
        utils.assertNumber(request.Modifiers.Hardware.UptimeInfluence, 'Modifiers.Hardware.UptimeInfluence')
        assert(request.Modifiers.Hardware.UptimeInfluence >= 0, 'Modifiers.Hardware.UptimeInfluence has to be >= 0')
        assert(request.Modifiers.Hardware.UptimeInfluence <= 1, 'Modifiers.Hardware.UptimeInfluence has to be <= 1')
        config.Modifiers.Hardware.UptimeInfluence = request.Modifiers.Hardware.UptimeInfluence
      end
    end
    if request.Modifiers.Uptime then
      assert(type(request.Modifiers.Uptime.Enabled) == 'boolean', errors.BooleanValueRequired .. ' for Modifiers.Uptime.Enabled')
      utils.assertNumber(request.Modifiers.Uptime.Share, 'Modifiers.Uptime.Share')
      assert(request.Modifiers.Uptime.Share >= 0, 'Modifiers.Uptime.Share has to be >= 0')
      assert(request.Modifiers.Uptime.Share <= 1, 'Modifiers.Uptime.Share has to be <= 1')
      config.Modifiers.Uptime.Enabled = request.Modifiers.Uptime.Enabled
      config.Modifiers.Uptime.Share = request.Modifiers.Uptime.Share
      if request.Modifiers.Uptime.Tiers then
        assert(type(request.Modifiers.Uptime.Tiers) == 'table', 'Table type required for Modifiers.Uptime.Tiers')
        local tierCount = 0
        for days, weight in pairs(request.Modifiers.Uptime.Tiers) do
          local daysInt = utils.parseInt(days)
          utils.assertInteger(daysInt, 'Modifiers.Uptime.Tiers days')
          assert(daysInt >= 0, 'Modifiers.Uptime.Tiers days has to be >= 0')
          local weightFloat = tonumber(weight)
          utils.assertNumber(weightFloat, 'Modifiers.Uptime.Tiers weight')
          assert(weightFloat >= 0, 'Modifiers.Uptime.Tiers Value has to be >= 0')
          assert(tierCount < 42, 'Too many Modifiers.Uptime.Tiers')
          tierCount = tierCount + 1
        end
        config.Modifiers.Uptime.Tiers = request.Modifiers.Uptime.Tiers
      end
    end
    if request.Modifiers.ExitBonus then
      assert(type(request.Modifiers.ExitBonus.Enabled) == 'boolean', errors.BooleanValueRequired .. ' for Modifiers.ExitBonus.Enabled')
      utils.assertNumber(request.Modifiers.ExitBonus.Share, 'Modifiers.ExitBonus.Share')
      assert(request.Modifiers.ExitBonus.Share >= 0, 'Modifiers.ExitBonus.Share has to be >= 0')
      assert(request.Modifiers.ExitBonus.Share <= 1, 'Modifiers.ExitBonus.Share has to be <= 1')
      config.Modifiers.ExitBonus.Enabled = request.Modifiers.ExitBonus.Enabled
      config.Modifiers.ExitBonus.Share = request.Modifiers.ExitBonus.Share
    end
    local totalEffectiveShare = config.Modifiers.Network.Share
    if config.Modifiers.Hardware.Enabled then
      totalEffectiveShare = totalEffectiveShare + config.Modifiers.Hardware.Share
    end
    if config.Modifiers.Uptime.Enabled then
      totalEffectiveShare = totalEffectiveShare + config.Modifiers.Uptime.Share
    end
    if config.Modifiers.ExitBonus.Enabled then
      totalEffectiveShare = totalEffectiveShare + config.Modifiers.ExitBonus.Share
    end
    assert(totalEffectiveShare == 1, 'Sum of shares for enabled modifiers has to equal 1')
  end
  if request.Multipliers then
    if request.Multipliers.Family then
      assert(type(request.Multipliers.Family.Enabled) == 'boolean', errors.BooleanValueRequired .. ' for Multipliers.Family.Enabled')
      utils.assertNumber(request.Multipliers.Family.Offset, 'Multipliers.Family.Offset')
      assert(request.Multipliers.Family.Offset >= 0, 'Multipliers.Family.Offset has to be >= 0')
      assert(request.Multipliers.Family.Offset <= 1, 'Multipliers.Family.Offset has to be <= 1')
      utils.assertNumber(request.Multipliers.Family.Power, 'Multipliers.Family.Power')
      assert(request.Multipliers.Family.Power >= 0, 'Multipliers.Family.Power has to be >= 0')
      config.Multipliers.Family.Enabled = request.Multipliers.Family.Enabled
      config.Multipliers.Family.Offset = request.Multipliers.Family.Offset
      config.Multipliers.Family.Power = request.Multipliers.Family.Power
    end
    if request.Multipliers.Location then
      assert(type(request.Multipliers.Location.Enabled) == 'boolean', errors.BooleanValueRequired .. ' for Multipliers.Location.Enabled')
      utils.assertNumber(request.Multipliers.Location.Offset, 'Multipliers.Location.Offset')
      assert(request.Multipliers.Location.Offset >= 0, 'Multipliers.Location.Offset has to be >= 0')
      assert(request.Multipliers.Location.Offset <= 1, 'Multipliers.Location.Offset has to be <= 1')
      utils.assertNumber(request.Multipliers.Location.Power, 'Multipliers.Location.Power')
      assert(request.Multipliers.Location.Power >= 0, 'Multipliers.Location.Power has to be >= 0')
      utils.assertNumber(request.Multipliers.Location.Divider, 'Multipliers.Location.Divider')
      assert(request.Multipliers.Location.Divider >= 1, 'Multipliers.Location.Divider has to be >= 1')
      config.Multipliers.Location.Enabled = request.Multipliers.Location.Enabled
      config.Multipliers.Location.Offset = request.Multipliers.Location.Offset
      config.Multipliers.Location.Power = request.Multipliers.Location.Power
      config.Multipliers.Location.Divider = request.Multipliers.Location.Divider
    end
  end
  if request.Delegates then
    assert(type(request.Delegates) == 'table', 'Delegates have to be a table')
    local normalizedDelegates = {}
    for operatorAddress, delegation in pairs(request.Delegates) do
      -- eip55.checksum validates format + checksum and canonicalizes (was assertValidEvmAddress).
      local normalizedOperatorAddress = eip55.checksum(operatorAddress)
      delegation.Address = eip55.checksum(delegation.Address)
      utils.assertNumber(delegation.Share, 'Delegates['.. operatorAddress .. '].Share')
      assert(delegation.Share >= 0, 'Delegates['.. operatorAddress .. '].Share has to be >= 0')
      assert(delegation.Share <= 1, 'Delegates['.. operatorAddress .. '].Share has to be <= 1')
      normalizedDelegates[normalizedOperatorAddress] = delegation
    end
    config.Delegates = normalizedDelegates
  end
  return config
end

return {
  name = 'relay-rewards',
  -- State root: the Lua global holding state (D31/D32). Restores the legacynet global name.
  root = 'RelayRewards',

  -- Single source of truth at the `RelayRewards` global. Read ONLY through views (`as/<view>`);
  -- the base-addressed point reads this comment used to advertise
  -- (now/state/TotalAddressReward/<addr>) no longer exist, and were measured SLOWER than a view
  -- anyway (148 ms vs 27.6 ms — D31 §5a). PreviousRound carries the summary ONLY; Details ride
  -- the Complete-Round output (see header). PendingRounds is the staging buffer.
  state = {
    Claimed                = {},   -- [EIP-55 addr] = "bigint" (high-water mark)
    TotalAddressReward     = {},   -- [EIP-55 addr] = "bigint" (cumulative claimable; delegate-adjusted)
    TotalFingerprintReward = {},   -- [fingerprint] = "bigint" (cumulative lifetime per relay)
    Configuration = {
      TokensPerSecond = '28935184200000000',
      Modifiers = {
        Network  = { Share = 0.56 },
        Hardware = { Enabled = true, Share = 0.2, UptimeInfluence = 0.35 },
        Uptime   = { Enabled = true, Share = 0.14, Tiers = { ['0'] = 0, ['3'] = 1, ['14'] = 3 } },
        ExitBonus = { Enabled = true, Share = 0.1 },
      },
      Multipliers = {
        Family   = { Enabled = true, Offset = 0.01, Power = 1.0 },
        Location = { Enabled = true, Offset = 0.001, Power = 2.0, Divider = 20.0 },
      },
      Delegates = {},
    },
    PreviousRound = {   -- summary ONLY (no Details — see header)
      Timestamp = 0,
      -- The slot `Complete-Round` settled on, i.e. where the full Details payload can be read
      -- (`compute&slot=<Slot>/results/output/data`). 0 = no round has settled yet, the same
      -- "unset" convention Timestamp already uses — a consumer must gate on Timestamp > 0
      -- before fetching, because slot 0 is the spawn and would return unrelated output.
      Slot = 0,
      -- [fingerprint] = pre-encoded JSON string for that relay's line in the last round. Strings,
      -- never nested tables — see the rationale in `Complete-Round`. Empty until a round settles.
      DetailsJson = {},
      Period = 0,
      Summary = {
        Ratings = { Network = '0', Uptime = '0', ExitBonus = '0' },
        Rewards = { Total = '0', Network = '0', Hardware = '0', Uptime = '0', ExitBonus = '0' },
      },
      Configuration = {},
    },
    PendingRounds = {},   -- [Timestamp] = { [fingerprint] = { Address, Score } } (staging)
  },

  -- ------------------------------------------------------------------------
  -- WRITES. `ctx.from` = verified committer; `ctx.state` = mutable state; `ctx.tags` = title-case
  -- tags; `ctx.data` = raw message data. Handler return is the compute output. A thrown assert
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

    ['Add-Scores'] = {
      roles = { 'owner', 'admin', 'Add-Scores' },
      handler = function(ctx)
        assert(ctx.data, errors.MessageDataRequired)
        local request = json.decode(ctx.data)
        assert(request, 'Failed to parse data')

        local timestamp = utils.parseInt(ctx.tags['Round-Timestamp'])
        assert(timestamp, 'Round-Timestamp tag must be a number')
        utils.assertInteger(timestamp, 'Round-Timestamp tag')
        assert(timestamp > 0, 'Round-Timestamp has to be > 0')
        assert(timestamp > ctx.state.PreviousRound.Timestamp, 'Round-Timestamp is backdated')
        -- A17: PendingRounds is keyed by the STRING timestamp, never the number. luerl routes a
        -- large positive-integer table key (a 13-digit ms round timestamp) into the array part and
        -- tries to allocate ~1.8e12 slots → the device VM hangs. Real Lua 5.3 hashes it fine, so
        -- this only bites on-device. Values/comparisons stay numeric. See UPSTREAM-ISSUES A17.
        local tsKey = tostring(timestamp)

        assert(type(request.Scores) == 'table', 'Scores have to be a table')

        local function assertScore(score, fingerprint)
          utils.assertValidFingerprint(fingerprint, 'Invalid Fingerprint' .. fingerprint)
          -- address validated + canonicalized to EIP-55 below (was assertValidEvmAddress)
          utils.assertInteger(score.Network, 'Scores[' .. fingerprint .. '].Network')
          assert(score.Network >= 0, 'Scores[' .. fingerprint .. '].Network has to be >= 0')
          assert(type(score.IsHardware) == 'boolean', 'Scores[' .. fingerprint .. '].IsHardware')
          utils.assertInteger(score.UptimeStreak, 'Scores[' .. fingerprint .. '].UptimeStreak')
          assert(score.UptimeStreak >= 0, 'Scores[' .. fingerprint .. '].UptimeStreak has to be >= 0')
          assert(type(score.ExitBonus) == 'boolean', 'Scores[' .. fingerprint .. '].ExitBonus')
          utils.assertInteger(score.FamilySize, 'Scores[' .. fingerprint .. '].FamilySize')
          assert(score.FamilySize >= 0, 'Scores[' .. fingerprint .. '].FamilySize has to be >= 0')
          utils.assertInteger(score.LocationSize, 'Scores[' .. fingerprint .. '].LocationSize')
          assert(score.LocationSize >= 0, 'Scores[' .. fingerprint .. '].LocationSize has to be >= 0')
        end

        -- validate-before-mutate: validate every score (+ canonicalize its address once) and
        -- dup-check, THEN stage. A thrown assert reverts (nothing staged).
        local canonAddr = {}
        for fingerprint, score in pairs(request.Scores) do
          assertScore(score, fingerprint)
          canonAddr[fingerprint] = eip55.checksum(score.Address)   -- validate + canonicalize (one keccak)
          if ctx.state.PendingRounds[tsKey] then
            assert(ctx.state.PendingRounds[tsKey][fingerprint] == nil, 'Duplicated score for ' .. fingerprint)
          end
        end

        if ctx.state.PendingRounds[tsKey] == nil then
          ctx.state.PendingRounds[tsKey] = {}
        end

        for fingerprint, score in pairs(request.Scores) do
          ctx.state.PendingRounds[tsKey][fingerprint] = {
            Address = canonAddr[fingerprint],
            Score = {
              Network = score.Network,
              IsHardware = score.IsHardware,
              UptimeStreak = score.UptimeStreak,
              FamilySize = score.FamilySize,
              ExitBonus = score.ExitBonus,
              LocationSize = score.LocationSize,
            },
          }
        end

        return 'OK'
      end,
    },

    -- The settlement. FROZEN reward math (verbatim from legacynet Complete-Round). Persists the
    -- cumulative maps + the PreviousRound SUMMARY; RETURNS the full snapshot (incl. Details) as the
    -- compute output for the settle-slot read path (Details never enter base.state). See header.
    ['Complete-Round'] = {
      roles = { 'owner', 'admin', 'Complete-Round' },
      handler = function(ctx)
        local state = ctx.state
        local timestamp = utils.parseInt(ctx.tags['Round-Timestamp'])
        utils.assertInteger(timestamp, 'Round-Timestamp tag')
        local tsKey = tostring(timestamp)   -- A17: string key (see Add-Scores)
        assert(state.PendingRounds[tsKey], 'No pending round for ' .. timestamp)

        local roundData = {}

        local summary = {
          Ratings = { Network = bint(0), Uptime = 0.0, ExitBonus = bint(0) },
          Rewards = { Total = bint(0), Network = bint(0), Hardware = bint(0), Uptime = bint(0), ExitBonus = bint(0) }
        }

        for fingerprint, scoreData in pairs(state.PendingRounds[tsKey]) do
          roundData[fingerprint] = {}
          roundData[fingerprint].Address = scoreData.Address
          roundData[fingerprint].Score = scoreData.Score

          local networkScore = scoreData.Score.Network

          local familyMultiplier = 1
          if state.Configuration.Multipliers.Family.Enabled then
            familyMultiplier = 1 + state.Configuration.Multipliers.Family.Offset * (scoreData.Score.FamilySize^state.Configuration.Multipliers.Family.Power)
            if familyMultiplier < 0 then
              familyMultiplier = 0
            end
            networkScore = math.floor(networkScore * familyMultiplier)
          end
          local locationMultiplier = 1
          if state.Configuration.Multipliers.Location.Enabled then
            locationMultiplier = 1 - state.Configuration.Multipliers.Location.Offset * ((scoreData.Score.LocationSize / state.Configuration.Multipliers.Location.Divider)^state.Configuration.Multipliers.Location.Power)
            if locationMultiplier < 0 then
              locationMultiplier = 0
            end
            networkScore = math.floor(networkScore * locationMultiplier)
          end

          roundData[fingerprint].Rating = { Network = networkScore, IsHardware = false, Uptime = 0, ExitBonus = 0 }

          if state.Configuration.Modifiers.Hardware.Enabled and scoreData.Score.IsHardware then
            roundData[fingerprint].Rating.IsHardware = true
          end

          local uptimeTierWeight = 0.0
          if state.Configuration.Modifiers.Uptime.Enabled then
            for days, weight in pairs(state.Configuration.Modifiers.Uptime.Tiers) do
              local daysInt = tonumber(days)
              local weightFloat = tonumber(weight)
              assert(weightFloat, 'Multiplier must be a number')
              if daysInt <= scoreData.Score.UptimeStreak and uptimeTierWeight < weightFloat then
                uptimeTierWeight = weightFloat
              end
            end
            roundData[fingerprint].Rating.Uptime = uptimeTierWeight
          end

          if state.Configuration.Modifiers.ExitBonus.Enabled and scoreData.Score.ExitBonus then
            roundData[fingerprint].Rating.ExitBonus = networkScore
          end

          roundData[fingerprint].Variables = {
            FamilyMultiplier = familyMultiplier,
            LocationMultiplier = locationMultiplier
          }

          summary.Ratings.Network = summary.Ratings.Network + bint(roundData[fingerprint].Rating.Network)
          summary.Ratings.Uptime = summary.Ratings.Uptime + roundData[fingerprint].Rating.Uptime
          summary.Ratings.ExitBonus = summary.Ratings.ExitBonus + bint(roundData[fingerprint].Rating.ExitBonus)
        end

        local roundLength = bint(0)
        if state.PreviousRound.Timestamp > 0 then
          local msInSec = 1000
          roundLength = bint((timestamp - state.PreviousRound.Timestamp) // msInSec)
        end

        local tokensPerSecond = bint(state.Configuration.TokensPerSecond)
        local totalRewardsPerRound = tokensPerSecond * roundLength

        local sharePrecision = bint(1000)

        local networkRewardsPerSec = (tokensPerSecond * bint((state.Configuration.Modifiers.Network.Share * sharePrecision) // 1)) // sharePrecision
        local networkRewards = networkRewardsPerSec * roundLength

        local hardwareRewards = bint(0)
        local hardwareRewardsPerSec = bint(0)
        if state.Configuration.Modifiers.Hardware.Enabled then
          hardwareRewardsPerSec = (tokensPerSecond * bint((state.Configuration.Modifiers.Hardware.Share * sharePrecision)) // 1) // sharePrecision
          hardwareRewards = hardwareRewardsPerSec * roundLength
        end

        local uptimeRewards = bint(0)
        local uptimeRewardsPerSec = bint(0)
        if state.Configuration.Modifiers.Uptime.Enabled then
          uptimeRewardsPerSec = (tokensPerSecond * bint((state.Configuration.Modifiers.Uptime.Share * sharePrecision)) // 1) // sharePrecision
          uptimeRewards = uptimeRewardsPerSec * roundLength
        end

        local exitBonusRewards = bint(0)
        local exitBonusRewardsPerSec = bint(0)
        if state.Configuration.Modifiers.ExitBonus.Enabled then
          exitBonusRewardsPerSec = (tokensPerSecond * bint((state.Configuration.Modifiers.ExitBonus.Share * sharePrecision)) // 1) // sharePrecision
          exitBonusRewards = exitBonusRewardsPerSec * roundLength
        end

        local fingerprintRewardsPerSec = networkRewardsPerSec + hardwareRewardsPerSec + uptimeRewardsPerSec + exitBonusRewardsPerSec

        local fingerprintRewards = fingerprintRewardsPerSec * roundLength
        assert(bint.ule(fingerprintRewards, totalRewardsPerRound), 'Failed rewards share calculation')

        local totalHwNetworkRewards = bint(0)
        local totalHwUptimeRewards = bint(0)
        local uptimePrecision = bint(100000)
        for fingerprint, ratedData in pairs(roundData) do
          roundData[fingerprint].Reward = {
            Total = bint(0),
            OperatorTotal = bint(0),
            DelegateTotal = bint(0),
            Network = bint(0),
            Hardware = bint(0),
            Uptime = bint(0),
            ExitBonus = bint(0)
          }
          if not bint.iszero(summary.Ratings.Network) then
            roundData[fingerprint].Reward.Network = (networkRewards * ratedData.Rating.Network) // summary.Ratings.Network
            summary.Rewards.Network = summary.Rewards.Network + roundData[fingerprint].Reward.Network
          end
          if ratedData.Rating.IsHardware then
            totalHwNetworkRewards = totalHwNetworkRewards + roundData[fingerprint].Reward.Network
          end
          if not bint.iszero(summary.Ratings.Uptime) then
            local uptimeWeight = ratedData.Rating.Uptime / summary.Ratings.Uptime
            roundData[fingerprint].Reward.Uptime = (uptimeRewards * bint((uptimeWeight * uptimePrecision) // 1)) // uptimePrecision
            summary.Rewards.Uptime = summary.Rewards.Uptime + roundData[fingerprint].Reward.Uptime
            if ratedData.Rating.IsHardware then
              totalHwUptimeRewards = totalHwUptimeRewards + roundData[fingerprint].Reward.Uptime
            end
          end
        end

        local delegatePrecision = bint(1000)
        local influencePrecision = bint(1000)
        local uptimeInfluenceOnHw = 0.0
        if state.Configuration.Modifiers.Uptime.Enabled then
          uptimeInfluenceOnHw = state.Configuration.Modifiers.Hardware.UptimeInfluence
        end

        local hwUptimePool = (hardwareRewards * bint((uptimeInfluenceOnHw * influencePrecision) // 1)) // influencePrecision
        local hwNetworkPool = hardwareRewards - hwUptimePool

        for fingerprint, ratedData in pairs(roundData) do
          if ratedData.Rating.IsHardware then
            local hwNetworkReward = bint(0)
            if not bint.iszero(totalHwNetworkRewards) then
              hwNetworkReward = (hwNetworkPool * roundData[fingerprint].Reward.Network) // totalHwNetworkRewards
            end
            local hwUptimeReward = bint(0)
            if not bint.iszero(totalHwUptimeRewards) then
              hwUptimeReward = (hwUptimePool * roundData[fingerprint].Reward.Uptime) // totalHwUptimeRewards
            end

            roundData[fingerprint].Reward.Hardware = hwNetworkReward + hwUptimeReward
          end
          if not bint.iszero(summary.Ratings.ExitBonus) then
            roundData[fingerprint].Reward.ExitBonus = (exitBonusRewards * ratedData.Rating.ExitBonus) // summary.Ratings.ExitBonus
          end

          roundData[fingerprint].Reward.Total = roundData[fingerprint].Reward.Network +
              roundData[fingerprint].Reward.Hardware + roundData[fingerprint].Reward.Uptime +
              roundData[fingerprint].Reward.ExitBonus

          local operatorAddress = roundData[fingerprint].Address
          local delegate = state.Configuration.Delegates[operatorAddress]
          if delegate and delegate.Share > 0 then
            local delegateTotal = (roundData[fingerprint].Reward.Total * bint((delegate.Share * delegatePrecision) // 1)) // delegatePrecision

            local operatorTotal = roundData[fingerprint].Reward.Total - delegateTotal
            roundData[fingerprint].Reward.OperatorTotal = operatorTotal
            roundData[fingerprint].Reward.DelegateTotal = delegateTotal
            -- delegate.Address is already EIP-55 (canonicalized at Set-Delegate/Update-Configuration)
            local normalizedDelegateAddress = delegate.Address

            if state.TotalAddressReward[normalizedDelegateAddress] == nil then
              state.TotalAddressReward[normalizedDelegateAddress] = '0'
            end
            state.TotalAddressReward[normalizedDelegateAddress] = tostring(bint(state.TotalAddressReward[normalizedDelegateAddress]) + roundData[fingerprint].Reward.DelegateTotal)
          else
            roundData[fingerprint].Reward.OperatorTotal = tostring(roundData[fingerprint].Reward.Total)
            roundData[fingerprint].Reward.DelegateTotal = '0'
          end
          -- operatorAddress is already EIP-55 (canonicalized at Add-Scores ingress)
          local normalizedOperatorAddress = operatorAddress
          if state.TotalAddressReward[normalizedOperatorAddress] == nil then
            state.TotalAddressReward[normalizedOperatorAddress] = '0'
          end
          state.TotalAddressReward[normalizedOperatorAddress] = tostring(bint(state.TotalAddressReward[normalizedOperatorAddress]) + roundData[fingerprint].Reward.OperatorTotal)

          if state.TotalFingerprintReward[fingerprint] == nil then
            state.TotalFingerprintReward[fingerprint] = '0'
          end
          state.TotalFingerprintReward[fingerprint] = tostring(bint(state.TotalFingerprintReward[fingerprint]) + roundData[fingerprint].Reward.Total)

          summary.Rewards.Total = summary.Rewards.Total + roundData[fingerprint].Reward.Total
          summary.Rewards.Hardware = summary.Rewards.Hardware + roundData[fingerprint].Reward.Hardware
          summary.Rewards.ExitBonus = summary.Rewards.ExitBonus + roundData[fingerprint].Reward.ExitBonus
        end

        local roundDataWithStringRewards = {}
        -- Per-fingerprint PRE-ENCODED JSON, the persisted read surface (see below). Built in the
        -- same pass so the two shapes cannot diverge: same table, encoded once, right here.
        local detailsJson = {}

        for fingerprint, ratedData in pairs(roundData) do
          roundDataWithStringRewards[fingerprint] = {}
          roundDataWithStringRewards[fingerprint].Address = ratedData.Address
          roundDataWithStringRewards[fingerprint].Variables = ratedData.Variables
          roundDataWithStringRewards[fingerprint].Score = ratedData.Score
          roundDataWithStringRewards[fingerprint].Rating = ratedData.Rating
          roundDataWithStringRewards[fingerprint].Reward = {
            Total = tostring(ratedData.Reward.Total),
            OperatorTotal = tostring(ratedData.Reward.OperatorTotal),
            DelegateTotal = tostring(ratedData.Reward.DelegateTotal),
            Network = tostring(ratedData.Reward.Network),
            Hardware = tostring(ratedData.Reward.Hardware),
            Uptime = tostring(ratedData.Reward.Uptime),
            ExitBonus = tostring(ratedData.Reward.ExitBonus)
          }
          detailsJson[fingerprint] = json.encode(roundDataWithStringRewards[fingerprint])
        end

        local summaryOut = {
          Ratings = {
            Network = tostring(summary.Ratings.Network),
            Uptime = tostring(summary.Ratings.Uptime),
            ExitBonus = tostring(summary.Ratings.ExitBonus)
          },
          Rewards = {
            Total = tostring(summary.Rewards.Total),
            Network = tostring(summary.Rewards.Network),
            Hardware = tostring(summary.Rewards.Hardware),
            Uptime = tostring(summary.Rewards.Uptime),
            ExitBonus = tostring(summary.Rewards.ExitBonus)
          }
        }

        -- PERSIST the summary, plus Details as PER-FINGERPRINT PRE-ENCODED JSON STRINGS.
        --
        -- Details are read-only reporting — no contract logic computes on them (audited: the
        -- reward math works on the LOCAL `roundData` above, and the only legacynet read was the
        -- `Last-Round-Data` handler). Since nothing indexes it in Lua and every consumer wants
        -- JSON anyway, strings are strictly the cheapest representation:
        --   * ONE table of strings, not ~30,000 live Lua tables (6,010 fingerprints x 5 nested
        --     maps) for every slot to re-serialize.
        --   * Keyed by fingerprint because that is how it is READ — the dashboard asks for one
        --     relay at a time (legacynet `Last-Round-Data` took a Fingerprint tag). A point
        --     read is ~570 B instead of the 3.25 MB a single whole-round blob would force.
        --   * NOTHING to encode on read: the view returns the stored string as the response
        --     body. Every other view pays a `json.encode` per request.
        --   * Float fidelity is exact by construction — encoded ONCE, above, from the same
        --     table that produces the settle-slot output, so the multipliers never make a
        --     float -> string -> float trip (the trap D28's header calls out).
        --   * NOT parallel typed maps (staking's D28 pattern): that shape duplicates the
        --     40-char fingerprint key per leaf field, measuring 120,200 stored keys / 4.6 MB of
        --     keys alone at this cardinality. It fits staking's 636 pairs, not relay's 6,010.
        --
        -- `Slot` records this settlement's own slot so the WHOLE round stays retrievable from
        -- `compute&slot=<Slot>/results/output/data` — that is the path the controller uses to
        -- publish each round's full Details to Arweave, which state deliberately does not serve.
        -- `or 0` covers the Tier-1/2 harness, which has no assignment.
        state.PreviousRound = {
          Timestamp = timestamp,
          Slot = ctx.slot or 0,
          Period = bint.tonumber(roundLength),
          Summary = summaryOut,
          Configuration = state.Configuration,
          DetailsJson = detailsJson,
        }

        for roundStamp, _ in pairs(state.PendingRounds) do
          if tonumber(roundStamp) <= timestamp then   -- roundStamp is a string key (A17)
            state.PendingRounds[roundStamp] = nil
          end
        end

        -- OUTPUT the full snapshot (incl. Details) for the settle-slot read path (persistRound +
        -- dashboard Last-Round-Data). Matches legacynet Last-Snapshot's payload.
        return json.encode({
          Timestamp = timestamp,
          Slot = ctx.slot or 0,   -- self-identifying: confirms a fetch landed on the right slot
          Period = bint.tonumber(roundLength),
          Summary = summaryOut,
          Configuration = state.Configuration,
          Details = roundDataWithStringRewards,
        })
      end,
    },

    ['Cancel-Round'] = {
      roles = { 'owner', 'admin', 'Cancel-Round' },
      handler = function(ctx)
        local timestamp = utils.parseInt(ctx.tags['Round-Timestamp'])
        utils.assertInteger(timestamp, 'Round-Timestamp tag')
        local tsKey = tostring(timestamp)   -- A17: string key (see Add-Scores)
        assert(ctx.state.PendingRounds[tsKey], 'No pending round for ' .. timestamp)
        ctx.state.PendingRounds[tsKey] = nil
        return 'OK'
      end,
    },

    -- Permissionless self-service: an operator (ctx.from) sets/clears a delegate for a Share of
    -- their own rewards. No ACL role (matches legacynet: address = msg.From).
    ['Set-Delegate'] = function(ctx)
      local address = ctx.from   -- node-verified committer, already EIP-55 (D6)
      local delegateAddress = ctx.tags['Address']
      if delegateAddress then
        delegateAddress = eip55.checksum(delegateAddress)   -- validate + canonicalize
        local delegateShare = ctx.tags['Share']
        if delegateShare then
          local share = tonumber(delegateShare)
          utils.assertNumber(share, 'Delegate.Share')
          assert(share >= 0, 'Delegate.Share has to be >= 0')
          assert(share <= 1, 'Delegate.Share has to be <= 1')
          ctx.state.Configuration.Delegates[address] = { Address = delegateAddress, Share = share }
          return 'OK'
        end
        return 'NONE'
      else
        ctx.state.Configuration.Delegates[address] = nil
        return 'RESET'
      end
    end,

    ['Claim-Rewards'] = {
      roles = { 'owner', 'admin', 'Claim-Rewards' },
      handler = function(ctx)
        local address = eip55.checksum(ctx.tags['Address'])   -- validate + canonicalize
        local rewarded = bint.tobint(ctx.state.TotalAddressReward[address])
        assert(rewarded ~= nil, 'No rewards for ' .. address)
        ctx.state.Claimed[address] = tostring(rewarded)
        return json.encode(ctx.state.Claimed[address])
      end,
    },
  },

  -- ------------------------------------------------------------------------
  -- READS — per-address/fingerprint point lookups come FREE from base-addressing
  -- (now/state/TotalAddressReward/<addr>, now/state/Claimed/<addr>,
  -- now/state/TotalFingerprintReward/<fp>). These are the computed/bundled reads.
  -- ------------------------------------------------------------------------
  views = {
    -- Cumulative reward for an address (payout read) or a fingerprint (lifetime-per-relay).
    rewards = function(s, p)
      if not p then return nil end
      if p.fingerprint then return { fingerprint = p.fingerprint, reward = s.TotalFingerprintReward[p.fingerprint] } end
      if p.address then
        local ok, addr = pcall(eip55.checksum, p.address)
        if not ok then return nil end
        return { address = addr, reward = s.TotalAddressReward[addr] }
      end
      return nil
    end,

    claimed = function(s, p)
      if not (p and p.address) then return nil end
      local ok, addr = pcall(eip55.checksum, p.address)
      if not ok then return nil end
      return { address = addr, claimed = s.Claimed[addr] }
    end,

    delegate = function(s, p)
      if not (p and p.address) then return nil end
      local ok, addr = pcall(eip55.checksum, p.address)
      if not ok then return nil end
      return s.Configuration.Delegates[addr] or { Address = '', Share = 0 }
    end,

    -- Last-round SUMMARY (metadata). The full per-fingerprint breakdown (Details) is NOT here —
    -- it is served from the Complete-Round slot output (see header / D27).
    last_round = function(s)
      return {
        Timestamp = s.PreviousRound.Timestamp,
        Slot = s.PreviousRound.Slot,   -- the settle slot, for whole-round archival consumers
        Period = s.PreviousRound.Period,
        Summary = s.PreviousRound.Summary,
        Configuration = s.PreviousRound.Configuration,
      }
    end,

    -- ONE relay's line in the last round — the legacynet `Last-Round-Data` read, which also
    -- took a Fingerprint. Kept OUT of `last_round` deliberately: that view is small metadata
    -- polled often, this one is per-relay detail.
    --
    -- Returns the STORED STRING as the response body, with no encode step: `DetailsJson[fp]`
    -- was encoded at settle time. That is the point of storing strings — the read path does no
    -- work proportional to the round's size.
    --
    -- Missing/unknown fingerprint returns nil (the wrapper answers `{}`), matching what
    -- `rewards`/`claimed`/`delegate` already do for an absent key. The WHOLE round is not
    -- served here; it lives at the settle slot (see `last_round.Slot`).
    last_round_details = function(s, p)
      if not (p and p.fingerprint) then return nil end
      return s.PreviousRound.DetailsJson[p.fingerprint]
    end,

    -- legacynet `Last-Snapshot`: the WHOLE last round, Details included. That payload is not in
    -- state by design (state carries only the per-fingerprint `DetailsJson` strings), so it
    -- lives at the slot `Complete-Round` settled on. This view is the convenience hop to it.
    --
    --   as/last_snapshot                -> { Slot, Timestamp, Period, Path }, so a caller can
    --                                      build the fetch itself
    --   as/last_snapshot?redirect=true  -> 302 straight at that slot's output
    --
    -- The Location is RELATIVE on purpose. A view is handed (state, params) and never sees the
    -- process id, so it cannot build an absolute URL; `../compute&…` resolves against the
    -- request path `/<pid>~process@1.0/as/last_snapshot` back to
    -- `/<pid>~process@1.0/compute&slot=<n>/results/output/data`, which is the same hop without
    -- the contract having to know who it is.
    --
    -- Redirecting before any round has settled would point at slot 0 (the spawn) and hand back
    -- unrelated output, so that answers 404 rather than a wrong 200.
    last_snapshot = function(s, p)
      local pr = s.PreviousRound
      local slot = pr.Slot or 0
      local wants = p and (p.redirect == 'true' or p.redirect == '1')
      if not wants then
        return {
          Slot = slot,
          Timestamp = pr.Timestamp,
          Period = pr.Period,
          -- relative to `/<pid>~process@1.0/`
          Path = 'compute&slot=' .. tostring(slot) .. '/results/output/data',
        }
      end
      if slot <= 0 then
        return nil, { status = 404, body = '{"error":"no round has settled yet"}' }
      end
      -- 🚨 The body must NOT be empty. An empty body combined with an explicit content-type
      -- (which the view wrapper always sets) answers 500 through the nginx edge, while HEAD
      -- still returns 302 — so it looks fine until a browser actually GETs it. Verified on
      -- hb-dev 2026-08-12: empty+content-type 500s, non-empty+content-type is a clean 302.
      -- A direct-to-node request does NOT reproduce it, which is why Tier-3 missed it.
      -- Carrying the pointer as the body is useful anyway: a client that does not follow
      -- redirects still gets the answer.
      local path = 'compute&slot=' .. tostring(slot) .. '/results/output/data'
      return nil, {
        status = 302,
        location = '../' .. path,
        body = '{"Slot":' .. tostring(slot) .. ',"Path":"' .. path .. '"}',
      }
    end,

    -- Operational visibility + liveness/wedge probe.
    status = function(s)
      local function count(t) local n = 0; for _ in pairs(t) do n = n + 1 end; return n end
      local pending = 0
      for _ in pairs(s.PendingRounds) do pending = pending + 1 end
      return {
        tokensPerSecond = s.Configuration.TokensPerSecond,
        lastRoundTimestamp = s.PreviousRound.Timestamp,
        counts = {
          addresses = count(s.TotalAddressReward),
          fingerprints = count(s.TotalFingerprintReward),
          claimed = count(s.Claimed),
          delegates = count(s.Configuration.Delegates),
          pendingRounds = pending,
        },
      }
    end,

    -- NB: no `dump` view here — the runtime owns it (native.view / D32 §1).
    -- PendingRounds/PreviousRound.Details are absent from it by design (Details never persisted).
  },
}
