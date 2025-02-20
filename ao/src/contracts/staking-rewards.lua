local StakingRewards = {
  _initialized = false,
  Claimed = {
-- [Address] = { // Hodler
--   [Address] = '0' // Operator -> Hodler's score per operator stake
-- }
  },
  Rewarded = {
-- [Address] = { // Hodler
--   [Address] = '0' // Operator -> Hodler's score per operator stake
-- }
  },

  Configuration = {
    TokensPerSecond = 100000000,
    Requirements = {
      Running = 0.5
    }
  },
  PreviousRound = {
    Timestamp = 0,
    Period = 0,
    Summary = {
      Rewards = '0',
      Ratings = '0',
      Stakes = '0'
    },
    Configuration = {},
    Details = {
-- [Address] = { // Hodler
--   Total = {
--     Reward = '0'
--     Staked = '0'
--     Restaked = '0'
--   }
--   [Address] = { // Operator
--     Score = {
--       Staked = '0'
--       Restaked = '0'
--       Running = 0.0
--       Share = 0.0
--     }
--     Rating = '0'
--     Reward = {
--       Hodler = '0'
--       Operator = '0'
--     }
--   }
-- }
    }
  },
  PendingRounds = {
-- Timestamp = {
--   [Address] = { // Hodler
--     [Address] = { // Operator
--       Staked = '0'
--       Running = 0.0
--       Share = 0.05
--     }
--   }
-- }
  }
}

function StakingRewards._updateConfiguration(config, request)
  local AnyoneUtils = require('.common.utils')

  if request.TokensPerSecond then
    AnyoneUtils.assertInteger(request.TokensPerSecond, 'TokensPerSecond')
    assert(request.TokensPerSecond >= 0, 'TokensPerSecond has to be >= 0')
    config.TokensPerSecond = request.TokensPerSecond
  end
  if request.Requirements then
    if request.Requirements.Running then
      AnyoneUtils.assertNumber(request.Requirements.Running, 'Requirements.Running')
      assert(request.Requirements.Running >= 0, 'Requirements.Running has to be >= 0')
      assert(request.Requirements.Running <= 1, 'Requirements.Running has to be <= 1')
      config.Requirements.Running = request.Requirements.Running
    end
  end

  StakingRewards.Configuration = config
end

