local RelayRegistry = {
  MasterIdsToFingerprints = {},
  SigningKeysToMasterIds = {},
  FingerprintsToOperatorAddresses = {},
  OperatorAddressesToFingerprints = {}
}

function RelayRegistry.init()
  local crypto = require(".crypto")
  local base64 = require(".base64")
  local json = require("json")

  local ErrorMessages = require('.common.errors')
  local Utils = require('.common.utils')

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
      RelayRegistry.MasterIdsToFingerprints[masterId] = fingerprintFromOkcc
      RelayRegistry.FingerprintsToOperatorAddresses[fingerprintFromOkcc]
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
        RelayRegistry.MasterIdsToFingerprints[encodedCertMasterId] ~= nil,
        ErrorMessages.InvalidCertificate
      )
      assert(msg.From == encodedCertMasterId, ErrorMessages.InvalidCertificate)

      local certSigningKey = string.sub(decodedCert, 40, 71)
      assert(string.len(certSigningKey) == 32, ErrorMessages.InvalidCertificate)
      local encodedCertSigningKey = base64.encode(certSigningKey)
      RelayRegistry.SigningKeysToMasterIds[encodedCertSigningKey]
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
        RelayRegistry.SigningKeysToMasterIds[msg.From] ~= nil,
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
        RelayRegistry.FingerprintsToOperatorAddresses[fingerprint]
          == 'Needs-Operator-Certificate',
        ErrorMessages.InvalidCertificate
      )
      RelayRegistry.FingerprintsToOperatorAddresses[fingerprint] = '0x'..address

      ao.send({
        Target = msg.From,
        Action = 'Submit-Operator-Certificate-Response',
        Data = 'OK'
      })
    end
  )

  Handlers.add(
    'Submit-Fingerprint-Certificate',
    Handlers.utils.hasMatchingTag('Action', 'Submit-Fingerprint-Certificate'),
    function (msg)
      local fingerprint = msg.Tags['Fingerprint-Certificate']
      assert(type(fingerprint) == 'string', ErrorMessages.InvalidCertificate)
      assert(string.len(fingerprint) == 40, ErrorMessages.InvalidCertificate)
      fingerprint = string.upper(fingerprint)
      local address = '0x'..string.upper(string.sub(msg.From, 3))

      assert(
        RelayRegistry.FingerprintsToOperatorAddresses[fingerprint] == address,
        ErrorMessages.InvalidCertificate
      )

      RelayRegistry.OperatorAddressesToFingerprints[msg.From] = fingerprint

      ao.send({
        Target = msg.From,
        Action = 'Submit-Fingerprint-Certificate-Response',
        Data = 'OK'
      })
    end
  )

  Handlers.add(
    'List-Fingerprint-Certificates',
    Handlers.utils.hasMatchingTag('Action', 'List-Fingerprint-Certificates'),
    function (msg)
      ao.send({
        Target = msg.From,
        Action = 'List-Fingerprint-Certificates-Response',
        Data = json.encode(RelayRegistry.FingerprintsToOperatorAddresses)
      })
    end
  )

  Handlers.add(
    'Renounce-Fingerprint-Certificate',
    Handlers.utils.hasMatchingTag('Action', 'Renounce-Fingerprint-Certificate'),
    function (msg)
      local fingerprint = msg.Tags['Fingerprint']
      assert(type(fingerprint) == 'string', ErrorMessages.FingerprintRequired)
      assert(
        RelayRegistry.OperatorAddressesToFingerprints[msg.From] == fingerprint,
        ErrorMessages.OnlyRelayOperatorCanRenounce
      )

      RelayRegistry.FingerprintsToOperatorAddresses[fingerprint] = nil

      ao.send({
        Target = msg.From,
        Action = 'Renounce-Fingerprint-Certificate-Response',
        Data = 'OK'
      })
    end
  )

  Handlers.add(
    'Remove-Fingerprint-Certificate',
    Handlers.utils.hasMatchingTag('Action', 'Remove-Fingerprint-Certificate'),
    function (msg)
      assert(msg.From == ao.env.Process.Owner, ErrorMessages.OnlyOwner)

      local fingerprint = msg.Tags['Fingerprint']
      assert(type(fingerprint) == 'string', ErrorMessages.FingerprintRequired)
      assert(string.len(fingerprint) == 40, ErrorMessages.InvalidCertificate)
      assert(
        RelayRegistry.FingerprintsToOperatorAddresses[fingerprint] ~= nil,
        ErrorMessages.UnknownFingerprint
      )

      RelayRegistry.FingerprintsToOperatorAddresses[fingerprint] = nil

      ao.send({
        Target = msg.From,
        Action = 'Remove-Fingerprint-Certificate-Response',
        Data = 'OK'
      })
    end
  )
end

RelayRegistry.init()
