import { HardhatUserConfig } from 'hardhat/types'
import '@nomiclabs/hardhat-ethers'

const config: HardhatUserConfig = {
  solidity: {
    version: '0.8.10',
    settings: {
      optimizer: {
        enabled: true,
        runs: 100
      }
    }
  },
  networks: {
    hardhat: {
      // allowUnlimitedContractSize: true,
      gas: 'auto'
    }
  }
}

export default config
