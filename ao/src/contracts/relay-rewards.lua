local RelayRewards = {
  _initialized = false,

  TotalAddressReward = {
-- [Address] = '0'
  },
  TotalFingerprintReward = {
-- [Fingerprint] = '0'
  },

  Configuration = {
    TokensPerSecond = 28935184200000000,
    Modifiers = {
      Network = { Share = 1 },
      Hardware = { Enabled = false, Share = 0.2, UptimeInfluence = 0.35 },
      Uptime = { Enabled = false, Share = 0.14,
        Tiers = {
          ['0'] = 0,
          ['3'] = 1,
          ['14'] = 3,
        }
      },
      ExitBonus = { Enabled = false, Share = 0.1 }
    },
    Multipliers = {
      Family = { Enabled = false, Offset = 0.01, Power = 1 },
      Location = { Enabled = false, Offset = 0.003, Power = 2 }
    },
    Delegates = {
--      [Address] = { Address: '', Share = 0 }
    }
  },
  PreviousRound = {
    Timestamp = 0,
    Period = 0,
    Summary = {
      Ratings = { Network = '0', Uptime = '0', ExitBonus = '0' },
      Rewards = { Total = '0', Network = '0', Hardware = '0', Uptime = '0', ExitBonus = '0' }
    },
    Configuration = {},
    Details = {
-- [Fingerprint] = { 
--   Address = ''
--   Score = { Network = 0, IsHardware = false, UptimeStreak = 0, ExitBonus = false, FamilySize = 0, LocationSize = 0 }
--   Variables = { FamilyMultiplier = 0.0, LocationMultiplier = 0.0 }
--   Rating = { Network = 0, Uptime = 0, ExitBonus = 0 }
--   Reward = {
--     Total = '0', OperatorTotal = '0', DelegateTotal = '0',
--     Network = '0', Hardware = '0', Uptime = '0', ExitBonus = '0' 
--   }
-- }
    }
  },
  PendingRounds = {
-- Timestamp = {
--   Fingerprint = {
--     Address = ''
--     Score = {
--       Network = 0
--       IsHardware = false
--       UptimeStreak = 0
--       FamilySize = 1
--       ExitBonus = false, LocationSize = 0
--     }
--   }
-- }
  }
}

