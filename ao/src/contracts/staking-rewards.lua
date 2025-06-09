local StakingRewards = {
  _initialized = false,
  _sharesEnabled = false,
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
  Shares = {
-- [Operator Address] = 0.0
  },
  Configuration = {
    TokensPerSecond = '100000000',
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
  local bint = require('.bint')(256)

  if request.TokensPerSecond then
    assert(type(request.TokensPerSecond) == 'string', 'TokensPerSecond must be a string number')
    local safeTokens = bint.tobint(request.TokensPerSecond)
    assert(safeTokens ~= nil, 'TokensPerSecond must be an integer')
    assert(bint.ispos(safeTokens), 'TokensPerSecond must be a positive value')
    config.TokensPerSecond = tostring(safeTokens)
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
    'Toggle-Feature-Shares',
    Handlers.utils.hasMatchingTag(
      'Action',
      'Toggle-Feature-Shares'
    ),
    function (msg)
      ACL.assertHasOneOfRole(
        msg.From,
        { 'owner', 'admin', 'Toggle-Feature-Shares' }
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
      assert(type(request.Enabled) == 'boolean', 'Enabled must be a boolean')
      
      StakingRewards._sharesEnabled = request.Enabled

      ao.send({
        Target = msg.From,
        Action = 'Toggle-Feature-Shares-Response',
        Data = 'OK'
      })
    end
  )

  Handlers.add(
    'Set-Share',
    Handlers.utils.hasMatchingTag(
      'Action',
      'Set-Share'
    ),
    function (msg)
      assert(StakingRewards._sharesEnabled, 'Shares feature is disabled')
      local operatorAddress = AnyoneUtils.normalizeEvmAddress(msg.From)
      AnyoneUtils.assertValidEvmAddress(operatorAddress, 'Address tag')

      local request = nil
      local function parseData()
        request = json.decode(msg.Data)
      end

      local status, err = pcall(parseData)
      assert(err == nil, 'Data must be valid JSON')
      assert(status, 'Failed to parse input data')
      assert(request, 'Failed to parse data')
      
      AnyoneUtils.assertNumber(request.Share, 'Share')
      assert(request.Share >= 0, 'Share has to be >= 0')
      assert(request.Share <= 1, 'Share has to be <= 1')

      StakingRewards.Shares[operatorAddress] = request.Share

      ao.send({
        Target = msg.From,
        Action = 'Set-Share-Response',
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
      for hodlerAddress, scores in pairs(request.Scores) do
        AnyoneUtils.assertValidEvmAddress(hodlerAddress, 'Invalid Hodler Address:' .. hodlerAddress)
        local nHodlerAddress = AnyoneUtils.normalizeEvmAddress(hodlerAddress)
        if StakingRewards.PendingRounds[timestamp] then
          assert(StakingRewards.PendingRounds[timestamp][nHodlerAddress] == nil, 'Duplicated score for ' .. nHodlerAddress)
        end
        for operatorAddress, score in pairs(scores) do
          AnyoneUtils.assertValidEvmAddress(operatorAddress, 'Invalid Operator address: Scores[' .. hodlerAddress .. '][' .. operatorAddress .. ']')
          local nOperatorAddress = AnyoneUtils.normalizeEvmAddress(operatorAddress)
          
          assert(
            StakingRewards.PendingRounds[timestamp] == nil or
            StakingRewards.PendingRounds[timestamp][hodlerAddress] == nil or
            StakingRewards.PendingRounds[timestamp][hodlerAddress][nOperatorAddress] == nil, 'Duplicated score for ' .. hodlerAddress .. ' : ' .. nOperatorAddress)

          assert(type(score.Staked) == 'string', 'Scores[' .. hodlerAddress .. '][' .. operatorAddress .. '].Staked must be a string number')
          local staked = bint.tobint(score.Staked)
          assert(staked ~= nil, 'Scores[' .. hodlerAddress .. '][' .. operatorAddress .. '].Staked failed parsing to bint')
          assert(bint.ispos(staked), 'Scores[' .. hodlerAddress .. '][' .. operatorAddress .. '].Staked must be positive value')

          AnyoneUtils.assertNumber(score.Running, 'Scores[' .. hodlerAddress .. '][' .. operatorAddress .. '].Running')
          assert(score.Running >= 0, 'Scores[' .. hodlerAddress .. '][' .. operatorAddress .. '].Running has to be >= 0')
          assert(score.Running <= 1, 'Scores[' .. hodlerAddress .. '][' .. operatorAddress .. '].Running has to be <= 1')
        end
      end

      if StakingRewards.PendingRounds[timestamp] == nil then
        StakingRewards.PendingRounds[timestamp] = {}
      end

      for hodlerAddress, scores in pairs(request.Scores) do
        local nHodlerAddress = AnyoneUtils.normalizeEvmAddress(hodlerAddress)
        StakingRewards.PendingRounds[timestamp][nHodlerAddress] = {}
        for operatorAddress, score in pairs(scores) do
          local share = 0.0
          local nOperatorAddress = AnyoneUtils.normalizeEvmAddress(operatorAddress)
          if StakingRewards._sharesEnabled and StakingRewards.Shares[nOperatorAddress] ~= nil then
            share = StakingRewards.Shares[nOperatorAddress]
          end
          StakingRewards.PendingRounds[timestamp][nHodlerAddress][nOperatorAddress] = {
            Staked = tostring(bint(score.Staked)), Running = score.Running, Share = share,
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
      assert(StakingRewards.PendingRounds[timestamp], 'No pending round for ' .. timestamp)
      
      local summary = {
        Rewards = bint(0), Ratings = bint(0), Stakes = bint(0)
      }

      local roundData = {}
      
      for hodlerAddress, scores in pairs(StakingRewards.PendingRounds[timestamp]) do
        roundData[hodlerAddress] = {}
        for operatorAddress, score in pairs(scores) do
          local staked = bint(score.Staked)
          local restaked = bint(0)
          local rating = bint(0)
          if score.Running > StakingRewards.Configuration.Requirements.Running then
            if StakingRewards.Rewarded[hodlerAddress] ~= nil and 
                StakingRewards.Rewarded[hodlerAddress][operatorAddress] ~= nil then
              if StakingRewards.Claimed[hodlerAddress] ~= nil and 
                  StakingRewards.Claimed[hodlerAddress][operatorAddress] ~= nil then
                restaked = bint(StakingRewards.Rewarded[hodlerAddress][operatorAddress]) - bint(StakingRewards.Claimed[hodlerAddress][operatorAddress])
              else
                restaked = bint(StakingRewards.Rewarded[hodlerAddress][operatorAddress])
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
      if StakingRewards.PreviousRound.Timestamp > 0 then
        local msInSec = 1000
        roundLength = bint((timestamp - StakingRewards.PreviousRound.Timestamp) // msInSec)
      end

      local tokensPerSecond = bint(StakingRewards.Configuration.TokensPerSecond)
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
          if StakingRewards.Rewarded[hodlerAddress] == nil then
            StakingRewards.Rewarded[hodlerAddress] = {}
          end
          local previousHodlerReward = bint(0)
          if StakingRewards.Rewarded[hodlerAddress][operatorAddress] ~= nil then
            previousHodlerReward = bint(StakingRewards.Rewarded[hodlerAddress][operatorAddress])
          end
          local hodlerReward = data.Reward.Hodler + previousHodlerReward
          if bint.ispos(hodlerReward) then
            StakingRewards.Rewarded[hodlerAddress][operatorAddress] = tostring(hodlerReward)
          end
          
          if StakingRewards.Rewarded[operatorAddress] == nil then
            StakingRewards.Rewarded[operatorAddress] = {}
          end
          local previousOperatorReward = bint(0)
          if StakingRewards.Rewarded[operatorAddress][operatorAddress] ~= nil then
            previousOperatorReward = bint(StakingRewards.Rewarded[operatorAddress][operatorAddress])
          end
          local operatorReward = data.Reward.Operator + previousOperatorReward
          if bint.ispos(operatorReward) then
            StakingRewards.Rewarded[operatorAddress][operatorAddress] = tostring(operatorReward)
          end
          
          dataWithStrings[hodlerAddress][operatorAddress] = {
            Score = {
              Staked = tostring(data.Score.Staked),
              Restaked = tostring(data.Score.Restaked),
              Running = data.Score.Running,
              Share = data.Score.Share
            },
            Rating = tostring(data.Rating),
            Reward = { Hodler = tostring(data.Reward.Hodler), Operator = tostring(data.Reward.Operator)}
          }
        end
      end

      StakingRewards.PreviousRound = {
        Timestamp = timestamp,
        Period = bint.tonumber(roundLength),
        Summary = {
          Stakes = tostring(summary.Stakes),
          Ratings = tostring(summary.Ratings),
          Rewards = tostring(summary.Rewards)
        },
        Configuration = StakingRewards.Configuration,
        Details = dataWithStrings
      }

      for roundStamp, _ in pairs(StakingRewards.PendingRounds) do
        if roundStamp <= timestamp then
          StakingRewards.PendingRounds[roundStamp] = nil
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
    'Get-Claimed',
    Handlers.utils.hasMatchingTag(
      'Action',
      'Get-Claimed'
    ),
    function (msg)
      local address = AnyoneUtils.normalizeEvmAddress(msg.Tags['Address'] or msg.From)
      AnyoneUtils.assertValidEvmAddress(address, 'Address tag')

      local claimed = StakingRewards.Claimed[address]
      
      ao.send({
        Target = msg.From,
        Action = 'Get-Claimed-Response',
        Data = json.encode(claimed)
      })
    end
  )

  Handlers.add(
    'Claim-Rewards',
    Handlers.utils.hasMatchingTag(
      'Action',
      'Claim-Rewards'
    ),
    function (msg)
      ACL.assertHasOneOfRole(
        msg.From,
        { 'owner', 'admin', 'Claim-Rewards' }
      )

      local hodlerAddress = AnyoneUtils.normalizeEvmAddress(msg.Tags['Address'])
      AnyoneUtils.assertValidEvmAddress(hodlerAddress, 'Address tag')

      local rewarded = StakingRewards.Rewarded[hodlerAddress]
      assert(rewarded, 'No rewards for ' .. hodlerAddress)

      if (StakingRewards.Claimed[hodlerAddress] == nil) then
        StakingRewards.Claimed[hodlerAddress] = {}
      end
      for operatorAddress, reward in pairs(rewarded) do
        StakingRewards.Claimed[hodlerAddress][operatorAddress] = StakingRewards.Rewarded[hodlerAddress][operatorAddress]
      end
      
      ao.send({
        Target = msg.From,
        Action = 'Claim-Rewards-Response',
        Data = json.encode(rewarded)
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
      local result = {}
      if StakingRewards.Rewarded[hodlerAddress] ~= nil then
        result.Rewarded = StakingRewards.Rewarded[hodlerAddress]
      else
        result.Rewarded = {}
      end
      if StakingRewards.Claimed[hodlerAddress] ~= nil then
        result.Claimed = StakingRewards.Claimed[hodlerAddress]
      else
        result.Claimed = {}
      end

      ao.send({
        Target = msg.From,
        Action = 'Get-Rewards-Response',
        Data = json.encode(result)
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
        Timestamp = StakingRewards.PreviousRound.Timestamp,
        Period = StakingRewards.PreviousRound.Period,
        Configuration = StakingRewards.PreviousRound.Configuration,
        Summary = StakingRewards.PreviousRound.Summary
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
      local hodlerAddress =AnyoneUtils.normalizeEvmAddress(msg.Tags['Address'] or msg.From)
      AnyoneUtils.assertValidEvmAddress(hodlerAddress, 'Address tag')

      assert(StakingRewards.PreviousRound.Details[hodlerAddress], 'Address not found in previous round')
      
      local encoded = json.encode({
        Timestamp = StakingRewards.PreviousRound.Timestamp,
        Period = StakingRewards.PreviousRound.Period,
        Details = StakingRewards.PreviousRound.Details[hodlerAddress]
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
    'View-State',
    Handlers.utils.hasMatchingTag('Action', 'View-State'),
    function (msg)
      local result = {
        _initialized = StakingRewards._initialized,
        _sharesEnabled = StakingRewards._sharesEnabled,
        Claimed = StakingRewards.Claimed,
        Rewarded = StakingRewards.Rewarded,
        Shares = StakingRewards.Shares,
        Configuration = StakingRewards.Configuration,
        PreviousRound = {
          Timestamp = StakingRewards.PreviousRound.Timestamp,
          Period = StakingRewards.PreviousRound.Period,
          Summary = StakingRewards.PreviousRound.Summary,
        }
      }
      ao.send({
        Target = msg.From,
        Action = 'View-Roles-Response',
        Data = json.encode(result)
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

      if initState._sharesEnabled ~= nil then
        assert(type(initState._sharesEnabled) == 'boolean', '_sharesEnabled must be a boolean')
        StakingRewards._sharesEnabled = initState._sharesEnabled
      end

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
            if StakingRewards.Rewarded[nHodlerAddress] == nil then
              StakingRewards.Rewarded[nHodlerAddress] = {}
            end
            StakingRewards.Rewarded[nHodlerAddress][nOperatorAddress] = tostring(safeReward)
          end
        end
      end

      if initState.Claimed then
        for hodlerAddress, rewards in pairs(initState.Claimed) do
          AnyoneUtils.assertValidEvmAddress(hodlerAddress)
          local nHodlerAddress = AnyoneUtils.normalizeEvmAddress(hodlerAddress)
          for operatorAddress, Claim in pairs(rewards) do
            local nOperatorAddress = AnyoneUtils.normalizeEvmAddress(operatorAddress)
            assert(type(Claim) == 'string', 'Claim for ' .. nHodlerAddress .. ' of stake for ' .. nOperatorAddress .. ' must be a string number')
            local safeReward = bint.tobint(Claim)
            assert(safeReward ~= nil, 'Claim for ' .. nHodlerAddress .. ' of stake for ' .. nOperatorAddress .. ' must be an integer')
            assert(bint.ispos(safeReward), 'Claim for ' .. nHodlerAddress .. ' of stake for ' .. nOperatorAddress .. ' must be a positive value')
            if StakingRewards.Claimed[nHodlerAddress] == nil then
              StakingRewards.Claimed[nHodlerAddress] = {}
            end
            StakingRewards.Claimed[nHodlerAddress][nOperatorAddress] = tostring(safeReward)
          end
        end
      end

      if initState.Shares then
        for operatorAddress, share in pairs(initState.Shares) do
          AnyoneUtils.assertValidEvmAddress(operatorAddress)
          local nOperatorAddress = AnyoneUtils.normalizeEvmAddress(operatorAddress)
          AnyoneUtils.assertNumber(share, 'Share for ' .. nOperatorAddress)
          StakingRewards.Shares[nOperatorAddress] = share
        end
      end

      if initState.Configuration then
        local config = StakingRewards.Configuration
        StakingRewards._updateConfiguration(config, initState.Configuration)
      end

      if initState.PreviousRound then
        AnyoneUtils.assertInteger(initState.PreviousRound.Timestamp, 'PreviousRound.Timestamp')
        AnyoneUtils.assertInteger(initState.PreviousRound.Period, 'PreviousRound.Period')
        assert(initState.PreviousRound.Summary, 'PreviousRound.Summary is required')
        StakingRewards.PreviousRound = initState.PreviousRound
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
