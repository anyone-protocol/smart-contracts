OperatorRegistry = {
  _initialized = false,

  -- Operator Certificates
  ClaimableFingerprintsToOperatorAddresses = {},

  -- Fingerprint Certificates
  VerifiedFingerprintsToOperatorAddresses = {},

  BlockedOperatorAddresses = {},
  VerifiedHardwareFingerprints = {},

  -- Registration Credits
  RegistrationCreditsFingerprintsToOperatorAddresses = {},
  RegistrationCreditsRequired = false
}

function OperatorRegistry._addVerifiedHardwareFingerprint(fingerprint)
  local ErrorMessages = require('.common.errors')
  local AnyoneUtils = require('.common.utils')

  AnyoneUtils.assertValidFingerprint(fingerprint)
  assert(
    OperatorRegistry.VerifiedHardwareFingerprints[fingerprint] == nil,
    ErrorMessages.DuplicateFingerprint
  )

  OperatorRegistry.VerifiedHardwareFingerprints[fingerprint] = true
end

function OperatorRegistry.init()
  local json = require('json')

  local ErrorMessages = require('.common.errors')
  local AnyoneUtils = require('.common.utils')
  local ACL = require('.common.acl')

  Handlers.add(
    'Admin-Submit-Operator-Certificates',
    Handlers.utils.hasMatchingTag(
      'Action',
      'Admin-Submit-Operator-Certificates'
    ),
    function (msg)
      ACL.assertHasOneOfRole(
        msg.From,
        { 'owner', 'admin', 'Admin-Submit-Operator-Certificates' }
      )

      assert(msg.Data, ErrorMessages.OperatorCertificatesRequired)
      local certs = json.decode(msg.Data)

      for _, cert in ipairs(certs) do
        local fingerprint = cert['f']
        local address = cert['a']
        local hw = cert['hw']

        AnyoneUtils.assertValidFingerprint(fingerprint)
        AnyoneUtils.assertValidEvmAddress(address)

        OperatorRegistry.ClaimableFingerprintsToOperatorAddresses[fingerprint] =
          AnyoneUtils.normalizeEvmAddress(address)

        if hw then
          OperatorRegistry._addVerifiedHardwareFingerprint(fingerprint)
        end
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
        Data = json.encode(
          OperatorRegistry.ClaimableFingerprintsToOperatorAddresses
        )
      })
    end
  )

  Handlers.add(
    'Submit-Fingerprint-Certificate',
    Handlers.utils.hasMatchingTag('Action', 'Submit-Fingerprint-Certificate'),
    function (msg)
      assert(
        OperatorRegistry.BlockedOperatorAddresses[msg.From] == nil,
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
        OperatorRegistry.ClaimableFingerprintsToOperatorAddresses[fingerprint]
          == address,
        ErrorMessages.InvalidCertificate
      )

      if (OperatorRegistry.RegistrationCreditsRequired == true) then
        ao.send({
          Target = msg.From,
          Action = 'Submit-Fingerprint-Certificate-Response',
          Data = 'REGISTRATION CREDITS REQUIRED IS TRUE'
        })
      end

      if (
        OperatorRegistry.RegistrationCreditsRequired == true and
        OperatorRegistry.VerifiedHardwareFingerprints[fingerprint] ~= true
      ) then
        assert(
          OperatorRegistry
            .RegistrationCreditsFingerprintsToOperatorAddresses[fingerprint]
              == address,
          ErrorMessages.RegistrationCreditRequired
        )
      end

      OperatorRegistry
        .VerifiedFingerprintsToOperatorAddresses[fingerprint] = address
      -- NB: Don't remove registration credits on claim
      -- OperatorRegistry
      --   .RegistrationCreditsFingerprintsToOperatorAddresses[fingerprint] = nil
      OperatorRegistry
        .ClaimableFingerprintsToOperatorAddresses[fingerprint] = nil

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
        Data = json.encode(
          OperatorRegistry.VerifiedFingerprintsToOperatorAddresses
        )
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
      local address = '0x'..string.upper(string.sub(msg.From, 3))
      assert(
        OperatorRegistry
          .VerifiedFingerprintsToOperatorAddresses[fingerprint] == address,
        ErrorMessages.OnlyRelayOperatorCanRenounce
      )

      OperatorRegistry
        .VerifiedFingerprintsToOperatorAddresses[fingerprint] = nil

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
      ACL.assertHasOneOfRole(
        msg.From,
        { 'owner', 'admin', 'Remove-Fingerprint-Certificate' }
      )

      local fingerprint = msg.Tags['Fingerprint']
      assert(type(fingerprint) == 'string', ErrorMessages.FingerprintRequired)
      assert(string.len(fingerprint) == 40, ErrorMessages.InvalidCertificate)
      -- assert(
      --   OperatorRegistry.VerifiedFingerprintsToOperatorAddresses[fingerprint] ~= nil,
      --   ErrorMessages.UnknownFingerprint
      -- )

      OperatorRegistry.VerifiedFingerprintsToOperatorAddresses[fingerprint] = nil

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
      ACL.assertHasOneOfRole(
        msg.From,
        { 'owner', 'admin', 'Block-Operator-Address' }
      )

      local address = msg.Tags['Address']
      assert(type(address) == 'string', ErrorMessages.AddressRequired)
      AnyoneUtils.assertValidEvmAddress(address)

      OperatorRegistry.BlockedOperatorAddresses[address] = true

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
        Data = json.encode(OperatorRegistry.BlockedOperatorAddresses)
      })
    end
  )

  Handlers.add(
    'Unblock-Operator-Address',
    Handlers.utils.hasMatchingTag('Action', 'Unblock-Operator-Address'),
    function (msg)
      ACL.assertHasOneOfRole(
        msg.From,
        { 'owner', 'admin', 'Unblock-Operator-Address' }
      )

      local address = msg.Tags['Address']
      assert(type(address) == 'string', ErrorMessages.AddressRequired)
      AnyoneUtils.assertValidEvmAddress(address)

      assert(
        OperatorRegistry.BlockedOperatorAddresses[address] ~= nil,
        ErrorMessages.AddressIsNotBlocked
      )

      OperatorRegistry.BlockedOperatorAddresses[address] = nil

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
      ACL.assertHasOneOfRole(
        msg.From,
        { 'owner', 'admin', 'Add-Registration-Credit' }
      )

      assert(type(msg.Tags['Address']) == 'string', ErrorMessages.AddressRequired)
      AnyoneUtils.assertValidEvmAddress(msg.Tags['Address'])
      local address = '0x'..string.upper(string.sub(msg.Tags['Address'], 3))

      local fingerprint = msg.Tags['Fingerprint']
      assert(type(fingerprint) == 'string', ErrorMessages.FingerprintRequired)
      AnyoneUtils.assertValidFingerprint(fingerprint)

      assert(
        OperatorRegistry
          .RegistrationCreditsFingerprintsToOperatorAddresses[fingerprint]
            == nil,
        ErrorMessages.RegistrationCreditAlreadyAdded
      )

      OperatorRegistry
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
          OperatorRegistry.RegistrationCreditsFingerprintsToOperatorAddresses
        )
      })
    end
  )

  Handlers.add(
    'Remove-Registration-Credit',
    Handlers.utils.hasMatchingTag('Action', 'Remove-Registration-Credit'),
    function (msg)
      ACL.assertHasOneOfRole(
        msg.From,
        { 'owner', 'admin', 'Remove-Registration-Credit' }
      )

      local address = msg.Tags['Address']
      assert(type(address) == 'string', ErrorMessages.AddressRequired)
      AnyoneUtils.assertValidEvmAddress(address)

      local fingerprint = msg.Tags['Fingerprint']
      assert(type(fingerprint) == 'string', ErrorMessages.FingerprintRequired)
      AnyoneUtils.assertValidFingerprint(fingerprint)

      assert(
        OperatorRegistry
          .RegistrationCreditsFingerprintsToOperatorAddresses[fingerprint]
            ~= nil,
        ErrorMessages.RegistrationCreditDoesNotExist
      )

      OperatorRegistry
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
      ACL.assertHasOneOfRole(
        msg.From,
        { 'owner', 'admin', 'Add-Verified-Hardware' }
      )

      local fingerprints = msg.Data
      assert(type(fingerprints) == 'string', ErrorMessages.FingerprintsRequired)

      for fingerprint in string.gmatch(fingerprints, '[^,]+') do
        OperatorRegistry._addVerifiedHardwareFingerprint(fingerprint)
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
        Data = json.encode(OperatorRegistry.VerifiedHardwareFingerprints)
      })
    end
  )

  Handlers.add(
    'Remove-Verified-Hardware',
    Handlers.utils.hasMatchingTag('Action', 'Remove-Verified-Hardware'),
    function (msg)
      ACL.assertHasOneOfRole(
        msg.From,
        { 'owner', 'admin', 'Remove-Verified-Hardware' }
      )

      local fingerprints = msg.Data
      assert(type(fingerprints) == 'string', ErrorMessages.FingerprintsRequired)

      for fingerprint in string.gmatch(fingerprints, '[^,]+') do
        AnyoneUtils.assertValidFingerprint(fingerprint)
        assert(
          OperatorRegistry.VerifiedHardwareFingerprints[fingerprint] ~= nil,
          ErrorMessages.UnknownFingerprint
        )

        OperatorRegistry.VerifiedHardwareFingerprints[fingerprint] = nil
      end

      ao.send({
        Target = msg.From,
        Action = 'Remove-Verified-Hardware-Response',
        Data = 'OK'
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
      ao.send({
        Target = msg.From,
        Action = 'View-State-Response',
        Data = json.encode({
          ClaimableFingerprintsToOperatorAddresses = OperatorRegistry.ClaimableFingerprintsToOperatorAddresses,
          VerifiedFingerprintsToOperatorAddresses = OperatorRegistry.VerifiedFingerprintsToOperatorAddresses,
          BlockedOperatorAddresses = OperatorRegistry.BlockedOperatorAddresses,
          RegistrationCreditsFingerprintsToOperatorAddresses = OperatorRegistry.RegistrationCreditsFingerprintsToOperatorAddresses,
          VerifiedHardwareFingerprints = OperatorRegistry.VerifiedHardwareFingerprints
        })
      })
    end
  )

  Handlers.add(
    'Info',
    Handlers.utils.hasMatchingTag('Action', 'Info'),
    function (msg)
      local info = {
        claimed = 0,
        hardware = 0,
        total = 0
      }

      for _ in pairs(
        OperatorRegistry.VerifiedFingerprintsToOperatorAddresses
      ) do
        info.claimed = info.claimed + 1
      end

      for _ in pairs(
        OperatorRegistry.ClaimableFingerprintsToOperatorAddresses
      ) do
        info.total = info.total + 1
      end

      info.total = info.total + info.claimed

      for _ in pairs(OperatorRegistry.VerifiedHardwareFingerprints) do
        info.hardware = info.hardware + 1
      end

      ao.send({
        Target = msg.From,
        Action = 'Info-Response',
        Data = json.encode(info)
      })
    end
  )

  Handlers.add(
    'Init',
    Handlers.utils.hasMatchingTag('Action', 'Init'),
    function (msg)
      assert(msg.From == ao.env.Process.Owner, ErrorMessages.OnlyOwner)
      assert(
        OperatorRegistry._initialized == false,
        ErrorMessages.AlreadyInitialized
      )

      local initState = json.decode(msg.Data or '{}')

      assert(
        type(initState.BlockedOperatorAddresses) == 'table' or
        type(initState.BlockedOperatorAddresses) == 'nil',
        ErrorMessages.InvalidFingerprint
      )
      if (type(initState.BlockedOperatorAddresses) == 'table') then
        for address, isBlocked in pairs(initState.BlockedOperatorAddresses) do
          AnyoneUtils.assertValidEvmAddress(address)
          assert(
            isBlocked == true,
            ErrorMessages.InvalidBlockedOperatorAddressesValue
          )
        end
      end

      assert(
        type(initState.ClaimableFingerprintsToOperatorAddresses) == 'table' or
        type(initState.ClaimableFingerprintsToOperatorAddresses) == 'nil',
        ErrorMessages.InvalidFingerprint
      )
      if (type(initState.ClaimableFingerprintsToOperatorAddresses) == 'table') then
        for fingerprint, address in pairs(initState.ClaimableFingerprintsToOperatorAddresses) do
          AnyoneUtils.assertValidFingerprint(fingerprint)
          AnyoneUtils.assertValidEvmAddress(address)
        end
      end

      assert(
        type(initState.RegistrationCreditsFingerprintsToOperatorAddresses) == 'table' or
        type(initState.RegistrationCreditsFingerprintsToOperatorAddresses) == 'nil',
        ErrorMessages.InvalidFingerprint
      )
      if (type(initState.RegistrationCreditsFingerprintsToOperatorAddresses) == 'table') then
        for fingerprint, address in pairs(initState.RegistrationCreditsFingerprintsToOperatorAddresses) do
          AnyoneUtils.assertValidFingerprint(fingerprint)
          AnyoneUtils.assertValidEvmAddress(address)
        end
      end

      assert(
        type(initState.VerifiedFingerprintsToOperatorAddresses) == 'table' or
        type(initState.VerifiedFingerprintsToOperatorAddresses) == 'nil',
        ErrorMessages.InvalidFingerprint
      )
      if (type(initState.VerifiedFingerprintsToOperatorAddresses) == 'table') then
        for fingerprint, address in pairs(initState.VerifiedFingerprintsToOperatorAddresses) do
          AnyoneUtils.assertValidFingerprint(fingerprint)
          AnyoneUtils.assertValidEvmAddress(address)
        end
      end

      assert(
        type(initState.VerifiedHardwareFingerprints) == 'table' or
        type(initState.VerifiedHardwareFingerprints) == 'nil',
        ErrorMessages.InvalidFingerprint
      )
      if (type(initState.VerifiedHardwareFingerprints) == 'table') then
        for fingerprint, isVerifiedHardware in pairs(initState.VerifiedHardwareFingerprints) do
          AnyoneUtils.assertValidFingerprint(fingerprint)
          assert(
            isVerifiedHardware == true,
            ErrorMessages.InvalidVerifiedHardwareValue
          )
        end
      end

      OperatorRegistry.BlockedOperatorAddresses =
        initState.BlockedOperatorAddresses or {}
      OperatorRegistry.ClaimableFingerprintsToOperatorAddresses =
        initState.ClaimableFingerprintsToOperatorAddresses or {}
      OperatorRegistry.RegistrationCreditsFingerprintsToOperatorAddresses =
        initState.RegistrationCreditsFingerprintsToOperatorAddresses or {}
      OperatorRegistry.VerifiedFingerprintsToOperatorAddresses =
        initState.VerifiedFingerprintsToOperatorAddresses or {}
      OperatorRegistry.VerifiedHardwareFingerprints =
        initState.VerifiedHardwareFingerprints or {}
      OperatorRegistry.RegistrationCreditsRequired =
        initState.RegistrationCreditsRequired or false

      OperatorRegistry._initialized = true

      ao.send({
        Target = msg.From,
        Action = 'Init-Response',
        Data = 'OK'
      })
    end
  )
end

OperatorRegistry.init()
