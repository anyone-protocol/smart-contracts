local RelayRewards = {
  AddressToReward = {},
  Modifiers = {
    TokensPerSecond = 0,
    Family = { Enabled = false, MultiplierOffset = 0.1 },
    Uptime = { Enabled = false, TokensPerSecond = 0 },
    Hardware = { Enabled = false, TokensPerSecond = 0 },
  },
  FingerprintToState = {},
  PreviousRounds = {},
  PendingRounds = {}
}

function RelayRewards.init()
  local json = require("json")

  local ErrorMessages = require('.common.errors')
  local AnyoneUtils = require('.common.utils')

  Handlers.add(
    'Update-Modifiers-To-Relay-Rewards',
    Handlers.utils.hasMatchingTag(
      'Action',
      'Update-Modifiers-To-Relay-Rewards'
    ),
    function (msg)
      
      ao.send({
        Target = msg.From,
        Action = 'Update-Modifiers-To-Relay-Rewards-Response',
        Data = 'NOT_IMPLEMENTED'
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
      
      ao.send({
        Target = msg.From,
        Action = 'Update-Fingerprint-To-State-Response',
        Data = 'NOT_IMPLEMENTED'
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
      
      ao.send({
        Target = msg.From,
        Action = 'Add-Scores-To-Pending-Round-Response',
        Data = 'NOT_IMPLEMENTED'
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
      
      ao.send({
        Target = msg.From,
        Action = 'Complete-Pending-Round-Response',
        Data = 'NOT_IMPLEMENTED'
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

      ao.send({
        Target = msg.From,
        Action = 'Cancel-Pending-Round-Response',
        Data = 'NOT_IMPLEMENTED'
      })
    end
  )

end
