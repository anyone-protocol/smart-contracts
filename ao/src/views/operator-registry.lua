function operator_registry_info(base, req)
  local result = {
    operator_registry_initialized = base.operator_registry_initialized,
    claimed = 0,
    hardware = 0,
    total = 0
  }

  for _ in pairs(base.verified_fingerprints_to_operator_addresses) do
    result.claimed = result.claimed + 1
  end

  for _ in pairs(base.claimable_fingerprints_to_operator_addresses) do
    result.total = result.total + 1
  end

  result.total = result.total + result.claimed

  for _ in pairs(base.verified_hardware_fingerprints) do
    result.hardware = result.hardware + 1
  end

  return result
end

function operator_claimable_and_verified_fingerprints(base, req)
  local result = {}

  for fingerprint, address in pairs(base.claimable_fingerprints_to_operator_addresses) do
    if req.operator == address then
      result[fingerprint] = 'claimable'
    end
  end

  for fingerprint, address in pairs(base.verified_fingerprints_to_operator_addresses) do
    if req.operator == address then
      result[fingerprint] = 'verified'
    end
  end

  return result
end
