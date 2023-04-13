// SPDX-License-Identifier: MIT

pragma solidity 0.8.10;

import "@openzeppelin/contracts/access/Ownable.sol";

contract RelayRegistry is Ownable {
  address public tokenContract;

  mapping(bytes20 => address) public verified;
  mapping(address => bytes20) public claims;

  event RelayRegistrationClaim(address claimedBy, bytes20 fingerprint);
  event RelayRegistrationVerified(address claimedBy, bytes20 fingerprint);

  constructor(address tokenContract_) {
    tokenContract = tokenContract_;
  }

  function registerRelay(bytes20 fingerprint) public {
    claims[msg.sender] = fingerprint;

    emit RelayRegistrationClaim(msg.sender, fingerprint);
  }

  function verifyClaim(address claimedBy, bytes20 fingerprint)
    public
    onlyOwner
  {
    require(claims[claimedBy] == fingerprint, 'Fingerprint not claimed');

    claims[claimedBy] = '';
    verified[fingerprint] = claimedBy;

    emit RelayRegistrationVerified(claimedBy, fingerprint);
  }
}
