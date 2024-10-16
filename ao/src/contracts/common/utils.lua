

local function initUtils()
  local ErrorMessages = require('.common.errors')

  local EvmAddressPattern = '0x' .. ('%x'):rep(40)
  local FingerprintPattern = ('[0123456789ABCDEF]'):rep(40)

  local function starts_with(str, start)
    return str:sub(1, #start) == start
  end

  return {
    normalizeEvmAddress = function (address)
      if (starts_with(address, '0x')) then
        return '0x'..string.upper(string.sub(address, 3))
      else
        return '0x'..string.upper(address)
      end
    end,

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
