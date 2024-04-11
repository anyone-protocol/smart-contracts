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
  - Path to contract src relative to deploy script
  - e.g. `../dist/contracts/relay-registry.js`
- `INIT_STATE`
  - Path to contract initial state JSON
  - e.g. `../scripts/test-states/relay-registry-init-state.json`
- `DEPLOYER_PRIVATE_KEY`
  - EVM deployer private key hex
  - Defaults to Hardhat Account #0

```bash
$ npm run deploy
```

## Evolve

Before evolving a contract, make sure the following environment variables are set:

- `CONTRACT_ID`
  - The ID of the contract being evolved
  - e.g. `Y6xd_xJ4EWc9F63UVC87huczSR3-RTaVxKwIXtbfGwE`
- `CONTRACT_SRC`
  - Path to new contract src relative to deploy script
  - e.g. `../dist/contracts/relay-registry.js`
- `DEPLOYER_PRIVATE_KEY`
  - EVM deployer private key hex
  - Defaults to Hardhat Account #0

```bash
$ npm run evolve
```

## Contracts

### Relay Registry

#### State

```typescript
type Fingerprint = string
type EvmAddress = string
type PublicKey = string
type RelayRegistryState = {
  owner: string
  canEvolve?: boolean
  evolve?: string
  claimable: { [fingerprint in Fingerprint as string]: EvmAddress }
  verified: { [fingerprint in Fingerprint as string]: EvmAddress }
  registrationCredits: { [address in EvmAddress as string]: number }
  blockedAddresses: EvmAddress[]
  families: { [fingerprint in Fingerprint as string]: Fingerprint[] }
  registrationCreditsRequired: boolean
  encryptionPublicKey: PublicKey
  serials: {
    [fingerprint in Fingerprint as string]: {
      serial: string
      verified?: boolean
    }
  }
}
```

#### Methods

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

- Allows Owner to add a registration credit for an address
  ```typescript
  addRegistrationCredit(address: string) => void
  ```

- Allows Owner to block an address from registering
  ```typescript
  blockAddress(address: string) => void
  ```

- Allows Owner to unblock an address from registering
  ```typescript
  unblockAddress(address: string) => void
  ```

- Allows Owner to set the effective family of a relay
  ```typescript
  setFamily(fingerprint: string, family: string[]) => void
  ```

- Allows Owner to toggle registration credits requirement to claim a relay
  ```typescript
  toggleRegistrationCreditRequirement(enabled: boolean) => void
  ```

- Allows Owner to set the encryption public key for passing secrets
  ```typescript
  setEncryptionPublicKey(encryptionPublicKey: PublicKey) => void
  ```

- Allows Owner to verify a hardware serials by fingerprints
  ```typescript
  verifySerials(fingerprints: Fingerprint[]) => void
  ```

- Allows Owner to remove a hardware serials by fingerprints
  ```typescript
  removeSerials(fingerprints: Fingerprint[]) => void
  ```

- View method to get verified relays and verified relays with verified serial
  proofs
  ```typescript
  getVerifiedRelays() => {
    verified: { [fingerprint in Fingerprint as string]: EvmAddress }
    verifiedWithSerial: { [fingerprint in Fingerprint as string]: EvmAddress }
  }
  ```

### Distribution

#### State

```typescript
type Fingerprint = string
type EvmAddress = string
type DistributionState = {
  owner: string
  canEvolve?: boolean
  evolve?: string
  tokensDistributedPerSecond: string,
  pendingDistributions: {
    [timestamp: string]: Score[]
  },
  claimable: {
    [address: string]: string
  }
  previousDistributions: {
    [timestamp: string]: {
      totalScore: string
      totalDistributed: string
      timeElapsed: string
      tokensDistributedPerSecond: string
      bonusTokens?: string
    }
  }
  multipliers: {
    [fingerprint: string]: string
  }
  previousDistributionsTrackingLimit: number
}
```

#### Methods

- Allows Owner to set the token distribution rate **in atomic units** per second
  ```typescript
  setTokenDistributionRate(tokensDistributedPerSecond: string) => void
  ```

- Allows Owner to add scores used in distribution calculations
  ```typescript
  addScores(
    timestamp: string,
    scores: { score: string, address: string, fingerprint: string }[]
  ) => void
  ```

- Allows Owner to distribute pending scores for a `timestamp` key
  ```typescript
  distribute(timestamp: string) => void
  ```

- Allows Owner to cancel a pending distribution for a `timestamp` key
  ```typescript
  cancelDistribution(timestamp: string) => void
  ```

- Allows Owner to set score multipliers for given `fingerprint`
  ```typescript
  setMultipliers(multipliers: { [fingerprint: string]: string }) => void
  ```

- Allows Owner to add bonus tokens to a distribution
  ```typescript
  setDistributionBonus(timestamp: string, bonus: string) => void
  ```

- Allows Owner to limit the number of previous distributions tracked in contract state.  Defaults to `10`
  ```typescript
  setPreviousDistributionTrackingLimit(limit: number) => void
  ```
