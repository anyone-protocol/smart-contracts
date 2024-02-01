import dotenv from 'dotenv'
import EthereumSigner from 'arbundles/src/signing/chains/ethereumSigner'
import Consul from 'consul'
import fs from 'fs'
import path from 'path'
import {
  LoggerFactory,
  WarpFactory
} from 'warp-contracts'
import { DeployPlugin } from 'warp-contracts-plugin-deploy'
import { EthersExtension } from 'warp-contracts-plugin-ethers'

import HardhatKeys from './test-keys/hardhat.json'

dotenv.config()

const pathToContractSrc = process.env.CONTRACT_SRC || ''
const pathToInitState = process.env.INIT_STATE || ''
const deployerPrivateKey = process.env.DEPLOYER_PRIVATE_KEY
  || HardhatKeys.owner.key

const consulToken = process.env.CONSUL_TOKEN
|| 'no-token'

if (!pathToContractSrc) {
  throw new Error('CONTRACT_SRC is not set!')
}

if (!pathToInitState) {
  throw new Error('INIT_STATE is not set!')
}

;(async () => {
  LoggerFactory.INST.logLevel('error')  

  const warp = WarpFactory
    .forMainnet()
    .use(new EthersExtension())
    .use(new DeployPlugin())

  const wallet = new EthereumSigner(deployerPrivateKey)

  const src: string = fs.readFileSync(
    path.join(__dirname, pathToContractSrc)
  ).toString()

  const initState: string = fs.readFileSync(
    path.join(__dirname, pathToInitState)
  ).toString()

  const {
    contractTxId,
    srcTxId
  } = await warp.deploy({ wallet, src, initState })
  
  console.log(`Contract source published at ${srcTxId}`)
  console.log(`Contract deployed at ${contractTxId}`)

  if (process.env.PHASE !== undefined && process.env.CONSUL_IP !== undefined) {
    console.log(`Connecting to Consul at ${process.env.CONSUL_IP}:${process.env.CONSUL_PORT}...`)
    const consul = new Consul({
      host: process.env.CONSUL_IP,
      port: process.env.CONSUL_PORT,
    });
    
    const sourceKey = process.env.CONTRACT_SOURCE_CONSUL_KEY || 'dummy-path'
    const consulKey = process.env.CONTRACT_CONSUL_KEY || 'dummy-path'
    console.log(`Using consul keys ${consulKey} / ${sourceKey}`)

    const contractResult = await consul.kv.set({
      key: consulKey,
      value: contractTxId,
      token: consulToken
    });
    console.log(`Contract address updated: ${contractResult}`)

    if (srcTxId) {
      const sourceResult = await consul.kv.set({
        key: sourceKey,
        value: srcTxId,
        token: consulToken
      });
      console.log(`Contract source updated: ${sourceResult}`)
    }
  } else {
    console.warn('Deployment env var PHASE not defined, skipping update of cluster variable in Consul.')
  }
})()
