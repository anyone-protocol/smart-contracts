local RelayRegistry = {
  AddressesByClaimableFingerprint = {}
}

function RelayRegistry.init()
  local crypto = require(".crypto")
  local ErrorMessages = require('.common.errors')
  local Utils = require('.common.utils')

  Handlers.add(
    "submitFingerprintProof",
    Handlers.utils.hasMatchingTag("Action", "Submit-Fingerprint-Proof"),
    function(msg)
      local address = msg.Tags["Address"]
  
      assert(address, ErrorMessages.InvalidAddress)
      assert(address:len() == 42, ErrorMessages.InvalidAddress)
      assert(address:match(Utils.EvmAddressPattern), ErrorMessages.InvalidAddress)
  
      local pubkeyStream = crypto.utils.stream.fromString(msg.From)
      local fingerprint = crypto.digest.sha1(pubkeyStream).asHex()

      if RelayRegistry.AddressesByClaimableFingerprint[fingerprint] == nil then
        RelayRegistry.AddressesByClaimableFingerprint[fingerprint] = address:upper()
      else
        error(ErrorMessages.FingerprintAlreadyClaimable)
      end
  
      ao.send({ Target = msg.From, Data = "OK" })
    end
  )
end

RelayRegistry.init()
