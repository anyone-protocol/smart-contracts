# ATOR SmartWeave Contracts

## Install

```bash
$ npm i
```

## Build

```bash
$ npm run build
```

## Test

```bash
$ npm run test
```

(Note, e2e test deploys to Arweave mainnet)
```bash
$ npm run test:e2e
```

## Deploy

Before deploying, make sure the following environment variables are set:

- `CONTRACT_SRC`
  - Path to contract src relative to deploy script,
  - e.g. `../dist/contracts/relay-registry.js`
- `INIT_STATE`
  - Path to contract initial state JSON
  - e.g. `../dist/contracts/relay-registry-init-state.json`
- `DEPLOYER_PRIVATE_KEY`
  - EVM deployer private key hex
  - Defaults to Hardhat Account #0

```bash
$ npm run deploy
```

## Contracts

### Relay Registry

- `@OnlyOwner addClaimable(fingerprint: string, address: string) => void`
  - Owner/Validator adds a fingerprint/address tuple as claimable
- `@OnlyOwner removeClaimable(fingerprint: string) => void`
  - Owner/Validator removes a fingerprint/address tuple as claimable
- `claimable(address?: string) => ClaimableRelays | Fingerprint[]`
  - View method to return either
    1) The current claimable fingerprint/address tuples
    2) A list of fingerprints claimable by the provided address
- `isClaimable(fingerprint: string, address: string) => boolean`
  - View method to check if a fingerprint/address tuple is claimable
- `claim(fingerprint: string) => void`
  - Claims a fingerprint if claimable by the caller's EVM address
- `renounce(fingerprint: string) => void`
  - Renounces a verified fingerprint/address claim if currently verified by the caller's EVM address
- `@OnlyOwner removeVerified(fingerprint) => void`
  - Allows Owner to remove stale verifications
- `verified(address?: string) => VerifiedRelays | Fingerprint[]`
  - View method to return either
    1) The current verified fingerprint/address tuples
    2) A list of fingerprints claimed/verified by the provided address
- `isVerified(fingerprint: string) => boolean`
  - View method to check if a fingerprint is verified
