// SPDX-License-Identifier: MIT

pragma solidity 0.8.10;

import "@openzeppelin/contracts/access/Ownable.sol";

contract RelayRegistry is Ownable {
  address public tokenContract;

  mapping(string => address) public verified;
  mapping(address => string) public claims;

  event RelayRegistrationClaim(address claimedBy, string fingerprint);
  event RelayRegistrationVerified(address claimedBy, string fingerprint);

  constructor(address tokenContract_) {
    tokenContract = tokenContract_;
  }

  function registerRelay(string calldata fingerprint) public {
    require(_validFingerprint(fingerprint), 'Invalid fingerprint');

    claims[msg.sender] = fingerprint;

    emit RelayRegistrationClaim(msg.sender, fingerprint);
  }

  function _validFingerprint(string calldata fingerprint)
    internal
    pure
    returns (bool)
  {
    bytes calldata fingerprintBytes = bytes(fingerprint);

    require(fingerprintBytes.length == 40, 'Invalid fingerprint');
    
    for (uint i; i < fingerprintBytes.length; i++) {
      bytes1 char = fingerprintBytes[i];

      if (
        !(char >= 0x30 && char <= 0x39) && //9-0
        !(char >= 0x41 && char <= 0x46)    //A-F
      ) {
        return false;
      }
    }

    return true;
  }

  function verifyClaim(address claimedBy, string calldata fingerprint)
    public
    onlyOwner
  {
    require(_validFingerprint(fingerprint), 'Invalid fingerprint');
    require(
      keccak256(bytes(claims[claimedBy])) == keccak256(bytes(fingerprint)),
      'Fingerprint not claimed'
    );

    claims[claimedBy] = '';
    verified[fingerprint] = claimedBy;

    emit RelayRegistrationVerified(claimedBy, fingerprint);
  }
}
