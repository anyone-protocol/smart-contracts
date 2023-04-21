// SPDX-License-Identifier: MIT

pragma solidity 0.8.10;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableMap.sol";

contract RelayRegistry is Ownable {
  using EnumerableMap for EnumerableMap.UintToAddressMap;

  struct Claim {
    address claimedBy;
    bytes20 fingerprint;
  }

  address public tokenContract;

  EnumerableMap.UintToAddressMap private _verified;
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
    _verified.set(uint256(bytes32(fingerprint)), claimedBy);

    emit RelayRegistrationVerified(claimedBy, fingerprint);
  }

  function verified() public view returns(Claim[] memory) {
    uint256 verifiedCount = _verified.length();
    Claim[] memory verifiedClaims = new Claim[](verifiedCount);

    for (uint256 i = 0; i < verifiedCount; i++) {
      (uint256 fpint, address claimedBy) = _verified.at(i);
      verifiedClaims[i] = Claim(claimedBy, bytes20(bytes32(fpint)));
    }

    return verifiedClaims;
  }
}