function StakingRewards.init()
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

      local request = nil
      local function parseData()
        request = json.decode(msg.Data)
      end

      local status, err = pcall(parseData)
      assert(err == nil, 'Data must be valid JSON')
      assert(status, 'Failed to parse input data')
      assert(request, 'Failed to parse data')
      
      local config = StakingRewards.Configuration
      StakingRewards._updateConfiguration(config, request)

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
      assert(timestamp > StakingRewards.PreviousRound.Timestamp, 'Timestamp is backdated')

      assert(type(request.Scores) == 'table', 'Scores have to be a table')

      local function assertScore(score, hodlerAddress)
        AnyoneUtils.assertValidEvmAddress(score.Address, 'Invalid Scores[' .. hodlerAddress .. '].Address')
        local nOperatorAddress = AnyoneUtils.normalizeEvmAddress(score.Address)
        
        assert(
          StakingRewards.PendingRounds[timestamp] == nil or
          StakingRewards.PendingRounds[timestamp][hodlerAddress] == nil or
          StakingRewards.PendingRounds[timestamp][hodlerAddress][nOperatorAddress] == nil, 'Duplicated score for ' .. hodlerAddress .. ' : ' .. nOperatorAddress)

        assert(type(score.Staked) == 'string', 'Scores[' .. hodlerAddress .. '].Staked must be a string number')
        local staked = bint.tobint(score.Staked)
        assert(staked ~= nil, 'Scores[' .. hodlerAddress .. '].Staked failed parsing to bint')
        assert(not bint.iszero(staked), 'Scores[' .. hodlerAddress .. '].Staked must be a non zero value')

        AnyoneUtils.assertNumber(score.Running, 'Scores[' .. hodlerAddress .. '].Running')
        AnyoneUtils.assertNumber(score.Share, 'Scores[' .. hodlerAddress .. '].Share')
        assert(score.Share >= 0, 'Scores[' .. hodlerAddress .. '].Share has to be >= 0')
        assert(score.Share <= 1, 'Scores[' .. hodlerAddress .. '].Share has to be <= 1') 
      end

      for hodlerAddress, score in pairs(request.Scores) do
        AnyoneUtils.assertValidEvmAddress(hodlerAddress, 'Invalid Hodler Address:' .. hodlerAddress)
        local nHodlerAddress = AnyoneUtils.normalizeEvmAddress(hodlerAddress)
        assertScore(score, nHodlerAddress)
        if StakingRewards.PendingRounds[timestamp] then
          assert(StakingRewards.PendingRounds[timestamp][nHodlerAddress] == nil, 'Duplicated score for ' .. nHodlerAddress)
        end
      end

      if StakingRewards.PendingRounds[timestamp] == nil then
        StakingRewards.PendingRounds[timestamp] = {}
      end

      for hodlerAddress, score in pairs(request.Scores) do
        StakingRewards.PendingRounds[timestamp][hodlerAddress] = {
          Total = { Reward = '0', Staked = '0', Restaked = '0' }
        }

        for operatorAddress, data in pairs(score) do          
          StakingRewards.PendingRounds[timestamp][hodlerAddress][operatorAddress] = {
            Staked = bint(data.Staked), Running = data.Running, Share = data.Share,
          }
        end
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
          locationMultiplier = 1 - RelayRewards.Configuration.Multipliers.Location.Offset * ((scoreData.Score.LocationSize / RelayRewards.Configuration.Multipliers.Location.Divider)^RelayRewards.Configuration.Multipliers.Location.Power)
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
          if not bint.iszero(hwTotalWeight) then
            roundData[fingerprint].Reward.Hardware = (hardwareRewards * hwUnitWeight) // hwTotalWeight
          end
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
        assert(StakingRewards.PendingRounds[timestamp], 'No pending round for ' .. timestamp)
        StakingRewards.PendingRounds[timestamp] = nil
      end

      ao.send({
        Target = msg.From,
        Action = 'Cancel-Round-Response',
        Data = 'OK'
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
      local hodlerAddress = AnyoneUtils.normalizeEvmAddress(msg.Tags['Address'] or msg.From)
      AnyoneUtils.assertValidEvmAddress(hodlerAddress, 'Address tag')
      local result = '{}'

      if StakingRewards.Rewarded[hodlerAddress] ~= nil then
        result = json.encode(StakingRewards.Rewarded[hodlerAddress])
      end

      ao.send({
        Target = msg.From,
        Action = 'Get-Rewards-Response',
        Data = result
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
      local encoded = json.encode(StakingRewards.PreviousRound)
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
        StakingRewards._initialized == false,
        ErrorMessages.AlreadyInitialized
      )

      local initState = json.decode(msg.Data or '{}')

      if initState.Rewarded then
        for hodlerAddress, rewards in pairs(initState.Rewarded) do
          AnyoneUtils.assertValidEvmAddress(hodlerAddress)
          local nHodlerAddress = AnyoneUtils.normalizeEvmAddress(hodlerAddress)
          for operatorAddress, reward in pairs(rewards) do
            local nOperatorAddress = AnyoneUtils.normalizeEvmAddress(operatorAddress)
            assert(type(reward) == 'string', 'Reward for ' .. nHodlerAddress .. ' of stake for ' .. nOperatorAddress .. ' must be a string number')
            local safeReward = bint.tobint(reward)
            assert(safeReward ~= nil, 'Reward for ' .. nHodlerAddress .. ' of stake for ' .. nOperatorAddress .. ' must be an integer')
            assert(bint.ispos(safeReward), 'Reward for ' .. nHodlerAddress .. ' of stake for ' .. nOperatorAddress .. ' must be a positive value')
            StakingRewards.Rewarded[nHodlerAddress][nOperatorAddress] = tostring(safeReward)
          end
        end
      end

      if initState.Configuration then
        local config = StakingRewards.Configuration
        StakingRewards._updateConfiguration(config, initState.Configuration)
      end

      StakingRewards._initialized = true

      ao.send({
        Target = msg.From,
        Action = 'Init-Response',
        Data = 'OK'
      })
    end
  )

end

StakingRewards.init()
