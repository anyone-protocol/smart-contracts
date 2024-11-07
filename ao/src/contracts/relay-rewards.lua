local RelayRewards = {
  TotalAddressReward = {
-- [Address] = { High: 0, Low: 0 }
  }
  TotalFingerprintReward = {
-- [Fingerprint] = { High: 0, Low: 0 }
  }

  Configuration = {
    TokensPerSecond = 28935184200000000
    Modifiers = {
      Network = { Share = 0.56 }
      Hardware = { Enabled = false, Share = 0.2 }
      Uptime = { Enabled = false, Share = 0.14
        Tiers = {
          [0]: 0
          [3]: 1
          [14]: 3
        }
      }
      ExitBonus = { Enabled = false, Share = 0.1 }
    }
    Multipliers = {
      Family = { Enabled = false, Offset = -0.01, Power = 1 }
      Location = { Enabled = false, Offset = -0.003, Power = 2 }
    }
    Delegates = { 
--      [Address] = { Address: '', Share = 0 }
    }
  }
  PreviousRound = {
    Timestamp = 0
    Summary = {
      Total = 0, Network = 0, Hardware = 0, Uptime = 0, ExitBonus = 0 
    }
    Configuration = {}
    Details = {
-- [Fingerprint] = { 
--   Address = ''
--   Score = { Network = 0, IsHardware = false, UptimeStreak = 0, ExitBonus = false, FamilySize = 1, Location = '' }
--   Rating = { Network, Hardware, Uptime, ExitBonus }
--   Configuration = { Family = {}, Location = {}, Uptime = {} }
--   Reward = {
--     Total = 0, OperatorTotal = 0, DelegateTotal = 0,
--     Network = 0, Hardware = 0, Uptime = 0, ExitBonus = 0 
--   }
-- }
    }
  }
  PendingRounds = {
-- Timestamp = {
--   Fingerprint = {
--     Address = ''
--     Score = {
--       Network = 0
--       IsHardware = false
--       UptimeStreak = 0
--       FamilySize = 1
--       ExitBonus = false
--       LocationSize = 0
--     }
--   }
-- }
  }
}

