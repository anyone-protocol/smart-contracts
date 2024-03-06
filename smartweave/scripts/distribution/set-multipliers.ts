import dotenv from 'dotenv'
import fs from 'fs'
import path from 'path'
import { LoggerFactory, WarpFactory } from 'warp-contracts'
import { EthersExtension } from 'warp-contracts-plugin-ethers'
import { Wallet } from 'ethers'
import Consul from 'consul'
import EthereumSigner from 'arbundles/src/signing/chains/ethereumSigner'

import {
  DistributionHandle,
  DistributionState,
  SetMultipliers
} from '../../src/contracts'

dotenv.config()

let consulToken = process.env.CONSUL_TOKEN,
  contractTxId = process.env.DISTRIBUTION_CONTRACT_ID,
  contractOwnerPrivateKey = process.env.DISTRIBUTION_OWNER_KEY,
  distributionTimestamp = process.env.DISTRIBUTION_TIMESTAMP,
  pathToMultipliers = process.env.MULTIPLIERS_PATH

LoggerFactory.INST.logLevel('error')

const warp = WarpFactory
  .forMainnet()
  .use(new EthersExtension())

async function main() {
  if (!distributionTimestamp) {
    throw new Error('DISTRIBUTION_TIMESTAMP is not set!')
  }

  let consul
  if (consulToken) {
    const host = process.env.CONSUL_IP,
      port = process.env.CONSUL_PORT,
      key = process.env.DISTRIBUTION_ADDRESS_CONSUL_KEY
    if (!host) { throw new Error('CONSUL_IP is not set!') }
    if (!port) { throw new Error('CONSUL_PORT is not set!') }
    if (!key) { throw new Error('DISTRIBUTION_ADDRESS_CONSUL_KEY is not set!') }

    console.log(`Connecting to Consul at ${host}:${port}`)
    consul = new Consul({ host, port })

    const { Value } = await consul.kv.get<{Value: string}>({
      token: consulToken,
      key
    })
    contractTxId = Value
  }

  if (!contractTxId) {
    throw new Error('DISTRIBUTION_CONTRACT_ID is not set!')
  }

  if (!contractOwnerPrivateKey) {
    throw new Error('DISTRIBUTION_OWNER_KEY is not set!')
  }

  const contract = warp.contract<DistributionState>(contractTxId)
  const contractOwner = new Wallet(contractOwnerPrivateKey)
  let multipliers: { [fingerprint: string]: string } = {}

  if (pathToMultipliers) {
    multipliers = JSON.parse(
      fs.readFileSync(path.join(__dirname, pathToMultipliers)).toString()
    )
  } else if (consul) {
    // TODO -> :)
  }

  const input: SetMultipliers = {
    function: 'setMultipliers',
    multipliers
  }

  // NB: Sanity check by getting current state and "dry-running" thru contract
  //     source handle directly.  If it doesn't throw, we're good.
  const { cachedValue: { state } } = await contract.readState()
  DistributionHandle(state, {
    input,
    caller: contractOwner.address,
    interactionType: 'write'
  })

  // NB: Send off the interaction for real
  await contract
    .connect(new EthereumSigner(contractOwnerPrivateKey))
    .writeInteraction<SetMultipliers>(input)
}

main().catch(error => { console.error(error); process.exitCode = 1; })
