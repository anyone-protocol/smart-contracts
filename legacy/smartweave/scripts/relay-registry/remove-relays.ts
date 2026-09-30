import dotenv from 'dotenv'
import { LoggerFactory, WarpFactory } from 'warp-contracts'
import EthereumSigner from 'arbundles/src/signing/chains/ethereumSigner'
import { EthersExtension } from 'warp-contracts-plugin-ethers'
import { Wallet } from 'ethers'
import Consul from 'consul'
import BigNumber from 'bignumber.js'
import { setTimeout } from 'timers/promises'

import {
  RelayRegistryHandle,
  RelayRegistryState,
  RemoveClaimable
} from '../../src/contracts'
import { fingerprints } from '../../data/data.json'

dotenv.config()
LoggerFactory.INST.logLevel('error')
BigNumber.config({ EXPONENTIAL_AT: 50 })

let contractTxId = process.env.RELAY_REGISTRY_CONTRACT_ID || ''
const consulToken = process.env.CONSUL_TOKEN
const contractOwnerPrivateKey = process.env.RELAY_REGISTRY_OPERATOR_KEY
let sleepBetweenInteractions = Number.parseInt(
  process.env.SLEEP_BETWEEN_INTERACTIONS || '5000'
)

const warp = WarpFactory
  .forMainnet()
  .use(new EthersExtension())

async function main() {
  let consul
  if (consulToken) {
    const host = process.env.CONSUL_IP,
      port = process.env.CONSUL_PORT,
      key = process.env.RELAY_REGISTRY_ADDRESS_CONSUL_KEY
    if (!host) { throw new Error('CONSUL_IP is not set!') }
    if (!port) { throw new Error('CONSUL_PORT is not set!') }
    if (!key) {
      throw new Error('RELAY_REGISTRY_ADDRESS_CONSUL_KEY is not set!')
    }
    
    console.log(`Connecting to Consul at ${host}:${port}`)
    consul = new Consul({ host, port })
    const { Value } = await consul.kv.get<{Value: string}>({
      token: consulToken,
      key
    })
    contractTxId = Value
  }

  if (!contractTxId) {
    throw new Error('RELAY_REGISTRY_CONTRACT_ID is not set!')
  }

  if (!contractOwnerPrivateKey) {
    throw new Error('RELAY_REGISTRY_OPERATOR_KEY is not set!')
  }

  if (Number.isNaN(sleepBetweenInteractions)) {
    throw new Error('SLEEP_BETWEEN_INTERACTIONS is NaN!')
  }

  const contract = warp.contract<RelayRegistryState>(contractTxId)
  const caller = new Wallet(contractOwnerPrivateKey).address
  const signer = new EthereumSigner(contractOwnerPrivateKey)

  console.log(`Sending ${fingerprints.length} RemoveClaimable interactions`)

  for (const fingerprint of fingerprints) {
    console.log(`Sleeping for ${sleepBetweenInteractions}`)
    await setTimeout(sleepBetweenInteractions)

    const input: RemoveClaimable = { function: 'removeClaimable', fingerprint }

    console.log(`Runnning sanity check for ${JSON.stringify(input)}`)
    try {
      // NB: Dry-run sanity check
      const { cachedValue: { state } } = await contract.readState()
      RelayRegistryHandle(state, {
        input,
        caller,
        interactionType: 'write'
      })

      // NB: Send off the real interaction
      const result = await contract
        .connect(signer)
        .writeInteraction<RemoveClaimable>(input)

      console.log(
        `Remove relay ${JSON.stringify(input)} result ${result?.originalTxId}`
      )
    } catch (error) {
      console.error(error)
      console.log('Continuing execution')
    }
  }

  console.log(`Processed ${fingerprints.length} RemoveClaimable interactions`)
}

main().catch(error => { console.error(error); process.exitCode = 1; })
