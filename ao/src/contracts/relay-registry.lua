local RelayRegistry = {
  FingerprintsToOperatorAddresses = {},
  BlockedOperatorAddresses = {},
  RegistrationCreditsFingerprintsToOperatorAddresses = {},
  VerifiedHardwareFingerprints = {}
}

function RelayRegistry.init()
  local json = require('json')

  local ErrorMessages = require('.common.errors')
  local AnyoneUtils = require('.common.utils')

  Handlers.add(
    'Admin-Submit-Operator-Certificates',
    Handlers.utils.hasMatchingTag(
      'Action',
      'Admin-Submit-Operator-Certificates'
    ),
    function (msg)
      assert(msg.From == ao.env.Process.Owner, ErrorMessages.OnlyOwner)
      assert(msg.Data, ErrorMessages.OperatorCertificatesRequired)
      local certs = json.decode(msg.Data)

      for _, cert in ipairs(certs) do
        local fingerprint = cert['fingerprint']
        local address = cert['address']

        AnyoneUtils.assertValidFingerprint(fingerprint)
        AnyoneUtils.assertValidEvmAddress(address)

        RelayRegistry.FingerprintsToOperatorAddresses[fingerprint] =
          AnyoneUtils.normalizeEvmAddress(address)
      end

      ao.send({
        Target = msg.From,
        Action = 'Admin-Submit-Operator-Certificates-Response',
        Data = 'OK'
      })
    end
  )

  Handlers.add(
    'List-Operator-Certificates',
    Handlers.utils.hasMatchingTag(
      'Action',
      'List-Operator-Certificates'
    ),
    function (msg)
      ao.send({
        Target = msg.From,
        Action = 'List-Operator-Certificates-Response',
        Data = json.encode(RelayRegistry.FingerprintsToOperatorAddresses)
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
end

RelayRegistry.init()
