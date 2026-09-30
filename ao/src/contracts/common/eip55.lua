--- eip55.lua — the ETHEREUM-TYPE address validator: on-chain keccak-256 + EIP-55 checksum.
---
--- Used by CONTRACTS to validate/canonicalize their Ethereum address fields. The runtime
--- (native.lua) stays address-type-AGNOSTIC — it never calls this on committer/role identity
--- (an Arweave/Solana committer would be corrupted by an Ethereum checksum). Only Ethereum has
--- case-folding ambiguity that needs active canonicalization; Arweave (base64url) / Solana
--- (base58) validators are added as sibling modules if/when a field consumes one. See D26.
---
--- luerl-safe: uses ONLY fixed-width 64-bit bitwise ops (XOR/AND/NOT/shift/rotate) — the class
--- luerl 1.3.0 implements CORRECTLY. (A10's integer bug is BIGNUM arithmetic, not fixed-width
--- bitwise — see UPSTREAM-ISSUES.) No gmatch/patterns beyond a single anchored format match.
--- VERIFIED bit-identical to real Lua 5.3, luerl 1.3.0, and the live device VM, and matches
--- `ethers.getAddress` exactly (spec vectors + all-caps→canonical). This lets EVM-keyed contracts
--- canonicalize AND validate addresses on-chain, with no keccak on any off-chain trust path.
local function initEip55()
  local errors = require('.common.errors')

  -- Keccak-256 (Ethereum keccak, 0x01..0x80 padding). Returns a 64-char lowercase hex digest.
  local function keccak256(msg)
    local RC = {
      0x0000000000000001, 0x0000000000008082, 0x800000000000808a, 0x8000000080008000,
      0x000000000000808b, 0x0000000080000001, 0x8000000080008081, 0x8000000000008009,
      0x000000000000008a, 0x0000000000000088, 0x0000000080008009, 0x000000008000000a,
      0x000000008000808b, 0x800000000000008b, 0x8000000000008089, 0x8000000000008003,
      0x8000000000008002, 0x8000000000000080, 0x000000000000800a, 0x800000008000000a,
      0x8000000080008081, 0x8000000000008080, 0x0000000080000001, 0x8000000080008008,
    }
    local r = {
      [0]=0,[1]=1,[2]=62,[3]=28,[4]=27,[5]=36,[6]=44,[7]=6,[8]=55,[9]=20,
      [10]=3,[11]=10,[12]=43,[13]=25,[14]=39,[15]=41,[16]=45,[17]=15,[18]=21,[19]=8,
      [20]=18,[21]=2,[22]=61,[23]=56,[24]=14,
    }
    local MASK = 0xFFFFFFFFFFFFFFFF
    local function rotl(x, n)
      if n == 0 then return x & MASK end
      return ((x << n) | ((x & MASK) >> (64 - n))) & MASK
    end
    local A = {}; for i = 0, 24 do A[i] = 0 end
    local rate = 136
    local data = msg
    local q = rate - (#data % rate)
    if q == 1 then data = data .. string.char(0x81)
    else data = data .. string.char(0x01) .. string.rep("\0", q - 2) .. string.char(0x80) end
    for base = 1, #data, rate do
      for i = 0, rate // 8 - 1 do
        local lane = 0
        for b = 7, 0, -1 do lane = (lane << 8) | string.byte(data, base + i * 8 + b) end
        A[i] = A[i] ~ lane
      end
      for round = 1, 24 do
        local C = {}; for x = 0, 4 do C[x] = A[x] ~ A[x+5] ~ A[x+10] ~ A[x+15] ~ A[x+20] end
        local D = {}; for x = 0, 4 do D[x] = C[(x+4)%5] ~ rotl(C[(x+1)%5], 1) end
        for x = 0, 4 do for y = 0, 4 do A[x+5*y] = A[x+5*y] ~ D[x] end end
        local B = {}
        for x = 0, 4 do for y = 0, 4 do B[y + 5*((2*x+3*y)%5)] = rotl(A[x+5*y], r[x+5*y]) end end
        for x = 0, 4 do for y = 0, 4 do
          A[x+5*y] = B[x+5*y] ~ ((~B[(x+1)%5 + 5*y]) & B[(x+2)%5 + 5*y])
        end end
        A[0] = A[0] ~ RC[round]
      end
    end
    local out = {}
    for i = 0, 3 do
      local lane = A[i]
      for b = 0, 7 do out[#out+1] = string.format("%02x", (lane >> (8*b)) & 0xFF) end
    end
    return table.concat(out)
  end

  local FORMAT = '^0x' .. ('%x'):rep(40) .. '$'   -- 0x + exactly 40 hex, anchored

  -- Canonical EIP-55 form of a well-formed (already format-checked) `0x`+40hex address, any case.
  local function toChecksum(addr)
    local lower = string.lower(string.sub(addr, 3))
    local hash = keccak256(lower)
    local out = { '0x' }
    for i = 1, 40 do
      local c = string.sub(lower, i, i)
      local cb = string.byte(c)
      local hn = tonumber(string.sub(hash, i, i), 16)
      if cb >= 97 and cb <= 102 and hn >= 8 then out[#out+1] = string.upper(c)
      else out[#out+1] = c end
    end
    return table.concat(out)
  end

  return {
    keccak256 = keccak256,
    toChecksum = toChecksum,

    --- `ethers.getAddress` semantics: assert `0x`+40hex format; if the input is MIXED case it must
    --- be a valid EIP-55 checksum (else reject — on-chain typo detection); all-one-case is accepted
    --- as unchecksummed. Returns the canonical EIP-55 string. Use at every untrusted address ingress.
    checksum = function(addr)
      assert(type(addr) == 'string' and string.find(addr, FORMAT), errors.InvalidAddress)
      local canonical = toChecksum(addr)
      local hex, hasUpper, hasLower = string.sub(addr, 3), false, false
      for i = 1, 40 do
        local b = string.byte(hex, i)
        if b >= 65 and b <= 70 then hasUpper = true            -- A-F
        elseif b >= 97 and b <= 102 then hasLower = true end   -- a-f
      end
      if hasUpper and hasLower then
        assert(addr == canonical, errors.InvalidAddressChecksum)
      end
      return canonical
    end,
  }
end

return initEip55()
