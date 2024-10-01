local RelayRegistry = {
  MasterIdsToFingerprints = {},
  SigningKeysToMasterIds = {},
  FingerprintsToOperatorAddresses = {},
  BlockedOperatorAddresses = {},
  RegistrationCreditsFingerprintsToOperatorAddresses = {},
  VerifiedHardwareFingerprints = {},
  FingerprintsToFamilies = {}
}

function RelayRegistry.init()
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
      assert(
        RelayRegistry.BlockedOperatorAddresses[msg.From] == nil,
        ErrorMessages.AddressIsBlocked
      )

      local fingerprint = msg.Tags['Fingerprint-Certificate']
      AnyoneUtils.assertValidFingerprint(
        fingerprint,
        ErrorMessages.InvalidCertificate
      )

      -- NB: Storing Operator Addresses as 0x<ALLCAPS>
      local address = '0x'..string.upper(string.sub(msg.From, 3))

      assert(
        RelayRegistry.FingerprintsToOperatorAddresses[fingerprint] == address,
        ErrorMessages.InvalidCertificate
      )

      if (RelayRegistry.VerifiedHardwareFingerprints[fingerprint] ~= true) then
        assert(
          RelayRegistry
            .RegistrationCreditsFingerprintsToOperatorAddresses[fingerprint]
              == msg.From,
          ErrorMessages.RegistrationCreditRequired
        )
      end

      -- TODO -> enforce families here
      

      RelayRegistry.FingerprintsToOperatorAddresses[fingerprint] = msg.From
      RelayRegistry
          .RegistrationCreditsFingerprintsToOperatorAddresses[fingerprint] = nil

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
      AnyoneUtils.assertValidFingerprint(fingerprint)
      assert(
        RelayRegistry.FingerprintsToOperatorAddresses[fingerprint] == msg.From,
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

  Handlers.add(
    'Block-Operator-Address',
    Handlers.utils.hasMatchingTag('Action', 'Block-Operator-Address'),
    function (msg)
      assert(msg.From == ao.env.Process.Owner, ErrorMessages.OnlyOwner)

      local address = msg.Tags['Address']
      assert(type(address) == 'string', ErrorMessages.AddressRequired)
      AnyoneUtils.assertValidEvmAddress(address)

      RelayRegistry.BlockedOperatorAddresses[address] = true

      ao.send({
        Target = msg.From,
        Action = 'Block-Operator-Address-Response',
        Data = 'OK'
      })
    end
  )

  Handlers.add(
    'List-Blocked-Operator-Addresses',
    Handlers.utils.hasMatchingTag('Action', 'List-Blocked-Operator-Addresses'),
    function (msg)
      ao.send({
        Target = msg.From,
        Action = 'List-Blocked-Operator-Addresses-Response',
        Data = json.encode(RelayRegistry.BlockedOperatorAddresses)
      })
    end
  )

  Handlers.add(
    'Unblock-Operator-Address',
    Handlers.utils.hasMatchingTag('Action', 'Unblock-Operator-Address'),
    function (msg)
      assert(msg.From == ao.env.Process.Owner, ErrorMessages.OnlyOwner)

      local address = msg.Tags['Address']
      assert(type(address) == 'string', ErrorMessages.AddressRequired)
      AnyoneUtils.assertValidEvmAddress(address)

      assert(
        RelayRegistry.BlockedOperatorAddresses[address] ~= nil,
        ErrorMessages.AddressIsNotBlocked
      )

      RelayRegistry.BlockedOperatorAddresses[address] = nil

      ao.send({
        Target = msg.From,
        Action = 'Unblock-Operator-Address-Response',
        Data = 'OK'
      })
    end
  )

  Handlers.add(
    'Add-Registration-Credit',
    Handlers.utils.hasMatchingTag('Action', 'Add-Registration-Credit'),
    function (msg)
      assert(msg.From == ao.env.Process.Owner, ErrorMessages.OnlyOwner)

      local address = msg.Tags['Address']
      assert(type(address) == 'string', ErrorMessages.AddressRequired)
      AnyoneUtils.assertValidEvmAddress(address)

      local fingerprint = msg.Tags['Fingerprint']
      assert(type(fingerprint) == 'string', ErrorMessages.FingerprintRequired)
      AnyoneUtils.assertValidFingerprint(fingerprint)

      assert(
        RelayRegistry
          .RegistrationCreditsFingerprintsToOperatorAddresses[fingerprint]
            == nil,
        ErrorMessages.RegistrationCreditAlreadyAdded
      )

      RelayRegistry
        .RegistrationCreditsFingerprintsToOperatorAddresses[fingerprint]
          = address

      ao.send({
        Target = msg.From,
        Action = 'Add-Registration-Credit-Response',
        Data = 'OK'
      })
    end
  )

  Handlers.add(
    'List-Registration-Credits',
    Handlers.utils.hasMatchingTag('Action', 'List-Registration-Credits'),
    function (msg)
      ao.send({
        Target = msg.From,
        Action = 'List-Registration-Credits-Response',
        Data = json.encode(
          RelayRegistry.RegistrationCreditsFingerprintsToOperatorAddresses
        )
      })
    end
  )

  Handlers.add(
    'Remove-Registration-Credit',
    Handlers.utils.hasMatchingTag('Action', 'Remove-Registration-Credit'),
    function (msg)
      assert(msg.From == ao.env.Process.Owner, ErrorMessages.OnlyOwner)

      local address = msg.Tags['Address']
      assert(type(address) == 'string', ErrorMessages.AddressRequired)
      AnyoneUtils.assertValidEvmAddress(address)

      local fingerprint = msg.Tags['Fingerprint']
      assert(type(fingerprint) == 'string', ErrorMessages.FingerprintRequired)
      AnyoneUtils.assertValidFingerprint(fingerprint)

      assert(
        RelayRegistry
          .RegistrationCreditsFingerprintsToOperatorAddresses[fingerprint]
            ~= nil,
        ErrorMessages.RegistrationCreditDoesNotExist
      )

      RelayRegistry
        .RegistrationCreditsFingerprintsToOperatorAddresses[fingerprint] = nil

      ao.send({
        Target = msg.From,
        Action = 'Remove-Registration-Credit-Response',
        Data = 'OK'
      })
    end
  )

  Handlers.add(
    'Add-Verified-Hardware',
    Handlers.utils.hasMatchingTag('Action', 'Add-Verified-Hardware'),
    function (msg)
      assert(msg.From == ao.env.Process.Owner, ErrorMessages.OnlyOwner)

      local fingerprints = msg.Tags['Fingerprints']
      assert(type(fingerprints) == 'string', ErrorMessages.FingerprintsRequired)

      for fingerprint in string.gmatch(fingerprints, '[^,]+') do
        AnyoneUtils.assertValidFingerprint(fingerprint)
        assert(
          RelayRegistry.VerifiedHardwareFingerprints[fingerprint] == nil,
          ErrorMessages.DuplicateFingerprint
        )

        RelayRegistry.VerifiedHardwareFingerprints[fingerprint] = true
      end

      ao.send({
        Target = msg.From,
        Action = 'Add-Verified-Hardware-Response',
        Data = 'OK'
      })
    end
  )

  Handlers.add(
    'List-Verified-Hardware',
    Handlers.utils.hasMatchingTag('Action', 'List-Verified-Hardware'),
    function (msg)
      ao.send({
        Target = msg.From,
        Action = 'List-Verified-Hardware-Response',
        Data = json.encode(RelayRegistry.VerifiedHardwareFingerprints)
      })
    end
  )

  Handlers.add(
    'Remove-Verified-Hardware',
    Handlers.utils.hasMatchingTag('Action', 'Remove-Verified-Hardware'),
    function (msg)
      assert(msg.From == ao.env.Process.Owner, ErrorMessages.OnlyOwner)

      local fingerprints = msg.Tags['Fingerprints']
      assert(type(fingerprints) == 'string', ErrorMessages.FingerprintsRequired)

      for fingerprint in string.gmatch(fingerprints, '[^,]+') do
        AnyoneUtils.assertValidFingerprint(fingerprint)
        assert(
          RelayRegistry.VerifiedHardwareFingerprints[fingerprint] ~= nil,
          ErrorMessages.UnknownFingerprint
        )

        RelayRegistry.VerifiedHardwareFingerprints[fingerprint] = nil
      end

      ao.send({
        Target = msg.From,
        Action = 'Remove-Verified-Hardware-Response',
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

      RelayRegistry.FingerprintsToFamilies = families

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
        Data = json.encode(RelayRegistry.FingerprintsToFamilies)
      })
    end
  )
end

RelayRegistry.init()
