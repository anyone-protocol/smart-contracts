local RelayDirectory = {
  MasterIdsToFingerprints = {},
  SigningKeysToMasterIds = {},
  FingerprintsToFamilies = {}
}

function RelayDirectory.init()
  local crypto = require(".crypto")
  local base64 = require(".base64")
  local json = require("json")

  local ErrorMessages = require('.common.errors')
  local AnyoneUtils = require('.common.utils')

  Handlers.add(
    'Submit-Onion-Key-Cross-Certificate',
    Handlers.utils.hasMatchingTag(
      'Action',
      'Submit-Onion-Key-Cross-Certificate'
    ),
    function (msg)
      local okcc = msg.Tags['Onion-Key-Cross-Certificate']
      assert(okcc, ErrorMessages.InvalidCertificate)

      local decodedOkcc = base64.decode(okcc)
      assert(type(decodedOkcc) == 'string', ErrorMessages.InvalidCertificate)
      assert(string.len(decodedOkcc) >= 52, ErrorMessages.InvalidCertificate)

      local fingerprintFromOkcc = string.upper(
        crypto.utils.hex.stringToHex(
          string.sub(decodedOkcc, 1, 20)
        )
      )
      local fingerprintFromCaller = string.upper(
        crypto.digest.sha1(
          crypto.utils.stream.fromString(base64.decode(msg.From))
        ).asHex()
      )
      assert(
        fingerprintFromCaller == fingerprintFromOkcc,
        ErrorMessages.InvalidCertificate
      )

      local masterId = base64.encode(string.sub(decodedOkcc, 21))
      RelayDirectory.MasterIdsToFingerprints[masterId] = fingerprintFromOkcc
      RelayDirectory.FingerprintsToOperatorAddresses[fingerprintFromOkcc]
        = 'Needs-Operator-Certificate'

      ao.send({
        Target = msg.From,
        Action = 'Submit-Onion-Key-Cross-Certificate-Response',
        Data = 'OK'
      })
    end
  )

  Handlers.add(
    'Submit-Signing-Certificate',
    Handlers.utils.hasMatchingTag('Action', 'Submit-Signing-Certificate'),
    function (msg)
      local cert = msg.Tags['Signing-Certificate']
      assert(cert, ErrorMessages.InvalidCertificate)

      local decodedCert = base64.decode(cert)
      assert(type(decodedCert) == 'string', ErrorMessages.InvalidCertificate)

      local certMasterId = string.sub(decodedCert, 77, 108)
      assert(string.len(certMasterId) == 32, ErrorMessages.InvalidCertificate)
      local encodedCertMasterId = base64.encode(certMasterId)
      assert(
        RelayDirectory.MasterIdsToFingerprints[encodedCertMasterId] ~= nil,
        ErrorMessages.InvalidCertificate
      )
      assert(msg.From == encodedCertMasterId, ErrorMessages.InvalidCertificate)

      local certSigningKey = string.sub(decodedCert, 40, 71)
      assert(string.len(certSigningKey) == 32, ErrorMessages.InvalidCertificate)
      local encodedCertSigningKey = base64.encode(certSigningKey)
      RelayDirectory.SigningKeysToMasterIds[encodedCertSigningKey]
        = encodedCertMasterId

      ao.send({
        Target = msg.From,
        Action = 'Submit-Signing-Certificate-Response',
        Data = 'OK'
      })
    end
  )

  Handlers.add(
    'Submit-Operator-Certificate',
    Handlers.utils.hasMatchingTag('Action', 'Submit-Operator-Certificate'),
    function (msg)
      local cert = msg.Tags['Operator-Certificate']
      assert(cert, ErrorMessages.InvalidCertificate)

      assert(
        RelayDirectory.SigningKeysToMasterIds[msg.From] ~= nil,
        ErrorMessages.InvalidCertificate
      )

      local decodedCert = base64.decode(cert)
      assert(type(decodedCert) == 'string', ErrorMessages.InvalidCertificate)
      assert(string.len(decodedCert) == 40, ErrorMessages.InvalidCertificate)

      local fingerprint = string.upper(
        crypto.utils.hex.stringToHex(string.sub(decodedCert, 1, 20))
      )
      local address = string.upper(
        crypto.utils.hex.stringToHex(string.sub(decodedCert, 21))
      )

      assert(
        RelayDirectory.FingerprintsToOperatorAddresses[fingerprint]
          == 'Needs-Operator-Certificate',
        ErrorMessages.InvalidCertificate
      )
      RelayDirectory.FingerprintsToOperatorAddresses[fingerprint] = '0x'..address

      ao.send({
        Target = msg.From,
        Action = 'Submit-Operator-Certificate-Response',
        Data = 'OK'
      })
    end
  )

  Handlers.add(
    'Set-Families',
    Handlers.utils.hasMatchingTag('Action', 'Set-Families'),
    function (msg)
      assert(msg.From == ao.env.Process.Owner, ErrorMessages.OnlyOwner)

      assert(msg.Data, ErrorMessages.FamiliesRequiredAsMessageData)
      local families = json.decode(msg.Data)
      assert(type(families) == 'table', ErrorMessages.InvalidFamilies)

      RelayDirectory.FingerprintsToFamilies = families

      ao.send({
        Target = msg.From,
        Action = 'Set-Families-Response',
        Data = 'OK'
      })
    end
  )

  Handlers.add(
    'List-Families',
    Handlers.utils.hasMatchingTag('Action', 'List-Families'),
    function (msg)
      ao.send({
        Target = msg.From,
        Action = 'Set-Families-Response',
        Data = json.encode(RelayDirectory.FingerprintsToFamilies)
      })
    end
  )
end