function RelayRewards.init()
  local json = require("json")

  local ErrorMessages = require('.common.errors')
  local AnyoneUtils = require('.common.utils')

  Handlers.add(
    'Update-Configuration',
    Handlers.utils.hasMatchingTag(
      'Action',
      'Update-Configuration'
    ),
    function (msg)
      assert(msg.From == ao.env.Process.Owner, ErrorMessages.OnlyOwner)
      assert(msg.Data, ErrorMessages.MessageDataRequired)

      local effects = []
      local config = RelayRewards.Configuration
      local request = json.decode(msg.Data)
      
      if request.TokensPerSecond then
        AnyoneUtils.assertInteger(request.TokensPerSecond, 'TokensPerSecond')
        assert(request.TokensPerSecond >= 0, 'TokensPerSecond value has to be >= 0')
        config.TokensPerSecond = request.TokensPerSecond
        effects += 'TokensPerSecond\n'
      end
      if request.Modifiers then
        if request.Modifiers.Network then
          AnyoneUtils.assertNumber(request.Modifiers.Network.Share, 'Modifiers.Network.Share')
          assert(request.Modifiers.Network.Share >= 0, 'Modifiers.Network.Share value has to be >= 0')
          assert(request.Modifiers.Network.Share <= 1, 'Modifiers.Network.Share value has to be <= 1')
          config.Modifiers.Network.Share = request.Modifiers.Network.Share
          effects += 'Modifiers.Network\n'
        end
        if request.Modifiers.Hardware then
          assert(type(request.Modifiers.Hardware.Enabled) == 'boolean', ErrorMessages.BooleanValueRequired .. ' for Modifiers.Hardware.Enabled')
          AnyoneUtils.asserNumber(request.Modifiers.Hardware.Share, 'Modifiers.Hardware.Share')
          assert(request.Modifiers.Hardware.Share >= 0, 'Modifiers.Hardware.Share value has to be >= 0')
          assert(request.Modifiers.Hardware.Share <= 1, 'Modifiers.Hardware.Share value has to be <= 1')
          config.Modifiers.Hardware.Enabled = request.Modifiers.Hardware.Enabled
          config.Modifiers.Hardware.Share = request.Modifiers.Hardware.Share
          effects += 'Modifiers.Hardware\n'
        end
        if request.Modifiers.Uptime then
          assert(type(request.Modifiers.Uptime.Enabled) == 'boolean', ErrorMessages.BooleanValueRequired .. ' for Modifiers.Uptime.Enabled')
          AnyoneUtils.assertNumber(request.Modifiers.Uptime.Share, 'Modifiers.Uptime.Share')
          assert(request.Modifiers.Uptime.Share >= 0, 'Modifiers.Uptime.Share value has to be >= 0')
          assert(request.Modifiers.Uptime.Share <= 1, 'Modifiers.Uptime.Share value has to be <= 1')
          config.Modifiers.Uptime.Enabled = request.Modifiers.Uptime.Enabled
          config.Modifiers.Uptime.Share = request.Modifiers.Uptime.Share
          effects += 'Modifiers.Uptime\n'

          if request.Modifiers.Uptime.Tiers then
            assert(type(request.Modifiers.Uptime.Tiers) == 'table', 'Table type required for Modifiers.Uptime.Tiers')
            local tierCount = 0
            for key, value in pairs(request.Modifiers.Uptime.Tiers) do
              AnyoneUtils.assertInteger(key, 'Modifiers.Uptime.Tiers Key')
              assert(key >= 0, 'Modifiers.Uptime.Tiers Key has to be >= 0')
              AnyoneUtils.assertNumber(value, 'Modifiers.Uptime.Tiers Value')
              assert(value >= 0, 'Modifiers.Uptime.Tiers Value has to be >= 0')
              assert(tierCount < 42, 'Too many Modifiers.Uptime.Tiers')
              tierCount = tierCount + 1
            end
            config.Modifiers.Uptime.Tiers = request.Modifiers.Uptime.Tiers
            effects += 'Modifiers.Uptime.Tiers\n'
          end
        end
        if request.Modifiers.ExitBonus then
          assert(type(request.Modifiers.ExitBonus.Enabled) == 'boolean', ErrorMessages.BooleanValueRequired .. ' for Modifiers.ExitBonus.Enabled')
          AnyoneUtils.assertNumber(request.Modifiers.ExitBonus.Share, 'Modifiers.ExitBonus.Share')
          assert(request.Modifiers.ExitBonus.Share >= 0, 'Modifiers.ExitBonus.Share value has to be >= 0')
          assert(request.Modifiers.ExitBonus.Share <= 1, 'Modifiers.ExitBonus.Share value has to be <= 1')
          config.Modifiers.ExitBonus.Enabled = request.Modifiers.ExitBonus.Enabled
          config.Modifiers.ExitBonus.Share = request.Modifiers.ExitBonus.Share
          effects += 'Modifiers.ExitBonus.Share\n'
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
          assert(request.Multipliers.Family.Offset >= 0, 'Multipliers.Family.Offset value has to be >= 0')
          assert(request.Multipliers.Family.Offset <= 1, 'Multipliers.Family.Offset value has to be <= 1')
          AnyoneUtils.assertNumber(request.Multipliers.Family.Power, 'Multipliers.Family.Power')
          assert(request.Multipliers.Family.Power >= 0, 'Multipliers.Family.Power value has to be >= 0')
          config.Multipliers.Family.Enabled = request.Multipliers.Family.Enabled
          config.Multipliers.Family.Offset = request.Configuration.Multipliers.Family.Offset
          config.Multipliers.Family.Power = request.Configuration.Multipliers.Family.Power
          effects += 'Multipliers.Family\n'
        end
        if request.Multipliers.Location then
          assert(type(request.Multipliers.Location.Enabled) == 'boolean', ErrorMessages.BooleanValueRequired .. ' for Multipliers.Location.Enabled')
          AnyoneUtils.assertNumber(request.Multipliers.Location.Offset, 'Multipliers.Location.Offset')
          assert(request.Multipliers.Location.Offset >= 0, 'Multipliers.Location.Offset value has to be >= 0')
          assert(request.Multipliers.Location.Offset <= 1, 'Multipliers.Location.Offset value has to be <= 1')
          AnyoneUtils.assertNumber(request.Multipliers.Location.Power, 'Multipliers.Location.Power')
          assert(request.Multipliers.Location.Power >= 0, 'Multipliers.Location.Power value has to be >= 0')
          config.Multipliers.Location.Enabled = request.Multipliers.Location.Enabled
          config.Multipliers.Location.Offset = request.Configuration.Multipliers.Location.Offset
          config.Multipliers.Location.Power = request.Configuration.Multipliers.Location.Power
          effects += 'Multipliers.Location\n'
        end
      end
      if request.Delegates then
        assert(type(request.Delegates) == 'table', 'Delegates have to be a table')
        for operatorAddress, delegation in request.Delegates do
          AnyoneUtils.assertValidEvmAddress(operatorAddress, 'Invalid operator address')
          AnyoneUtils.assertValidEvmAddress(delegation.Address, 'Invalid delegated address')
          AnyoneUtils.assertNumber(delegation.Share, 'Delegates['.. fingerprint .. '].Share')
          assert(delegation.Share >= 0, 'Delegates['.. fingerprint .. '].Share value has to be >= 0')
          assert(delegation.Share <= 1, 'Delegates['.. fingerprint .. '].Share value has to be <= 1')
        end
      end

      RelayRewards.Configuration = config

      ao.send({
        Target = msg.From,
        Action = 'Update-Configuration-Response',
        Data = {
          Result = 'OK'
          Effect = effects
        }
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
      assert(msg.From == ao.env.Process.Owner, ErrorMessages.OnlyOwner)
      assert(msg.Data, ErrorMessages.MessageDataRequired)
      
      local request = json.decode(msg.Data)
      
      AnyoneUtils.assertInteger(request.Timestamp, 'Timestamp')
      assert(request.Timestamp > 0, 'Timestamp has to be > 0')
      assert(request.Timestamp > RelayRewards.PreviousRound.Timestamp, 'Timestamp is backdated')
      
      assert(type(request.Scores) == 'table', 'Scores have to be a table')

      local function assertScore(score, key)
        AnyoneUtils.assertValidFingerprint(score.Fingerprint, 'Invalid Scores[' .. key .. '].Fingerprint')
        AnyoneUtils.assertValidEvmAddress(score.Address, 'Invalid Scores[' .. key .. '].Address')
        AnyoneUtils.assertInteger(score.Network, 'Scores[' .. key .. '].Network')
        assert(score.Network >= 0, 'Scores[' .. key .. '].Network has to be >= 0')
        assert(type(score.IsHardware) == 'boolean', 'Scores[' .. key .. '].IsHardware')
        AnyoneUtils.assertInteger(score.UptimeStreak, 'Scores[' .. key .. '].UptimeStreak')
        assert(score.UptimeStreak >= 0, 'Scores[' .. key .. '].UptimeStreak has to be >= 0')
        assert(type(score.ExitBonus) == 'boolean', 'Scores[' .. key .. '].ExitBonus')
        AnyoneUtils.assertInteger(score.FamilySize, 'Scores[' .. key .. '].FamilySize')
        assert(score.FamilySize >= 0, 'Scores[' .. key .. '].FamilySize has to be >= 0')
        AnyoneUtils.assertInteger(score.LocationSize, 'Scores[' .. key .. '].LocationSize')
        assert(score.LocationSize >= 0, 'Scores[' .. key .. '].LocationSize has to be >= 0')
      end

      for key, value in request.Scores do 
        assertScore(value, key)
        if RelayRewards.PendingRounds[request.Timestamp] then
          assert(RelayRewards.PendingRounds[request.Timestamp][value.Fingerprint] == nil, 'Duplicated score for ' .. fingerprint)
        end
      end

      if RelayRewards.PendingRounds[request.Timestamp] == nil then
        RelayRewards.PendingRounds[request.Timestamp] = {}
      end

      for _, value in request.Scores do
        RelayRewards.PendingRounds[request.Timestamp][value.Fingerprint] = {
          Address = value.Address
          Score = {}
        }
        RelayRewards.PendingRounds[request.Timestamp][value.Fingerprint].Score = {
          Network = value.Network
          IsHardware = value.IsHardware
          UptimeStreak = value.UptimeStreak
          FamilySize = value.FamilySize
          ExitBonus = value.ExitBonus
          LocationSize = value.LocationSize
        }
      end

      ao.send({
        Target = msg.From,
        Action = 'Add-Scores-Response',
        Data = {
          Result = 'OK'
        }
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
      assert(msg.From == ao.env.Process.Owner, ErrorMessages.OnlyOwner)
      
      local timestamp = msg.Tags['Timestamp']
      assertInteger(timestamp, 'Timestamp tag')
      assert(RelayRewards.PendingRounds[timestamp], 'No pending round for ' .. timestamp)

      local roundData = {}
      
      local summary = {
        Ratings = { Network = 0, Hardware = 0, Uptime = 0, ExitBonus = 0 }
        Rewards = { Total = 0, Network = 0, Hardware = 0, Uptime = 0, ExitBonus = 0 }
      }

      for fingerprint, scoreData in RelayRewards.PendingRounds[timestamp] do
        roundData[fingerprint].Address = scoreData.Address
        roundData[fingerprint].Score = scoreData.Score
        
        local networkScore = scoreData.Score.Network

        local familyMultiplier = 1 
        if RelayRewards.Configuration.Multipliers.Family.Enabled then
          familyMultiplier = 1 + RelayRewards.Configuration.Multipliers.Family.Offset * math.Power(scoreData.Score.FamilySize, RelayRewards.Configuration.Multipliers.Family.Power)
          if familyMultiplier < 0 then
            familyMultiplier = 0
          end
          networkScore = networkScore * familyMultiplier
        end
        local locationMultiplier = 1
        if RelayRewards.Configuration.Multipliers.Location.Enabled then
          locationMultiplier = 1 + RelayRewards.Configuration.Multipliers.Location.Offset * math.Power(scoreData.Score.LocationSize, RelayRewards.Configuration.Multipliers.Location.Power)
          if locationMultiplier < 0 then
            locationMultiplier = 0
          end
          networkScore = networkScore * locationMultiplier
        end

        roundData[fingerprint].Rating = { Network = networkScore, Hardware = 0, Uptime = 0, ExitBonus = 0 }

        local uptimeTierMultiplier = 0
        for key, value in RelayRewards.Configuration.Modifiers.Uptime.Tiers do
          if key <= scoreData.Score.UptimeStreak and uptimeTierMultiplier < value then
            uptimeTierMultiplier = value
          end
        end
        roundData[fingerprint].Rating.Uptime = uptimeTierMultiplier * networkScore

        if RelayRewards.Configuration.Modifiers.Hardware.Enabled and scoreData.Score.IsHardware then
          roundData[fingerprint].Rating.Hardware = 0.65 * networkScore + 0.35 * roundData[fingerprint].Rating.Uptime
        end

        if RelayRewards.Configuration.Modifiers.ExitBonus.Enabled and state.ExitBonus then
          roundData[fingerprint].Rating.ExitBonus = networkScore
        end

        roundData[fingerprint].Configuration = { 
          FamilyMultiplier = familyMultiplier
          LocationMultiplier = locationMultiplier
          UptimeTierMultiplier = uptimeTierMultiplier
        }

        summary.Ratings.Network = summary.Ratings.Network + roundData[fingerprint].Rating.Network
        summary.Ratings.Hardware = summary.Ratings.Hardware + roundData[fingerprint].Rating.Hardware
        summary.Ratings.Uptime = summary.Ratings.Uptime + roundData[fingerprint].Rating.Uptime
        summary.Ratings.ExitBonus = summary.Ratings.ExitBonus + roundData[fingerprint].Rating.ExitBonus
      end

      local roundLength = 0
      if RelayRewards.PreviousRound then
        roundLength = (timestamp - RelayRewards.PreviousRound.Timestamp) // 1000
      end

      local totalRewardsPerSec = RelayRewards.Configuration.TokensPerSecond * roundLength
      
      local networkRewardsPerSec = math.floor(RelayRewards.Configuration.TokensPerSecond * RelayRewards.Configuration.Modifiers.Network.Share)
      local networkRewards = networkRewardsPerSec * roundLength

      local hardwareRewards = 0
      if RelayRewards.Configuration.Modifiers.Hardware.Enabled then
        local hardwareRewardsPerSec = math.floor(RelayRewards.Configuration.TokensPerSecond * RelayRewards.Configuration.Modifiers.Hardware.Share)
        local hardwareRewards = hardwareRewardsPerSec * roundLength
      end 

      local uptimeRewards = 0
      if RelayRewards.Configuration.Modifiers.Uptime.Enabled then
        local uptimeRewardsPerSec = math.floor(RelayRewards.Configuration.TokensPerSecond * RelayRewards.Configuration.Modifiers.Uptime.Share)
        uptimeRewards = uptimeRewardsPerSec * roundLength
      end

      local exitBonusRewards = 0
      if RelayRewards.Configuration.Modifiers.ExitBonus.Enabled then
        local exitBonusRewardsPerSec = math.floor(RelayRewards.Configuration.TokensPerSecond * RelayRewards.Configuration.Modifiers.ExitBonus.Share)
        exitBonusRewards = exitBonusRewardsPerSec * roundLength
      end

      assert(totalRewardsPerSec >= (networkRewardsPerSec + hardwareRewardsPerSec + uptimeRewardsPerSec + exitBonusRewards), 'Failed rewards share calculation')
      
      for fingerprint, ratedData in roundData do
        roundData[fingerprint].Reward = {
          Total = 0
          OperatorTotal = 0
          DelegateTotal = 0
          Network = 0
          Hardware = 0
          Uptime = 0
          ExitBonus = 0
        }
        if summary.Ratings.Network > 0 then
          local networkWeight = ratedData.Rating.Network / summary.Ratings.Network
          roundData[fingerprint].Reward.Network = math.floor(networkRewards * networkWeight)
        end
        if summary.Ratings.Hardware > 0 then
          local hardwareWeight = ratedData.Rating.Hardware / summary.Ratings.Hardware
          roundData[fingerprint].Reward.Hardware = math.floor(hardwareRewards * hardwareWeight)
        end
        if summary.Ratings.Uptime > 0 then
          local uptimeWeight = ratedData.Rating.Uptime / summary.Ratings.Uptime
          roundData[fingerprint].Reward.Uptime = math.floor(uptimeRewards * uptimeWeight)
        end
        if summary.Ratings.ExitBonus > 0 then
          local exitBonusWeight = ratedData.Rating.ExitBonus / summary.Ratings.ExitBonus
          roundData[fingerprint].Reward.ExitBonus = math.floor(exitBonusRewards * exitBonusWeight)
        end
        
        roundData[fingerprint].Reward.Total = roundData[fingerprint].Reward.Network + 
            roundData[fingerprint].Reward.Hardware + roundData[fingerprint].Reward.Uptime + 
            roundData[fingerprint].Reward.ExitBonus
        
        local operatorAddress = roundData[fingerprint].Address
        local delegate = RelayRewards.Configuration.Delegates[operatorAddress]
        if delegate and delegate.Share > 0 then
          local delegateTotal = math.floor(delegate.Share * roundData[fingerprint].Reward.Total)
          local operatorTotal = roundData[fingerprint].Reward.Total - delegateTotal
          roundData[fingerprint].Reward.OperatorTotal = operatorTotal
          roundData[fingerprint].Reward.DelegateTotal = delegateTotal
          local normalizedDelegateAddress = AnyoneUtils.normalizeEvmAddress(delegate.Address)
          RelayRewards.TotalAddressReward[normalizedDelegateAddress] = AnyoneUtils.bigAddScalar(
            RelayRewards.TotalAddressReward[normalizedDelegateAddress],
            roundData[fingerprint].Reward.DelegateTotal
          )
        else
          roundData[fingerprint].Reward.OperatorTotal = roundData[fingerprint].Reward.Total
          roundData[fingerprint].Reward.DelegateTotal = 0
        end
        local normalizedOperatorAddress = AnyoneUtils.normalizeEvmAddress(operatorAddress)
        RelayRewards.TotalAddressReward[normalizedOperatorAddress] = AnyoneUtils.bigAddScalar(
            RelayRewards.TotalAddressReward[normalizedOperatorAddress],
            roundData[fingerprint].Reward.OperatorTotal
          )

        RelayRewards.TotalFingerprintReward[fingerprint] = AnyoneUtils.bigAddScalar(
            RelayRewards.TotalFingerprintReward[fingerprint], roundData[fingerprint].Reward.Total)
      end

      RelayRewards.PreviousRound = {
        Timestamp = timestamp
        Summary = summary
        Configuration = RelayRewards.Configuration
        Details = roundData
      }

      for key, _ in RelayRewards.PendingRounds do
        if key <= timestamp then
          RelayRewards.PendingRounds[key] = nil
        end 
      end

      ao.send({
        Target = msg.From,
        Action = 'Complete-Round-Response',
        Data = {
          Result = 'OK'
          Effect = RelayRewards.PreviousRound
        }
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
      assert(msg.From == ao.env.Process.Owner, ErrorMessages.OnlyOwner)
      
      local timestamp = msg.Tags['Timestamp']
      assertInteger(timestamp, 'Timestamp tag')

      assert(RelayRewards.PendingRounds[timestamp], 'No pending round for ' .. timestamp)
      RelayRewards.PendingRounds[timestamp] = nil

      ao.send({
        Target = msg.From,
        Action = 'Cancel-Round-Response',
        Data = {
          Result = 'OK'
        }
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
      local address = AnyoneUtils.normalizeEvmAddress(msg.From, 3)
      AnyoneUtils.assertValidEvmAddress(address, 'Address tag')
      local result = 'NONE'
      local delegateAddress = msg.Tags['Address']
      if delegateAddress then
        AnyoneUtils.assertValidEvmAddress(delegateAddress, 'Delegate address tag')
        local delegateShare = msg.Tags['Share']
        AnyoneUtils.assertNumber(delegateShare, 'Delegate.Share')
        assert(delegation.Share >= 0, 'Delegate.Share value has to be >= 0')
        assert(delegation.Share <= 1, 'Delegate.Share value has to be <= 1')
        result = 'OK'
        RelayRewards.Configuration.Delegates[address] = { 
          Address = delegateAddress, Share = delegateShare
        }
      else
        RelayRewards.Configuration.Delegates[address] = nil
        result = 'RESET'
      end

      ao.send({
        Target = msg.From,
        Action = 'Set-Delegate-Response',
        Data = {
          Result = result
        }
      })
    end
  )

end
