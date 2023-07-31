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
- `CONSUL_KEY`
  - path to cluster kv key holding contract's address

```bash
$ npm run deploy
```

## Contracts

### Relay Registry

- Owner/Validator adds a fingerprint/address tuple as claimable
  ```typescript
  // @OnlyOwner
  addClaimable(fingerprint: string, address: string) => void
  ```

- Owner/Validator removes a fingerprint/address tuple as claimable
  ```typescript
  // @OnlyOwner
  removeClaimable(fingerprint: string) => void
  ```

- View method to return either
  1) The current claimable fingerprint/address tuples
  2) A list of fingerprints claimable by the provided address
  ```typescript
  claimable(address?: string) => ClaimableRelays | Fingerprint[]
  ```

- View method to check if a fingerprint/address tuple is claimable
  ```typescript
  isClaimable(fingerprint: string, address: string) => boolean
  ```

- Claims a fingerprint if claimable by the caller's EVM address
  ```typescript
  claim(fingerprint: string) => void
  ```

- Renounces a verified fingerprint/address claim if currently verified by the caller's EVM address
  ```typescript
  renounce(fingerprint: string) => void
  ```

- Allows Owner to remove stale verifications
  ```typescript
  // @OnlyOwner
  removeVerified(fingerprint) => void
  ```

- View method to return either
  1) The current verified fingerprint/address tuples
  2) A list of fingerprints claimed/verified by the provided address
  ```typescript
  verified(address?: string) => VerifiedRelays | Fingerprint[]
  ```

- View method to check if a fingerprint is verified
  ```typescript
  isVerified(fingerprint: string) => boolean
  ```
