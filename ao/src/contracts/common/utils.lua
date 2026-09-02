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
    -- Exact string→integer (digit-fold). luerl's tonumber FLOATS integer strings, so
    -- parsing integer tags/config with tonumber then assertInteger fails on-device.
    -- Returns an integer or nil (non-integer input). Accepts an already-integer number.
    parseInt = function (v)
      if type(v) == 'number' then
        if math.type and math.type(v) == 'float' then
          return v == math.floor(v) and math.floor(v) or nil
        end
        return v
      end
      if type(v) ~= 'string' then return nil end
      local a, neg = v, false
      if a:sub(1, 1) == '-' then neg, a = true, a:sub(2) end
      if #a == 0 then return nil end
      local n = 0
      for k = 1, #a do
        local b = a:byte(k)
        if b < 48 or b > 57 then return nil end
        n = n * 10 + (b - 48)
      end
      if neg then n = -n end
      return n
    end,

    -- Device-safe replacement for `string.gmatch(s, '[^sep]+')`: luerl 1.3.0's gmatch
    -- throws `bad argument` on the device VM (A13), so contracts that split comma lists
    -- must not use it. Returns non-empty tokens split on the literal separator `sep`.
    split = function (str, sep)
      local out, start, n = {}, 1, #str
      while start <= n do
        local i = string.find(str, sep, start, true)   -- plain find (no patterns)
        local tok
        if not i then
          tok = string.sub(str, start); start = n + 1
        else
          tok = string.sub(str, start, i - 1); start = i + #sep
        end
        if #tok > 0 then out[#out + 1] = tok end
      end
      return out
    end,

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