function RelayRewards._updateConfiguration(config, request)
  local ErrorMessages = require('.common.errors')
  local AnyoneUtils = require('.common.utils')

  if request.TokensPerSecond then
    AnyoneUtils.assertInteger(request.TokensPerSecond, 'TokensPerSecond')
    assert(request.TokensPerSecond >= 0, 'TokensPerSecond has to be >= 0')
    config.TokensPerSecond = request.TokensPerSecond
  end
  if request.Modifiers then
    if request.Modifiers.Network then
      AnyoneUtils.assertNumber(request.Modifiers.Network.Share, 'Modifiers.Network.Share')
      assert(request.Modifiers.Network.Share >= 0, 'Modifiers.Network.Share has to be >= 0')
      assert(request.Modifiers.Network.Share <= 1, 'Modifiers.Network.Share has to be <= 1')
      config.Modifiers.Network.Share = request.Modifiers.Network.Share
    end
    if request.Modifiers.Hardware then
      assert(type(request.Modifiers.Hardware.Enabled) == 'boolean', ErrorMessages.BooleanValueRequired .. ' for Modifiers.Hardware.Enabled')
      AnyoneUtils.assertNumber(request.Modifiers.Hardware.Share, 'Modifiers.Hardware.Share')
      assert(request.Modifiers.Hardware.Share >= 0, 'Modifiers.Hardware.Share has to be >= 0')
      assert(request.Modifiers.Hardware.Share <= 1, 'Modifiers.Hardware.Share has to be <= 1')
      config.Modifiers.Hardware.Enabled = request.Modifiers.Hardware.Enabled
      config.Modifiers.Hardware.Share = request.Modifiers.Hardware.Share
      if request.Modifiers.Hardware.UptimeInfluence then
        AnyoneUtils.assertNumber(request.Modifiers.Hardware.UptimeInfluence, 'Modifiers.Hardware.UptimeInfluence')
        assert(request.Modifiers.Hardware.UptimeInfluence >= 0, 'Modifiers.Hardware.UptimeInfluence has to be >= 0')
        assert(request.Modifiers.Hardware.UptimeInfluence <= 1, 'Modifiers.Hardware.UptimeInfluence has to be <= 1')
        config.Modifiers.Hardware.UptimeInfluence = request.Modifiers.Hardware.UptimeInfluence
      end
    end
    if request.Modifiers.Uptime then
      assert(type(request.Modifiers.Uptime.Enabled) == 'boolean', ErrorMessages.BooleanValueRequired .. ' for Modifiers.Uptime.Enabled')
      AnyoneUtils.assertNumber(request.Modifiers.Uptime.Share, 'Modifiers.Uptime.Share')
      assert(request.Modifiers.Uptime.Share >= 0, 'Modifiers.Uptime.Share has to be >= 0')
      assert(request.Modifiers.Uptime.Share <= 1, 'Modifiers.Uptime.Share has to be <= 1')
      config.Modifiers.Uptime.Enabled = request.Modifiers.Uptime.Enabled
      config.Modifiers.Uptime.Share = request.Modifiers.Uptime.Share

      if request.Modifiers.Uptime.Tiers then
        assert(type(request.Modifiers.Uptime.Tiers) == 'table', 'Table type required for Modifiers.Uptime.Tiers')
        local tierCount = 0
        for days, weight in pairs(request.Modifiers.Uptime.Tiers) do
          local daysInt = tonumber(days)
          AnyoneUtils.assertInteger(daysInt, 'Modifiers.Uptime.Tiers days')
          assert(daysInt >= 0, 'Modifiers.Uptime.Tiers days has to be >= 0')
          local weightFloat = tonumber(weight)
          AnyoneUtils.assertNumber(weightFloat, 'Modifiers.Uptime.Tiers weight')
          assert(weightFloat >= 0, 'Modifiers.Uptime.Tiers Value has to be >= 0')
          assert(tierCount < 42, 'Too many Modifiers.Uptime.Tiers')
          tierCount = tierCount + 1
        end
        config.Modifiers.Uptime.Tiers = request.Modifiers.Uptime.Tiers
      end
    end
    if request.Modifiers.ExitBonus then
      assert(type(request.Modifiers.ExitBonus.Enabled) == 'boolean', ErrorMessages.BooleanValueRequired .. ' for Modifiers.ExitBonus.Enabled')
      AnyoneUtils.assertNumber(request.Modifiers.ExitBonus.Share, 'Modifiers.ExitBonus.Share')
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
      assert(type(request.Multipliers.Family.Enabled) == 'boolean', ErrorMessages.BooleanValueRequired .. ' for Multipliers.Family.Enabled')
      AnyoneUtils.assertNumber(request.Multipliers.Family.Offset, 'Multipliers.Family.Offset')
      assert(request.Multipliers.Family.Offset >= 0, 'Multipliers.Family.Offset has to be >= 0')
      assert(request.Multipliers.Family.Offset <= 1, 'Multipliers.Family.Offset has to be <= 1')
      AnyoneUtils.assertNumber(request.Multipliers.Family.Power, 'Multipliers.Family.Power')
      assert(request.Multipliers.Family.Power >= 0, 'Multipliers.Family.Power has to be >= 0')
      config.Multipliers.Family.Enabled = request.Multipliers.Family.Enabled
      config.Multipliers.Family.Offset = request.Multipliers.Family.Offset
      config.Multipliers.Family.Power = request.Multipliers.Family.Power
    end
    if request.Multipliers.Location then
      assert(type(request.Multipliers.Location.Enabled) == 'boolean', ErrorMessages.BooleanValueRequired .. ' for Multipliers.Location.Enabled')
      AnyoneUtils.assertNumber(request.Multipliers.Location.Offset, 'Multipliers.Location.Offset')
      assert(request.Multipliers.Location.Offset >= 0, 'Multipliers.Location.Offset has to be >= 0')
      assert(request.Multipliers.Location.Offset <= 1, 'Multipliers.Location.Offset has to be <= 1')
      AnyoneUtils.assertNumber(request.Multipliers.Location.Power, 'Multipliers.Location.Power')
      assert(request.Multipliers.Location.Power >= 0, 'Multipliers.Location.Power has to be >= 0')
      config.Multipliers.Location.Enabled = request.Multipliers.Location.Enabled
      config.Multipliers.Location.Offset = request.Multipliers.Location.Offset
      config.Multipliers.Location.Power = request.Multipliers.Location.Power
    end
  end
  if request.Delegates then
    assert(type(request.Delegates) == 'table', 'Delegates have to be a table')
    local normalizedDelegates = {}
    for operatorAddress, delegation in pairs(request.Delegates) do
      AnyoneUtils.assertValidEvmAddress(operatorAddress, 'Invalid operator address')
      AnyoneUtils.assertValidEvmAddress(delegation.Address, 'Invalid delegated address for '.. operatorAddress)
      AnyoneUtils.assertNumber(delegation.Share, 'Delegates['.. operatorAddress .. '].Share')
      assert(delegation.Share >= 0, 'Delegates['.. operatorAddress .. '].Share has to be >= 0')
      assert(delegation.Share <= 1, 'Delegates['.. operatorAddress .. '].Share has to be <= 1')
      local normalizedOperatorAddress = AnyoneUtils.normalizeEvmAddress(operatorAddress)
      normalizedDelegates[normalizedOperatorAddress] = delegation
    end
    config.Delegates = normalizedDelegates
  end

  RelayRewards.Configuration = config
