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

const deployerPrivateKey = process.env.DEPLOYER_PRIVATE_KEY
  || HardhatKeys.owner.key
const contractKey = process.env.CONTRACT_CONSUL_KEY || 'dummy-path',
      consulToken = process.env.CONSUL_TOKEN || '',
      host = process.env.CONSUL_IP,
      port = process.env.CONSUL_PORT
const pathToContractSrc = process.env.CONTRACT_SRC || ''
let contractId = process.env.CONTRACT_ID || ''

if (!deployerPrivateKey) {
  throw new Error('DEPLOYER_PRIVATE_KEY is not set!')
}

if (!pathToContractSrc) {
  throw new Error('CONTRACT_SRC is not set!')
}

LoggerFactory.INST.logLevel('error')

const warp = WarpFactory
  .forMainnet()
  .use(new EthersExtension())
  .use(new DeployPlugin())

const owner = new EthereumSigner(deployerPrivateKey)

async function evolve() {
  let consul
  if (consulToken) {
    if (!host) { throw new Error('CONSUL_IP is not set!') }
    if (!port) { throw new Error('CONSUL_PORT is not set!') }
    if (!contractKey) { throw new Error('CONTRACT_CONSUL_KEY is not set!') }
    
    console.log(`Connecting to Consul at ${host}:${port}`)
    consul = new Consul({ host, port })
    const { Value } = await consul.kv.get<{Value: string}>({
      token: consulToken,
      key: contractKey
    })
    contractId = Value
  }

  if (!contractId) {
    throw new Error('CONTRACT_ID is not set!')
  }

  const src = fs
    .readFileSync(path.join(__dirname, pathToContractSrc))
    .toString()

  console.log(`Evolving contract id ${contractId}`)
  if (deployerPrivateKey === HardhatKeys.owner.key) {
    console.warn('WARNING: Using hardhat #0 as deployer key!')
  }

  const contract = warp.contract(contractId)
  const newSourceTx = await warp.createSource({ src }, owner)
  const newSourceId = await warp.saveSource(newSourceTx)
  // NB: not using warp.evolve() because they expect input.value for new id
  const evolveResult = await contract.connect(owner).writeInteraction({
    function: 'evolve',
    newContractSrc: newSourceId,
    value: newSourceId
  })
  
  if (evolveResult) {
    const { interactionTx, originalTxId } = evolveResult
    console.log('Contract evolved!  New src', newSourceId)
    console.log('Contract ID', contractId)
    console.log('Interaction TX', await interactionTx.id)
    console.log('Original TX', originalTxId)

    if (consul) {
      const sourceKey = process.env.CONTRACT_SOURCE_CONSUL_KEY || 'evolve/test-deploy'
  
      const updateResult = await consul.kv.set({
        key: sourceKey,
        value: await newSourceTx.id,
        token: consulToken
      });
      console.log(`Cluster variable ${sourceKey} updated: ${updateResult}`)
    } else {
      console.warn('Deployment env var PHASE not defined, skipping update of cluster variable in Consul.')
    }

  } else {
    throw new Error('Result from evolve() call was null')
  }
}

(async () => {
  try {
    await evolve()
  } catch (error) {
    console.error('Evolve script error', error)
  }
})()
