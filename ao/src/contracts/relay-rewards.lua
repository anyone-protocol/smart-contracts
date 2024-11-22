local RelayRewards = {
  TotalAddressReward = {
-- [Address] = { High: 0, Low: 0 }
  },
  TotalFingerprintReward = {
-- [Fingerprint] = { High: 0, Low: 0 }
  },

  Configuration = {
    TokensPerSecond = 28935184200000000,
    Modifiers = {
      Network = { Share = 0.56 },
      Hardware = { Enabled = false, Share = 0.2 },
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
    Length = 0,
    Summary = {
      Total = 0, Network = 0, Hardware = 0, Uptime = 0, ExitBonus = 0
    },
    Configuration = {},
    Details = {
-- [Fingerprint] = { 
--   Address = ''
--   Score = { Network = 0, IsHardware = false, UptimeStreak = 0, ExitBonus = false, FamilySize = 1, LocationSize = 0 }
--   Rating = { Network, Hardware, Uptime, ExitBonus }
--   Configuration = { Family = {}, Location = {}, Uptime = {} }
--   Reward = {
--     Total = 0, OperatorTotal = 0, DelegateTotal = 0,
--     Network = 0, Hardware = 0, Uptime = 0, ExitBonus = 0 
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

      local effects = {}
      local config = RelayRewards.Configuration
      
      local request = nil
      local function parseData()
        request = json.decode(msg.Data)
      end

      local status, err = pcall(parseData)
      assert(err == nil, 'Data must be valid JSON')
      assert(status, 'Failed to parse input data')
      assert(request, 'Failed to parse data')
      
      if request.TokensPerSecond then
        AnyoneUtils.assertInteger(request.TokensPerSecond, 'TokensPerSecond')
        assert(request.TokensPerSecond >= 0, 'TokensPerSecond has to be >= 0')
        config.TokensPerSecond = request.TokensPerSecond
        table.insert(effects, 'TokensPerSecond')
      end
      if request.Modifiers then
        if request.Modifiers.Network then
          AnyoneUtils.assertNumber(request.Modifiers.Network.Share, 'Modifiers.Network.Share')
          assert(request.Modifiers.Network.Share >= 0, 'Modifiers.Network.Share has to be >= 0')
          assert(request.Modifiers.Network.Share <= 1, 'Modifiers.Network.Share has to be <= 1')
          config.Modifiers.Network.Share = request.Modifiers.Network.Share
          table.insert(effects, 'Modifiers.Network')
        end
        if request.Modifiers.Hardware then
          assert(type(request.Modifiers.Hardware.Enabled) == 'boolean', ErrorMessages.BooleanValueRequired .. ' for Modifiers.Hardware.Enabled')
          AnyoneUtils.assertNumber(request.Modifiers.Hardware.Share, 'Modifiers.Hardware.Share')
          assert(request.Modifiers.Hardware.Share >= 0, 'Modifiers.Hardware.Share has to be >= 0')
          assert(request.Modifiers.Hardware.Share <= 1, 'Modifiers.Hardware.Share has to be <= 1')
          config.Modifiers.Hardware.Enabled = request.Modifiers.Hardware.Enabled
          config.Modifiers.Hardware.Share = request.Modifiers.Hardware.Share
          table.insert(effects, 'Modifiers.Hardware')
        end
        if request.Modifiers.Uptime then
          assert(type(request.Modifiers.Uptime.Enabled) == 'boolean', ErrorMessages.BooleanValueRequired .. ' for Modifiers.Uptime.Enabled')
          AnyoneUtils.assertNumber(request.Modifiers.Uptime.Share, 'Modifiers.Uptime.Share')
          assert(request.Modifiers.Uptime.Share >= 0, 'Modifiers.Uptime.Share has to be >= 0')
          assert(request.Modifiers.Uptime.Share <= 1, 'Modifiers.Uptime.Share has to be <= 1')
          config.Modifiers.Uptime.Enabled = request.Modifiers.Uptime.Enabled
          config.Modifiers.Uptime.Share = request.Modifiers.Uptime.Share
          table.insert(effects, 'Modifiers.Uptime')

          if request.Modifiers.Uptime.Tiers then
            assert(type(request.Modifiers.Uptime.Tiers) == 'table', 'Table type required for Modifiers.Uptime.Tiers')
            local tierCount = 0
            for days, multiplier in pairs(request.Modifiers.Uptime.Tiers) do
              local daysInt = tonumber(days)
              AnyoneUtils.assertInteger(daysInt, 'Modifiers.Uptime.Tiers days')
              assert(daysInt >= 0, 'Modifiers.Uptime.Tiers days has to be >= 0')
              local multiplierFloat = tonumber(multiplier)
              AnyoneUtils.assertNumber(multiplierFloat, 'Modifiers.Uptime.Tiers multiplier')
              assert(multiplierFloat >= 0, 'Modifiers.Uptime.Tiers Value has to be >= 0')
              assert(tierCount < 42, 'Too many Modifiers.Uptime.Tiers')
              tierCount = tierCount + 1
            end
            config.Modifiers.Uptime.Tiers = request.Modifiers.Uptime.Tiers
            table.insert(effects, 'Modifiers.Uptime.Tiers')
          end
        end
        if request.Modifiers.ExitBonus then
          assert(type(request.Modifiers.ExitBonus.Enabled) == 'boolean', ErrorMessages.BooleanValueRequired .. ' for Modifiers.ExitBonus.Enabled')
          AnyoneUtils.assertNumber(request.Modifiers.ExitBonus.Share, 'Modifiers.ExitBonus.Share')
          assert(request.Modifiers.ExitBonus.Share >= 0, 'Modifiers.ExitBonus.Share has to be >= 0')
          assert(request.Modifiers.ExitBonus.Share <= 1, 'Modifiers.ExitBonus.Share has to be <= 1')
          config.Modifiers.ExitBonus.Enabled = request.Modifiers.ExitBonus.Enabled
          config.Modifiers.ExitBonus.Share = request.Modifiers.ExitBonus.Share
          table.insert(effects, 'Modifiers.ExitBonus.Share')
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
          table.insert(effects, 'Multipliers.Family')
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
          table.insert(effects, 'Multipliers.Location')
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
      assert(msg.From == ao.env.Process.Owner, ErrorMessages.OnlyOwner)
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
      assert(msg.From == ao.env.Process.Owner, ErrorMessages.OnlyOwner)
      
      local timestamp = tonumber(msg.Tags['Timestamp'])
      AnyoneUtils.assertInteger(timestamp, 'Timestamp tag')
      assert(RelayRewards.PendingRounds[timestamp], 'No pending round for ' .. timestamp)

      local roundData = {}
      
      local summary = {
        Ratings = { Network = 0, Hardware = 0, Uptime = 0, ExitBonus = 0 },
        Rewards = { Total = 0, Network = 0, Hardware = 0, Uptime = 0, ExitBonus = 0 }
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

        roundData[fingerprint].Rating = { Network = networkScore, Hardware = 0, Uptime = 0, ExitBonus = 0 }

        local uptimeTierMultiplier = 0.0
        for days, multiplier in pairs(RelayRewards.Configuration.Modifiers.Uptime.Tiers) do
          local daysInt = tonumber(days)
          local multiplierFloat = tonumber(multiplier)
          assert(multiplierFloat, 'Multiplier must be a number')
          if daysInt <= scoreData.Score.UptimeStreak and uptimeTierMultiplier < multiplierFloat then
            uptimeTierMultiplier = multiplierFloat
          end
        end
        roundData[fingerprint].Rating.Uptime = uptimeTierMultiplier * networkScore

        if RelayRewards.Configuration.Modifiers.Hardware.Enabled and scoreData.Score.IsHardware then
          roundData[fingerprint].Rating.Hardware = math.floor(0.65 * networkScore + 0.35 * roundData[fingerprint].Rating.Uptime)
        end

        if RelayRewards.Configuration.Modifiers.ExitBonus.Enabled and scoreData.Score.ExitBonus then
          roundData[fingerprint].Rating.ExitBonus = networkScore
        end

        roundData[fingerprint].Configuration = {
          FamilyMultiplier = familyMultiplier,
          LocationMultiplier = locationMultiplier,
          UptimeTierMultiplier = uptimeTierMultiplier
        }

        summary.Ratings.Network = summary.Ratings.Network + roundData[fingerprint].Rating.Network
        summary.Ratings.Hardware = summary.Ratings.Hardware + roundData[fingerprint].Rating.Hardware
        summary.Ratings.Uptime = summary.Ratings.Uptime + roundData[fingerprint].Rating.Uptime
        summary.Ratings.ExitBonus = summary.Ratings.ExitBonus + roundData[fingerprint].Rating.ExitBonus
      end

      local roundLength = 0
      if RelayRewards.PreviousRound.Timestamp > 0 then
        roundLength = (timestamp - RelayRewards.PreviousRound.Timestamp) // 1000
      end

      local totalRewardsPerRound = RelayRewards.Configuration.TokensPerSecond * roundLength
      
      local networkRewardsPerSec = math.floor(RelayRewards.Configuration.TokensPerSecond * RelayRewards.Configuration.Modifiers.Network.Share)
      local networkRewards = networkRewardsPerSec * roundLength

      local hardwareRewards = 0
      local hardwareRewardsPerSec = 0
      if RelayRewards.Configuration.Modifiers.Hardware.Enabled then
        hardwareRewardsPerSec = math.floor(RelayRewards.Configuration.TokensPerSecond * RelayRewards.Configuration.Modifiers.Hardware.Share)
        hardwareRewards = hardwareRewardsPerSec * roundLength
      end 

      local uptimeRewards = 0
      local uptimeRewardsPerSec = 0
      if RelayRewards.Configuration.Modifiers.Uptime.Enabled then
        uptimeRewardsPerSec = math.floor(RelayRewards.Configuration.TokensPerSecond * RelayRewards.Configuration.Modifiers.Uptime.Share)
        uptimeRewards = uptimeRewardsPerSec * roundLength
      end

      local exitBonusRewards = 0
      local exitBonusRewardsPerSec = 0
      if RelayRewards.Configuration.Modifiers.ExitBonus.Enabled then
        exitBonusRewardsPerSec = math.floor(RelayRewards.Configuration.TokensPerSecond * RelayRewards.Configuration.Modifiers.ExitBonus.Share)
        exitBonusRewards = exitBonusRewardsPerSec * roundLength
      end

      local fingerprintRewardsPerSec = networkRewardsPerSec + hardwareRewardsPerSec + uptimeRewardsPerSec + exitBonusRewardsPerSec
      assert(totalRewardsPerRound >= fingerprintRewardsPerSec * roundLength, 'Failed rewards share calculation')
      
      for fingerprint, ratedData in pairs(roundData) do
        roundData[fingerprint].Reward = {
          Total = 0,
          OperatorTotal = 0,
          DelegateTotal = 0,
          Network = 0,
          Hardware = 0,
          Uptime = 0,
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

            summary.Rewards.Total = summary.Rewards.Total + roundData[fingerprint].Reward.Total
            summary.Rewards.Network = summary.Rewards.Network + roundData[fingerprint].Reward.Network
            summary.Rewards.Hardware = summary.Rewards.Hardware + roundData[fingerprint].Reward.Hardware
            summary.Rewards.Uptime = summary.Rewards.Uptime + roundData[fingerprint].Reward.Uptime
            summary.Rewards.ExitBonus = summary.Rewards.ExitBonus + roundData[fingerprint].Reward.ExitBonus
      end

      RelayRewards.PreviousRound = {
        Timestamp = timestamp,
        Period = roundLength,
        Summary = summary,
        Configuration = RelayRewards.Configuration,
        Details = roundData
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
      assert(msg.From == ao.env.Process.Owner, ErrorMessages.OnlyOwner)
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
      local address = AnyoneUtils.normalizeEvmAddress(msg.From)
      AnyoneUtils.assertValidEvmAddress(address, 'Address tag')
      local result = '0'
      
      local fingerprint = msg.Tags['Fingerprint']
      if fingerprint then
        AnyoneUtils.assertValidFingerprint(fingerprint, 'Fingerprint tag')
        result = AnyoneUtils.bigString(RelayRewards.TotalFingerprintReward[fingerprint])
      else
        result = AnyoneUtils.bigString(RelayRewards.TotalAddressReward[address])
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
        Action = 'Last-Round-Metadata',
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
        Action = 'Last-Round-Data',
        Data = encoded
      })
    end
  )

end

RelayRewards.init()
