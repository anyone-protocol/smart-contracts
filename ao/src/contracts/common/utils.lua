local function initUtils()
  local ErrorMessages = require('.common.errors')

  local EvmAddressPattern = '0x' .. ('[%x]'):rep(40)
  local FingerprintPattern = ('[0123456789ABCDEF]'):rep(40)
  local H3CellPattern = '^8c' .. ('%d'):rep(6) .. '$'

  local function starts_with(str, start)
    return str:sub(1, #start) == start
  end

  local function bigIntFix(input)
    local LOW_CAP = 1000000000000000000
    if input.Low < LOW_CAP then
      return { Low = input.Low, High = input.High }
    else
      return bigIntFix({ Low = input.Low - LOW_CAP, High = input.High + 1 })
    end
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
      assert(type(address) == 'string', message or ErrorMessages.InvalidAddress)
      assert(
        string.find(address, EvmAddressPattern),
        message or ErrorMessages.InvalidAddress
      )
    end,

    assertValidFingerprint = function (fingerprint, message)
      assert(type(fingerprint) == 'string', message or ErrorMessages.InvalidFingerprint)
      assert(
        string.find(fingerprint, FingerprintPattern),
        message or ErrorMessages.InvalidFingerprint
      )
    end,

    assertH3Cell = function (input, fieldName)
      assert(type(input) == 'string', ErrorMessages.InvalidH3Cell .. ' for ' .. fieldName)
      assert(
        string.find(input, H3CellPattern),
        ErrorMessages.InvalidH3Cell .. ' for ' .. fieldName
      )
    end,
    
    assertInteger = function (value, fieldName)
      assert(type(value) == 'number', ErrorMessages.NumberValueRequired .. ' for ' .. fieldName .. ' got ' .. type(value))
      assert(math.type(value) == 'integer', ErrorMessages.IntegerValueRequired .. ' for ' .. fieldName .. ' got ' .. math.type(value))
    end,

    assertNumber = function (value, fieldName)
      assert(type(value) == 'number', ErrorMessages.NumberValueRequired .. ' for ' .. fieldName .. ' got ' .. type(value))
    end,

    assertFloat = function (value, fieldName)
      assert(type(value) == 'number', ErrorMessages.NumberValueRequired .. ' for ' .. fieldName .. ' got ' .. type(value))
      assert(math.type(value) == 'float', ErrorMessages.FloatValueRequired .. ' for ' .. fieldName .. ' got ' .. math.type(value))
    end,

    findHighestKey = function (table, fieldName)
      local highest = -math.huge
      for key, _ in pairs(table) do
        if key > highest then
            highest = key
        end
      end
      return highest
    end,

    findLowestKey = function (table, fieldName)
      local lowest = math.huge
      for key, _ in pairs(table) do
        if key < lowest then
          lowest = key
        end
      end
      return lowest
    end,

    bigInt = function(low, high)
      if high then
        return bigIntFix({
          Low = low, High = high
        })
      else
        return bigIntFix({
          Low = low, High = 0
        })
      end
    end,

    bigAddScalar = function (input, value)
      if input == nil then
        return bigIntFix({
          Low = value, High = 0
        })
      else
        return bigIntFix({ Low = input.Low + value, High = input.High })
      end
    end,
    
    bigString = function (input)
      if input == nil then
        return '0'
      else
        return string.format('%d.%018d', input.High, input.Low)
      end
    end,

    EvmAddressPattern,
    FingerprintPattern
  }
end

return initUtils()
