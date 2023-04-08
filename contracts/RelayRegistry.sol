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

  event RelayRegistrationClaim(
    address indexed claimedBy,
    string indexed fingerprint
  );

  constructor(address tokenContract_) {
    tokenContract = tokenContract_;
  }

  function registerRelay(string calldata fingerprint) public {
    require(_validFingerprint(fingerprint));

    Claim memory claim = Claim(msg.sender, fingerprint);

    _claims.push(claim);

    emit RelayRegistrationClaim(claim.claimedBy, claim.fingerprint);
  }

  function _validFingerprint(string calldata fingerprint)
    internal
    pure
    returns (bool)
  {
    bytes calldata fingerprintBytes = bytes(fingerprint);

    require(fingerprintBytes.length == 40, 'Invalid fingerprint');

    return true;
  }

  function claims() public view returns (Claim[] memory) {
    return _claims;
  }
}
