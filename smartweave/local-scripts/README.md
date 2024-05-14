## Deploy

Before deploying, make sure the following environment variables are set:

(Create .env file in the smartweave folder and place all variable there)

- `CONTRACT_SRC`
  - Path to contract src relative to deploy script
  - e.g. `../dist/contracts/relay-registry.js`
- `INIT_STATE`
  - Path to contract initial state JSON
  - e.g. `../scripts/test-states/relay-registry-init-state.json`
- `DEPLOYER_PRIVATE_KEY`
  - EVM deployer private key hex
  - Defaults to Hardhat Account #0

Also, modify `smartweave/scripts/test-states/relay-registry-init-state.json` file in order to see relays on dashboard
- Change the owner of contract to your metamask address
- Change the address of a few relays in verified and claimable sections to your metamask address.


```bash
$ npm run deploy
```

## Add claimable relays

Before adding claimable relays, make sure the following environment variables are set:

(Create .env file in the local-scripts folder and place all variable there)

- `OWNER_KEY`
  - EVM deployer private key hex
  - Defaults to Hardhat Account #0
- `CONTRACT_ID`
  - The id of the contract that was previously deployed
  - Should be available in logs after deploy command

```bash
$ npm run add-relays-local
```