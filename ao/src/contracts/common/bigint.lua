--- common/bigint.lua — native-integer replacement for edubart bint.
---
--- WHY: edubart `bint` HANGS under luerl (its integer-width auto-detection loops
--- forever because luerl integers are arbitrary precision — A10 / D7). Since luerl
--- integers never overflow, token-scale reward math is exact with NO bignum library.
---
--- This is a thin WRAPPER type around a native integer, with the metamethods edubart
--- bint provides, so the contract's reward math (which mixes bint values with raw
--- number/STRING operands and relies on bint's coercion — e.g. `bint(x) + tostring(y)`)
--- stays byte-for-byte; only the `require` line changes. `tostring(bintvalue)` yields
--- an exact integer string; string operands coerce through an exact digit-fold parse
--- (NOT Lua's arithmetic string coercion, which would go via float and lose precision
--- / change subtype — that was the "0.0" bug).
---
--- API subset our contracts use: M(x) construct · M.tobint · M.ispos · M.iszero
--- · M.tonumber · M.ule · M.trunc, and + - * // % < <= unary-minus tostring.
---
--- PRECISION / TESTING: exact only where the backing integer is arbitrary precision —
--- i.e. under luerl (the device). Under real Lua 5.3 (spec Tier 1) it is 64-bit and
--- token-scale intermediates OVERFLOW, so reward-magnitude validation is a Tier-2
--- (luerl) concern. Float-mediated inputs (Score.Share, family/location multipliers)
--- keep IEEE-754 precision exactly as under bint.

--- Exact string→integer (nil for non-integer strings). tonumber loses precision on
--- big decimals under luerl; digit-fold is exact.
local function digitFold(s)
  local i, neg = 1, false
  if string.byte(s, 1) == 45 then neg, i = true, 2 end
  if i > #s then return nil end
  local n = 0
  for j = i, #s do
    local b = string.byte(s, j)
    if b < 48 or b > 57 then return nil end
    n = n * 10 + (b - 48)
  end
  if neg then n = -n end
  return n
end

--- Coerce any operand (wrapped bint / number / integer-string) to a native integer.
local mt = {}
local function iswrapped(x) return type(x) == 'table' and getmetatable(x) == mt end
local function toint(v)
  if iswrapped(v) then return v.v end
  local t = type(v)
  if t == 'number' then
    if math.type and math.type(v) == 'float' then
      if v ~= math.floor(v) then return nil end
      return math.floor(v)
    end
    return v
  elseif t == 'string' then
    return digitFold(v)
  end
  return nil
end

local function wrap(n) return setmetatable({ v = n }, mt) end

--- Raw native value of an operand (int for wrapped / integer-strings, float otherwise).
local function raw(x)
  if iswrapped(x) then return x.v end
  if type(x) == 'string' then return digitFold(x) or tonumber(x) end
  return x
end

-- Edubart bint mixed-mode: integer math when BOTH operands are integer-valued
-- (→ wrapped exact integer); otherwise fall back to float arithmetic (→ raw float,
-- which the contract then re-integerizes with an explicit bint(...) wrapper).
mt.__add = function(a, b) local x, y = toint(a), toint(b); if x and y then return wrap(x + y) end return raw(a) + raw(b) end
mt.__sub = function(a, b) local x, y = toint(a), toint(b); if x and y then return wrap(x - y) end return raw(a) - raw(b) end
mt.__mul = function(a, b) local x, y = toint(a), toint(b); if x and y then return wrap(x * y) end return raw(a) * raw(b) end
mt.__idiv = function(a, b) local x, y = toint(a), toint(b); if x and y then return wrap(x // y) end return raw(a) // raw(b) end
mt.__mod = function(a, b) local x, y = toint(a), toint(b); if x and y then return wrap(x % y) end return raw(a) % raw(b) end
mt.__unm = function(a) return wrap(-toint(a)) end
mt.__lt = function(a, b) return raw(a) < raw(b) end
mt.__le = function(a, b) return raw(a) <= raw(b) end
mt.__eq = function(a, b) return raw(a) == raw(b) end
mt.__tostring = function(a) return tostring(a.v) end

--- newmodule(bits): bits ignored (native ints are arbitrary precision under luerl).
return function(_bits)
  local M = {}
  setmetatable(M, { __call = function(_, v)
    local n = toint(v)
    assert(n ~= nil, 'bigint: cannot convert to integer: ' .. tostring(v))
    return wrap(n)
  end })

  function M.tobint(v) local n = toint(v); return n ~= nil and wrap(n) or nil end
  function M.ispos(v)  local n = toint(v); return n ~= nil and n > 0 end
  function M.iszero(v) local n = toint(v); return n ~= nil and n == 0 end
  function M.tonumber(v) return toint(v) end
  function M.ule(a, b) return toint(a) <= toint(b) end        -- values are non-negative
  function M.trunc(v)                                          -- truncate toward zero
    if type(v) == 'number' and math.type and math.type(v) == 'float' then
      return wrap(v >= 0 and math.floor(v) or math.ceil(v))
    end
    return wrap(toint(v))
  end

  return M
end
