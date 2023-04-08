// SPDX-License-Identifier: MIT

pragma solidity 0.8.10;

import "@openzeppelin/contracts/access/Ownable.sol";

contract RelayRegistry is Ownable {
  address public tokenContract;

  struct Claim {
    address claimedBy;
    string fingerprint;
  }

  Claim[] _claims;

  event RelayRegistrationClaim(Claim claim);

  constructor(address tokenContract_) {
    tokenContract = tokenContract_;
  }

  function registerRelay(string calldata fingerprint) public {
    require(_validFingerprint(fingerprint));

    _claims.push(Claim(msg.sender, fingerprint));
  }

  function _validFingerprint(string calldata fingerprint)
    internal
    pure
    returns (bool)
  {
    bytes calldata fingerprintBytes = bytes(fingerprint);

    require(fingerprintBytes.length == 40);

    return true;
  }

  function claims() public view returns (Claim[] memory) {
    return _claims;
  }
}