end

function RelayRewards.init()
  local bint = require('.bint')(256)
  local json = require('json')

  local ErrorMessages = require('.common.errors')
  local AnyoneUtils = require('.common.utils')
  local ACL = require('.common.acl')

  Handlers.add(
    'Update-Configuration',
    Handlers.utils.hasMatchingTag(
      'Action',
      'Update-Configuration'
    ),
    function (msg)
      ACL.assertHasOneOfRole(
        msg.From,
        { 'owner', 'admin', 'Update-Configuration' }
      )

      assert(msg.Data, ErrorMessages.MessageDataRequired)

      local config = RelayRewards.Configuration
      
      local request = nil
      local function parseData()
        request = json.decode(msg.Data)
      end

      local status, err = pcall(parseData)
      assert(err == nil, 'Data must be valid JSON')
      assert(status, 'Failed to parse input data')
      assert(request, 'Failed to parse data')
      
      RelayRewards._updateConfiguration(config, request)

      ao.send({
        Target = msg.From,
        Action = 'Update-Configuration-Response',
        Data = 'OK'
      })
    end
  )

  Handlers.add(
    'Add-Scores',
    Handlers.utils.hasMatchingTag(
      'Action',
      'Add-Scores'
    ),
    function (msg)
      ACL.assertHasOneOfRole(
        msg.From,
        { 'owner', 'admin', 'Add-Scores' }
      )

      assert(msg.Data, ErrorMessages.MessageDataRequired)
      
      local request = nil
      local function parseData()
        request = json.decode(msg.Data)
      end

      local status, err = pcall(parseData)
      assert(err == nil, 'Data must be valid JSON')
      assert(status, 'Failed to parse input data')
      assert(request, 'Failed to parse data')
      
      local timestamp = tonumber(msg.Tags['Timestamp'])
      assert(timestamp, 'Timestamp tag must be a number')
      AnyoneUtils.assertInteger(timestamp, 'Timestamp tag')
      assert(timestamp > 0, 'Timestamp has to be > 0')
      assert(timestamp > RelayRewards.PreviousRound.Timestamp, 'Timestamp is backdated')
      
      assert(type(request.Scores) == 'table', 'Scores have to be a table')

      local function assertScore(score, fingerprint)
        AnyoneUtils.assertValidFingerprint(fingerprint, 'Invalid Fingerprint' .. fingerprint)
        AnyoneUtils.assertValidEvmAddress(score.Address, 'Invalid Scores[' .. fingerprint .. '].Address')
        AnyoneUtils.assertInteger(score.Network, 'Scores[' .. fingerprint .. '].Network')
        assert(score.Network >= 0, 'Scores[' .. fingerprint .. '].Network has to be >= 0')
        assert(type(score.IsHardware) == 'boolean', 'Scores[' .. fingerprint .. '].IsHardware')
        AnyoneUtils.assertInteger(score.UptimeStreak, 'Scores[' .. fingerprint .. '].UptimeStreak')
        assert(score.UptimeStreak >= 0, 'Scores[' .. fingerprint .. '].UptimeStreak has to be >= 0')
        assert(type(score.ExitBonus) == 'boolean', 'Scores[' .. fingerprint .. '].ExitBonus')
        AnyoneUtils.assertInteger(score.FamilySize, 'Scores[' .. fingerprint .. '].FamilySize')
        assert(score.FamilySize >= 0, 'Scores[' .. fingerprint .. '].FamilySize has to be >= 0')
        AnyoneUtils.assertInteger(score.LocationSize, 'Scores[' .. fingerprint .. '].LocationSize')
        assert(score.LocationSize >= 0, 'Scores[' .. fingerprint .. '].LocationSize has to be >= 0')
      end

      for fingerprint, score in pairs(request.Scores) do
        assertScore(score, fingerprint)
        if RelayRewards.PendingRounds[timestamp] then
          assert(RelayRewards.PendingRounds[timestamp][fingerprint] == nil, 'Duplicated score for ' .. fingerprint)
        end
      end

      if RelayRewards.PendingRounds[timestamp] == nil then
        RelayRewards.PendingRounds[timestamp] = {}
      end

      for fingerprint, score in pairs(request.Scores) do
        RelayRewards.PendingRounds[timestamp][fingerprint] = {
          Address = score.Address,
          Score = {}
        }
        RelayRewards.PendingRounds[timestamp][fingerprint].Score = {
          Network = score.Network,
          IsHardware = score.IsHardware,
          UptimeStreak = score.UptimeStreak,
          FamilySize = score.FamilySize,
          ExitBonus = score.ExitBonus,
          LocationSize = score.LocationSize
        }
      end

      ao.send({
        Target = msg.From,
        Action = 'Add-Scores-Response',
        Data = 'OK'
      })
    end
  )

  Handlers.add(
    'Complete-Round',
    Handlers.utils.hasMatchingTag(
      'Action',
      'Complete-Round'
    ),
    function (msg)
      ACL.assertHasOneOfRole(
        msg.From,
        { 'owner', 'admin', 'Complete-Round' }
      )
      
      local timestamp = tonumber(msg.Tags['Timestamp'])
      AnyoneUtils.assertInteger(timestamp, 'Timestamp tag')
      assert(RelayRewards.PendingRounds[timestamp], 'No pending round for ' .. timestamp)

      local roundData = {}
      
      local summary = {
        Ratings = { Network = bint(0), Uptime = 0.0, ExitBonus = bint(0) },
        Rewards = { Total = bint(0), Network = bint(0), Hardware = bint(0), Uptime = bint(0), ExitBonus = bint(0) }
      }
      
      for fingerprint, scoreData in pairs(RelayRewards.PendingRounds[timestamp]) do
        roundData[fingerprint] = {}
        roundData[fingerprint].Address = scoreData.Address
        roundData[fingerprint].Score = scoreData.Score
        
        local networkScore = scoreData.Score.Network

        local familyMultiplier = 1
        if RelayRewards.Configuration.Multipliers.Family.Enabled then
          familyMultiplier = 1 + RelayRewards.Configuration.Multipliers.Family.Offset * (scoreData.Score.FamilySize^RelayRewards.Configuration.Multipliers.Family.Power)
          if familyMultiplier < 0 then
            familyMultiplier = 0
          end
          networkScore = math.floor(networkScore * familyMultiplier)
        end
        local locationMultiplier = 1
        if RelayRewards.Configuration.Multipliers.Location.Enabled then
          locationMultiplier = 1 - RelayRewards.Configuration.Multipliers.Location.Offset * (scoreData.Score.LocationSize^RelayRewards.Configuration.Multipliers.Location.Power)
          if locationMultiplier < 0 then
            locationMultiplier = 0
          end
          networkScore = math.floor(networkScore * locationMultiplier)
        end

        roundData[fingerprint].Rating = { Network = networkScore, IsHardware = false, Uptime = 0, ExitBonus = 0 }

        local uptimeTierWeight = 0.0
        if RelayRewards.Configuration.Modifiers.Hardware.Enabled and scoreData.Score.IsHardware then
          for days, weight in pairs(RelayRewards.Configuration.Modifiers.Uptime.Tiers) do
            local daysInt = tonumber(days)
            local weightFloat = tonumber(weight)
            assert(weightFloat, 'Multiplier must be a number')
            if daysInt <= scoreData.Score.UptimeStreak and uptimeTierWeight < weightFloat then
              uptimeTierWeight = weightFloat
            end
          end
          roundData[fingerprint].Rating.Uptime = uptimeTierWeight
          roundData[fingerprint].Rating.IsHardware = true
        end

        if RelayRewards.Configuration.Modifiers.ExitBonus.Enabled and scoreData.Score.ExitBonus then
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
      if RelayRewards.PreviousRound.Timestamp > 0 then
        local msInSec = 1000
        roundLength = bint((timestamp - RelayRewards.PreviousRound.Timestamp) // msInSec)
      end

      local tokensPerSecond = bint(RelayRewards.Configuration.TokensPerSecond)
      local totalRewardsPerRound = tokensPerSecond * roundLength

      local sharePrecision = bint(1000)
      
      local networkRewardsPerSec = (tokensPerSecond * bint(RelayRewards.Configuration.Modifiers.Network.Share * sharePrecision)) // sharePrecision
      local networkRewards = networkRewardsPerSec * roundLength

      local hardwareRewards = bint(0)
      local hardwareRewardsPerSec = bint(0)
      if RelayRewards.Configuration.Modifiers.Hardware.Enabled then
        hardwareRewardsPerSec = (tokensPerSecond * bint(RelayRewards.Configuration.Modifiers.Hardware.Share * sharePrecision)) // sharePrecision
        hardwareRewards = hardwareRewardsPerSec * roundLength
      end

      local uptimeRewards = bint(0)
      local uptimeRewardsPerSec = bint(0)
      if RelayRewards.Configuration.Modifiers.Uptime.Enabled then
        uptimeRewardsPerSec = (tokensPerSecond * bint(RelayRewards.Configuration.Modifiers.Uptime.Share * sharePrecision)) // sharePrecision
        uptimeRewards = uptimeRewardsPerSec * roundLength
      end

      local exitBonusRewards = bint(0)
      local exitBonusRewardsPerSec = bint(0)
      if RelayRewards.Configuration.Modifiers.ExitBonus.Enabled then
        exitBonusRewardsPerSec = (tokensPerSecond * bint(RelayRewards.Configuration.Modifiers.ExitBonus.Share * sharePrecision)) // sharePrecision
        exitBonusRewards = exitBonusRewardsPerSec * roundLength
      end

      local fingerprintRewardsPerSec = networkRewardsPerSec + hardwareRewardsPerSec + uptimeRewardsPerSec + exitBonusRewardsPerSec

      local fingerprintRewards = fingerprintRewardsPerSec * roundLength
      assert(bint.ule(fingerprintRewards, totalRewardsPerRound), 'Failed rewards share calculation')
      
      local uptimeInfluenceOnHw = 0.0
      if RelayRewards.Configuration.Modifiers.Uptime.Enabled then
        uptimeInfluenceOnHw = RelayRewards.Configuration.Modifiers.Hardware.UptimeInfluence
      end
      local networkInfluenceOnHw = 1 - uptimeInfluenceOnHw
      local totalHwNetworkRewards = bint(0)
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
          if not bint.iszero(summary.Ratings.Uptime) then
            local uptimePrecision = bint(100000)
            local uptimeWeight = ratedData.Rating.Uptime / summary.Ratings.Uptime
            roundData[fingerprint].Reward.Uptime = (uptimeRewards * bint(uptimeWeight * uptimePrecision)) // uptimePrecision
            summary.Rewards.Uptime = summary.Rewards.Uptime + roundData[fingerprint].Reward.Uptime
          end
        end
      end
      local delegatePrecision = bint(1000)
      local influencePrecision = bint(1000)
      local networkTotalPart = (totalHwNetworkRewards * bint(networkInfluenceOnHw * influencePrecision)) // influencePrecision
      local uptimeTotalPart = (summary.Rewards.Uptime * bint(uptimeInfluenceOnHw * influencePrecision)) // influencePrecision
      local hwTotalWeight = networkTotalPart + uptimeTotalPart

      for fingerprint, ratedData in pairs(roundData) do
        if ratedData.Rating.IsHardware then
          local networkUnitPart = (roundData[fingerprint].Reward.Network * bint(networkInfluenceOnHw * influencePrecision)) // influencePrecision
          local uptimeUnitPart = (roundData[fingerprint].Reward.Uptime * bint(uptimeInfluenceOnHw * influencePrecision)) // influencePrecision
          local hwUnitWeight = networkUnitPart + uptimeUnitPart

          roundData[fingerprint].Reward.Hardware = (hardwareRewards * hwUnitWeight) // hwTotalWeight
        end
        if not bint.iszero(summary.Ratings.ExitBonus) then
          roundData[fingerprint].Reward.ExitBonus = (exitBonusRewards * ratedData.Rating.ExitBonus) // summary.Ratings.ExitBonus
        end
        
        roundData[fingerprint].Reward.Total = roundData[fingerprint].Reward.Network +
            roundData[fingerprint].Reward.Hardware + roundData[fingerprint].Reward.Uptime +
            roundData[fingerprint].Reward.ExitBonus
        
        local operatorAddress = roundData[fingerprint].Address
        local delegate = RelayRewards.Configuration.Delegates[operatorAddress]
        if delegate and delegate.Share > 0 then
          local delegateTotal = (roundData[fingerprint].Reward.Total * bint(delegate.Share * delegatePrecision)) // delegatePrecision

          local operatorTotal = roundData[fingerprint].Reward.Total - delegateTotal
          roundData[fingerprint].Reward.OperatorTotal = operatorTotal
          roundData[fingerprint].Reward.DelegateTotal = delegateTotal
          local normalizedDelegateAddress = AnyoneUtils.normalizeEvmAddress(delegate.Address)

          if RelayRewards.TotalAddressReward[normalizedDelegateAddress] == nil then
            RelayRewards.TotalAddressReward[normalizedDelegateAddress] = '0'
          end
          RelayRewards.TotalAddressReward[normalizedDelegateAddress] = tostring(bint(RelayRewards.TotalAddressReward[normalizedDelegateAddress]) + roundData[fingerprint].Reward.DelegateTotal)
        else
          roundData[fingerprint].Reward.OperatorTotal = tostring(roundData[fingerprint].Reward.Total)
          roundData[fingerprint].Reward.DelegateTotal = '0'
        end
        local normalizedOperatorAddress = AnyoneUtils.normalizeEvmAddress(operatorAddress)
        if RelayRewards.TotalAddressReward[normalizedOperatorAddress] == nil then
          RelayRewards.TotalAddressReward[normalizedOperatorAddress] = '0'
        end
        RelayRewards.TotalAddressReward[normalizedOperatorAddress] = tostring(bint(RelayRewards.TotalAddressReward[normalizedOperatorAddress]) + roundData[fingerprint].Reward.OperatorTotal)

        if RelayRewards.TotalFingerprintReward[fingerprint] == nil then
          RelayRewards.TotalFingerprintReward[fingerprint] = '0'
        end
        RelayRewards.TotalFingerprintReward[fingerprint] = tostring(bint(RelayRewards.TotalFingerprintReward[fingerprint]) + roundData[fingerprint].Reward.Total)

        summary.Rewards.Total = summary.Rewards.Total + roundData[fingerprint].Reward.Total
        summary.Rewards.Hardware = summary.Rewards.Hardware + roundData[fingerprint].Reward.Hardware
        summary.Rewards.ExitBonus = summary.Rewards.ExitBonus + roundData[fingerprint].Reward.ExitBonus
      end

      local roundDataWithStringRewards = {}

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
      end

      RelayRewards.PreviousRound = {
        Timestamp = timestamp,
        Period = bint.tonumber(roundLength),
        Summary = {
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
        },
        Configuration = RelayRewards.Configuration,
        Details = roundDataWithStringRewards
      }

      for roundStamp, _ in pairs(RelayRewards.PendingRounds) do
        if roundStamp <= timestamp then
          RelayRewards.PendingRounds[roundStamp] = nil
        end
      end

      ao.send({
        Target = msg.From,
        Action = 'Complete-Round-Response',
        Data = 'OK'
      })
    end
  )

  Handlers.add(
    'Cancel-Round',
    Handlers.utils.hasMatchingTag(
      'Action',
      'Cancel-Round'
    ),
    function (msg)
      ACL.assertHasOneOfRole(
        msg.From,
        { 'owner', 'admin', 'Cancel-Round' }
      )

      local timestamp = tonumber(msg.Tags['Timestamp'])
      AnyoneUtils.assertInteger(timestamp, 'Timestamp tag')
      if timestamp then
        assert(RelayRewards.PendingRounds[timestamp], 'No pending round for ' .. timestamp)
        RelayRewards.PendingRounds[timestamp] = nil
      end

      ao.send({
        Target = msg.From,
        Action = 'Cancel-Round-Response',
        Data = 'OK'
      })
    end
  )

  Handlers.add(
    'Set-Delegate',
    Handlers.utils.hasMatchingTag(
      'Action',
      'Set-Delegate'
    ),
    function (msg)
      local address = AnyoneUtils.normalizeEvmAddress(msg.From)
      AnyoneUtils.assertValidEvmAddress(address, 'Address tag')
      local result = 'NONE'
      local delegateAddress = msg.Tags['Address']
      if delegateAddress then
        AnyoneUtils.assertValidEvmAddress(delegateAddress, 'Delegate address tag')
        local delegateShare = msg.Tags['Share']
        if delegateShare then
          local share = tonumber(delegateShare)
          AnyoneUtils.assertNumber(share, 'Delegate.Share')

          assert(share >= 0, 'Delegate.Share has to be >= 0')
          assert(share <= 1, 'Delegate.Share has to be <= 1')
          result = 'OK'
          RelayRewards.Configuration.Delegates[address] = {
            Address = delegateAddress, Share = share
          }
        end
      else
        RelayRewards.Configuration.Delegates[address] = nil
        result = 'RESET'
      end

      ao.send({
        Target = msg.From,
        Action = 'Set-Delegate-Response',
        Data = result
      })
    end
  )

  Handlers.add(
    'Get-Delegate',
    Handlers.utils.hasMatchingTag(
      'Action',
      'Get-Delegate'
    ),
    function (msg)
      local address = AnyoneUtils.normalizeEvmAddress(msg.From)
      AnyoneUtils.assertValidEvmAddress(address, 'Address tag')
      local result = { Address = '', Share = 0 }
      if RelayRewards.Configuration.Delegates[address] then
        result = RelayRewards.Configuration.Delegates[address]
      end

      ao.send({
        Target = msg.From,
        Action = 'Get-Delegate-Response',
        Data = json.encode(result)
      })
    end
  )
  
  Handlers.add(
    'Get-Rewards',
    Handlers.utils.hasMatchingTag(
      'Action',
      'Get-Rewards'
    ),
    function (msg)
      local address = AnyoneUtils.normalizeEvmAddress(msg.Tags['Address'] or msg.From)
      AnyoneUtils.assertValidEvmAddress(address, 'Address tag')
      local result = '0'
      
      local fingerprint = msg.Tags['Fingerprint']
      if fingerprint then
        AnyoneUtils.assertValidFingerprint(fingerprint, 'Fingerprint tag')
        result = RelayRewards.TotalFingerprintReward[fingerprint]
      else
        result = RelayRewards.TotalAddressReward[address]
      end

      ao.send({
        Target = msg.From,
        Action = 'Get-Rewards-Response',
        Data = result
      })
    end
  )

  Handlers.add(
    'Last-Round-Metadata',
    Handlers.utils.hasMatchingTag(
      'Action',
      'Last-Round-Metadata'
    ),
    function (msg)
      local encoded = json.encode({
        Timestamp = RelayRewards.PreviousRound.Timestamp,
        Period = RelayRewards.PreviousRound.Period,
        Configuration = RelayRewards.PreviousRound.Configuration,
        Summary = RelayRewards.PreviousRound.Summary
      })

      ao.send({
        Target = msg.From,
        Action = 'Last-Round-Metadata-Response',
        Data = encoded
      })
    end
  )

  Handlers.add(
    'Last-Round-Data',
    Handlers.utils.hasMatchingTag(
      'Action',
      'Last-Round-Data'
    ),
    function (msg)
      local fingerprint = msg.Tags['Fingerprint']
      AnyoneUtils.assertValidFingerprint(fingerprint, 'Fingerprint tag')
      assert(RelayRewards.PreviousRound.Details[fingerprint], 'Fingerprint not found in round')
      
      local encoded = json.encode({
        Timestamp = RelayRewards.PreviousRound.Timestamp,
        Period = RelayRewards.PreviousRound.Period,
        Details = RelayRewards.PreviousRound.Details[fingerprint]
      })

      ao.send({
        Target = msg.From,
        Action = 'Last-Round-Data-Response',
        Data = encoded
      })
    end
  )

  Handlers.add(
    'Last-Snapshot',
    Handlers.utils.hasMatchingTag(
      'Action',
      'Last-Snapshot'
    ),
    function (msg)
      local encoded = json.encode(RelayRewards.PreviousRound)
      ao.send({
        Target = msg.From,
        Action = 'Last-Snapshot-Response',
        Data = encoded
      })
    end
  )

  Handlers.add(
    'Update-Roles',
    Handlers.utils.hasMatchingTag('Action', 'Update-Roles'),
    function (msg)
      ACL.assertHasOneOfRole(msg.From, { 'owner', 'admin', 'Update-Roles' })

      ACL.updateRoles(json.decode(msg.Data))

      ao.send({
        Target = msg.From,
        Action = 'Update-Roles-Response',
        Data = 'OK'
      })
    end
  )

  Handlers.add(
    'View-Roles',
    Handlers.utils.hasMatchingTag('Action', 'View-Roles'),
    function (msg)
      ao.send({
        Target = msg.From,
        Action = 'View-Roles-Response',
        Data = json.encode(ACL.State)
      })
    end
  )

  Handlers.add(
    'Init',
    Handlers.utils.hasMatchingTag('Action', 'Init'),
    function (msg)
      assert(msg.From == ao.env.Process.Owner, ErrorMessages.OnlyOwner)
      assert(
        RelayRewards._initialized == false,
        ErrorMessages.AlreadyInitialized
      )

      local initState = json.decode(msg.Data or '{}')

      if initState.Claimable then
        for address, claimable in pairs(initState.Claimable) do
          AnyoneUtils.assertValidEvmAddress(address)
          local normalizedAddress = AnyoneUtils.normalizeEvmAddress(address)
          local claimableNumber = tonumber(claimable)
          assert(
            type(claimableNumber) == 'number',
            'Claimable value must be a number'
          )
          assert(claimableNumber > 0, 'Claimable value must be positive')
          RelayRewards
            .TotalAddressReward[normalizedAddress] = AnyoneUtils.bigInt(
              claimableNumber
            )
        end
      end

      if initState.Configuration then
        local config = RelayRewards.Configuration
        RelayRewards._updateConfiguration(config, initState.Configuration)
      end

      RelayRewards._initialized = true

      ao.send({
        Target = msg.From,
        Action = 'Init-Response',
        Data = 'OK'
      })
    end
  )

end

RelayRewards.init()
