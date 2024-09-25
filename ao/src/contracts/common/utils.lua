

local function initUtils()
  local ErrorMessages = require('.common.errors')

  local EvmAddressPattern = '0x' .. ('%x'):rep(40)
  local FingerprintPattern = ('[0123456789ABCDEF]'):rep(40)

  return {
    assertValidEvmAddress = function (address, message)
      assert(
        string.find(address, EvmAddressPattern),
        message or ErrorMessages.InvalidAddress
      )
    end,
    assertValidFingerprint = function (fingerprint, message)
      assert(
        string.find(fingerprint, FingerprintPattern),
        message or ErrorMessages.InvalidFingerprint
      )
    end,
    EvmAddressPattern,
    FingerprintPattern
  }
end

return initUtils()
