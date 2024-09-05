local crypto = require(".crypto")

-- TODO -> move to a common error module
ErrorMessages = {
  InvalidAddress = "Invalid address",
  FingerprintAlreadyClaimable = "Fingerprint is already claimable by address"
}

-- TODO -> move to a common util module
EvmAddressPattern = "0x" .. ("%x"):rep(40)

AddressesByClaimableFingerprint = {}

Handlers.add(
  "submitFingerprintProof",
  Handlers.utils.hasMatchingTag("Action", "Submit-Fingerprint-Proof"),
  function(msg)
    local address = msg.Tags["Address"]

    -- TODO -> move to a common util module
    assert(address, ErrorMessages.InvalidAddress)
    assert(address:len() == 42, ErrorMessages.InvalidAddress)
    assert(address:match(EvmAddressPattern), ErrorMessages.InvalidAddress)

    local pubkeyStream = crypto.utils.stream.fromString(msg.From)
    local fingerprint = crypto.digest.sha1(pubkeyStream).asHex()

    if AddressesByClaimableFingerprint[fingerprint] == nil then
      AddressesByClaimableFingerprint[fingerprint] = address:upper()
    else
      error(ErrorMessages.FingerprintAlreadyClaimable)
    end

    ao.send({ Target = msg.From, Data = "OK" })
  end
)
