local RelayRewards = {
  AddressToReward = {},
  Modifiers = {
    TokensPerSecond = 0,
    Family = { Enabled = false, MultiplierOffset = 0 },
    Hardware = { Enabled = false, TokensPerSecond = 0 },
    Uptime = { Enabled = false, TokensPerSecond = 0,
      Tiers = {
          [0]: 0
      }
    }
  },
  FingerprintToState = {},
  PreviousRound = nil,
  PendingRounds = {}
}

function RelayRewards.init()
  local json = require("json")

  local ErrorMessages = require('.common.errors')
  local AnyoneUtils = require('.common.utils')

  Handlers.add(
    'Update-Modifiers',
    Handlers.utils.hasMatchingTag(
      'Action',
      'Update-Modifiers'
    ),
    function (msg)
      assert(msg.From == ao.env.Process.Owner, ErrorMessages.OnlyOwner)
      assert(msg.Data, ErrorMessages.MessageDataRequired)

      local effects = []
      local request = json.decode(msg.Data)

      if request.TokensPerSecond then
        AnyoneUtils.assertInteger(request.TokensPerSecond, 'TokensPerSecond')
        assert(request.TokensPerSecond >= 0, 'TokensPerSecond value has to be >= 0')
        RelayRewards.Modifiers.TokensPerSecond = request.TokensPerSecond
        effects += 'TokensPerSecond=' .. RelayRewards.Modifiers.TokensPerSecond
      end

      if request.Family then
        if request.Family.Enabled then
          assert(type(request.Family.Enabled) == 'boolean', ErrorMessages.BooleanValueRequired .. ' for Family.Enabled')
          RelayRewards.Modifiers.Family.Enabled = request.Family.Enabled
          effects += 'Family.Enabled=' .. RelayRewards.Modifiers.Family.Enabled
        end
        if request.Family.MultiplierOffset then
          AnyoneUtils.assertFloat(request.Family.MultiplierOffset, 'Family.MultiplierOffset')
          assert(request.Family.MultiplierOffset >= 0, 'Family.MultiplierOffset value has to be >= 0')
          RelayRewards.Modifiers.Family.MultiplierOffset = request.Family.MultiplierOffset
          effects += 'Family.MultiplierOffset=' .. RelayRewards.Modifiers.Family.MultiplierOffset
        end
      end

      if request.Hardware then
        if request.Hardware.Enabled then
          assert(type(request.Hardware.Enabled) == 'boolean', ErrorMessages.BooleanValueRequired .. ' for Hardware.Enabled')
          RelayRewards.Modifiers.Hardware.Enabled = request.Hardware.Enabled
          effects += 'Hardware.Enabled=' .. RelayRewards.Modifiers.Hardware.Enabled
        end
        if request.Hardware.TokensPerSecond then
          AnyoneUtils.assertInteger(request.Hardware.TokensPerSecond, 'Hardware.TokensPerSecond')
          assert(request.Hardware.TokensPerSecond >= 0, 'Hardware.TokensPerSecond value has to be >= 0')
          RelayRewards.Modifiers.Hardware.TokensPerSecond = request.Hardware.TokensPerSecond
          effects += 'Hardware.TokensPerSecond=' .. RelayRewards.Modifiers.Hardware.TokensPerSecond
        end
      end

      if request.Uptime then
        if request.Uptime.Enabled then
          assert(type(request.Uptime.Enabled) == 'boolean', ErrorMessages.BooleanValueRequired .. ' for Uptime.Enabled')
          RelayRewards.Modifiers.Uptime.Enabled = request.Uptime.Enabled
          effects += 'Uptime.Enabled=' .. RelayRewards.Modifiers.Uptime.Enabled
        end
        if request.Uptime.TokensPerSecond then
          AnyoneUtils.assertInteger(request.Uptime.TokensPerSecond, 'Uptime.TokensPerSecond')
          assert(request.Uptime.TokensPerSecond >= 0, 'Uptime.TokensPerSecond value has to be >= 0')
          RelayRewards.Modifiers.Uptime.TokensPerSecond = request.Uptime.TokensPerSecond
          effects += 'Uptime.TokensPerSecond=' .. RelayRewards.Modifiers.Uptime.TokensPerSecond
        end
        if request.Uptime.Tiers then
          assert(type(request.Uptime.Tiers) == 'table', 'Table type required for Uptime.Tiers')
          local tierCount = 0
          for key, value in pairs(request.Uptime.Tiers) do
            AnyoneUtils.assertInteger(key, 'Uptime.Tiers Key')
            AnyoneUtils.assertInteger(value, 'Uptime.Tiers Value')
            assert(tierCount < 42, 'Too many Uptime.Tiers')
            tierCount = tierCount + 1
          end
          RelayRewards.Modifiers.Uptime.Tiers = request.Uptime.Tiers
          effects += 'Uptime.Tiers=' .. RelayRewards.Modifiers.Uptime.Tiers
        end
      end

      ao.send({
        Target = msg.From,
        Action = 'Update-Modifiers-Response',
        Data = {
          Result = 'OK'
          Effect = effects
        }
      })
    end
  )

  Handlers.add(
    'Update-Fingerprint-To-State',
    Handlers.utils.hasMatchingTag(
      'Action',
      'Update-Fingerprint-To-State'
    ),
    function (msg)
      assert(msg.From == ao.env.Process.Owner, ErrorMessages.OnlyOwner)
      assert(msg.Data, ErrorMessages.MessageDataRequired)
      
      local request = json.decode(msg.Data)

      AnyoneUtils.assertValidFingerprint(request.Fingerprint, 'Valid Fingerprint required')
      assert(type(request.State) == 'table', 'Table type required for State')
      assert(type(request.State.Hardware) == 'boolean', 'Boolean type required for State.Hardware')
      assertInteger(request.State.UptimeStreak, 'State.UptimeStreak')
      assert(request.State.UptimeStreak >= 0, 'State.UptimeStreak has to be >= 0')
      assertInteger(request.State.FamilySize, 'State.FamilySize')
      assert(request.State.FamilySize >= 0, 'State.FamilySize has to be >= 0')

      RelayRewards.FingerprintToState[AnyoneUtils.normalizeEvmAddress(request.Fingerprint)] = request.State
      
      ao.send({
        Target = msg.From,
        Action = 'Update-Fingerprint-To-State-Response',
        Data = {
          Result = 'OK'
          Effect = RelayRewards.FingerprintToState[request.Fingerprint]
        }
      })
    end
  )

  Handlers.add(
    'Add-Scores-To-Pending-Round',
    Handlers.utils.hasMatchingTag(
      'Action',
      'Add-Scores-To-Pending-Round'
    ),
    function (msg)
      assert(msg.From == ao.env.Process.Owner, ErrorMessages.OnlyOwner)
      assert(msg.Data, ErrorMessages.MessageDataRequired)
      
      local request = json.decode(msg.Data)
      
      assertInteger(request.Timestamp, 'Timestamp')
      assert(request.Timestamp > 0, 'Timestamp has to be > 0')
      assert(request.Timestamp > RelayRewards.PreviousRound.Timestamp, 'Timestamp is backdated')
      
      assert(type(request.Scores) == 'table', 'Scores have to be a table')

      local function assertScore(score, key)
        AnyoneUtils.assertValidFingerprint(score.Fingerprint, 'Invalid Scores[' .. key .. '].Fingerprint')
        AnyoneUtils.assertValidEvmAddress(score.Address, 'Invalid Scores[' .. key .. '].Address')
        assertInteger(score.Score, 'Scores[' .. key .. '].Score')
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
          Score = value.Score
        }
      end

      ao.send({
        Target = msg.From,
        Action = 'Add-Scores-To-Pending-Round-Response',
        Data = {
          Result = 'OK'
        }
      })
    end
  )


  Handlers.add(
    'Complete-Pending-Round',
    Handlers.utils.hasMatchingTag(
      'Action',
      'Complete-Pending-Round'
    ),
    function (msg)
      assert(msg.From == ao.env.Process.Owner, ErrorMessages.OnlyOwner)
      assert(msg.Data, ErrorMessages.MessageDataRequired)
      
      local request = json.decode(msg.Data)
      local oldestPendingRoundStamp = AnyoneUtils.findLowestKey(RelayRewards.PendingRounds, 'PendingRounds key')
      assert(oldestPendingRoundStamp < math.huge, 'Missing oldest round stamp')

      local networkTotalScore = 0
      local hardwareTotalScore = 0
      local uptimeTotalScore = 0
      local uptimeScores = {}
      local modifiedScores = {}

      for fingerprint, data in RelayRewards.PendingRounds[oldestPendingRoundStamp] do
        local networkScore = data.Score
        local hardwareScore = 0
        local uptimeScore = 0

        local state = RelayRewards.FingerprintToState[fingerprint]

        if RelayRewards.Modifiers.Family.Enabled then
          networkScore = networkScore * (1 + RelayRewards.Modifiers.Family.MultiplierOffset * state.FamilySize)
          networkTotalScore = networkTotalScore + networkScore
        end

        if RelayRewards.Modifiers.Hardware.Enabled and state.Hardware then
          hardwareScore = networkScore
          hardwareTotalScore = hardwareTotalScore + hardwareScore
        end

        if RelayRewards.Modifiers.Uptime.Enabled then
          for key, value in RelayRewards.Modifiers.Uptime.Tiers do
            if key <= state.UptimeStreak and uptimeScore < value then
                uptimeScore = value
                uptimeScores[fingerprint] = value
                uptimeTotalScore = uptimeTotalScore + value
            end
          end
        end
        
        modifiedScores[fingerprint] = {
          Address = data.Address
          Network = networkScore
          Hardware = hardwareScore
          Uptime = uptimeScore
        }
      end

      local epochLength = 0
      if RelayRewards.PreviousRound then
        epochLength = oldestPendingRoundStamp - RelayRewards.PreviousRound.Timestamp
      end

      local networkRewards = RelayRewards.Modifiers.TokensPerSecond * epochLength / 1000
      local hardwareRewards = RelayRewards.Modifiers.Hardware.TokensPerSecond * epochLength / 1000
      local uptimeRewards = RelayRewards.Modifiers.Uptime.TokensPerSecond * epochLength / 1000

      local rewards = {}

      for fingerprint, modScore in modifiedScores do
        local networkTokens = 0
        if networkRewards > 0 then
          networkTokens = math.floor(networkRewards * modScore.Network / networkTotalScore)
        end
        local hardwareTokens = 0
        if hardwareRewards > 0 then
          hardwareTokens = math.floor(hardwareRewards * modScore.Hardware / hardwareTotalScore)
        end
        local uptimeTokens = 0
        if uptimeRewards > 0 then
          uptimeTokens = math.floor(uptimeRewards * modScore.Uptime / uptimeTotalScore)
        end
        local totalTokens = networkTokens + hardwareTokens + uptimeTokens
        rewards[fingerprint] = totalTokens
        
        if RelayRewards.AddressToReward[modScore.Address] == nil then
          RelayRewards.AddressToReward[modScore.Address] = AnyoneUtils.bigInt(0)
        end
        RelayRewards.AddressToReward[modScore.Address] = AnyoneUtils.bigAddScalar(RelayRewards.AddressToReward[modScore.Address], totalTokens)
      end

      RelayRewards.PreviousRound = {
        Timestamp: oldestPendingRoundStamp
        Scores: modifiedScores
        Rewards: rewards
      }

      RelayRewards.PendingRounds[oldestPendingRoundStamp] = nil

      ao.send({
        Target = msg.From,
        Action = 'Complete-Pending-Round-Response',
        Data = {
          Result = 'OK'
          Effect = RelayRewards.PreviousRound
        }
      })
    end
  )

  Handlers.add(
    'Cancel-Pending-Round',
    Handlers.utils.hasMatchingTag(
      'Action',
      'Cancel-Pending-Round'
    ),
    function (msg)
      assert(msg.From == ao.env.Process.Owner, ErrorMessages.OnlyOwner)
      assert(msg.Data, ErrorMessages.MessageDataRequired)
      
      local timestamp = msg.Tags['Timestamp']

      assert(RelayRewards.PendingRounds[timestamp], 'No pending round for ' .. timestamp)
      RelayRewards.PendingRounds[timestamp] = nil

      ao.send({
        Target = msg.From,
        Action = 'Cancel-Pending-Round-Response',
        Data = {
          Result = 'OK'
        }
      })
    end
  )

end
