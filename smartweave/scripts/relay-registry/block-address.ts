import dotenv from 'dotenv'
import { LoggerFactory, WarpFactory } from 'warp-contracts'
import EthereumSigner from 'arbundles/src/signing/chains/ethereumSigner'
import { EthersExtension } from 'warp-contracts-plugin-ethers'
import { Wallet } from 'ethers'
import Consul from 'consul'
import BigNumber from 'bignumber.js'

import {
  RelayRegistryHandle,
  RelayRegistryState
} from '../../src/contracts'

dotenv.config()

let contractTxId = process.env.RELAY_REGISTRY_CONTRACT_ID || ''
const consulToken = process.env.CONSUL_TOKEN
const contractOwnerPrivateKey = process.env.RELAY_REGISTRY_OWNER_KEY

LoggerFactory.INST.logLevel('error')
BigNumber.config({ EXPONENTIAL_AT: 50 })

const warp = WarpFactory
  .forMainnet()
  .use(new EthersExtension())

async function main() {
  if (!contractTxId) {
    throw new Error('RELAY_REGISTRY_CONTRACT_ID is not set!')
  }

  if (!contractOwnerPrivateKey) {
    throw new Error('RELAY_REGISTRY_OWNER_KEY is not set!')
  }

  const contract = warp.contract<RelayRegistryState>(contractTxId)
}

(async () => {
  try {
    await main()
  } catch (error) {
    console.error('Block Address script error', error)
    process.exitCode = 1
  }
})()