import dotenv from 'dotenv'
import { LoggerFactory, WarpFactory } from 'warp-contracts'
import EthereumSigner from 'arbundles/src/signing/chains/ethereumSigner'
import { EthersExtension } from 'warp-contracts-plugin-ethers'
import { Wallet } from 'ethers'
import Consul from 'consul'
import BigNumber from 'bignumber.js'

import {
  AddClaimableBatched,
  RelayRegistryHandle,
  RelayRegistryState
} from '../../src/contracts'
import TestData from '../../data/test-data.json'

dotenv.config()

let contractTxId = process.env.RELAY_REGISTRY_CONTRACT_ID || ''
const consulToken = process.env.CONSUL_TOKEN
const contractOwnerPrivateKey = process.env.RELAY_REGISTRY_OPERATOR_KEY

LoggerFactory.INST.logLevel('error')
BigNumber.config({ EXPONENTIAL_AT: 50 })

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

  const contract = warp.contract<RelayRegistryState>(contractTxId)

  const claims: {
    address: string,
    fingerprint: string,
    nickname?: string
  }[] = []

  if (consul) {
    const accountsData = await consul.kv.get<{ Value: string }>({
      key: process.env.TEST_ACCOUNTS_KEY || 'dummy-path',
      token: consulToken
    })
    
    if (accountsData) {
      const decodedValue = Buffer.from(accountsData.Value, 'base64').toString('utf-8');
      const accounts = JSON.parse(decodedValue) as string[];
      claims.push(...accounts.map((acct, index, array) => ({
        address: acct,
        fingerprint: BigNumber(1E39).plus(index).integerValue().toString()
      })))

      console.log(claims)
    }
  } else {
    claims.push(...TestData.relays)
  }

  try {
    const input: AddClaimableBatched = {
      function: 'addClaimableBatched',
      relays: claims
    }

    // NB: Sanity check by getting current state and "dry-running" thru
    //     contract source handle directly.  If it doesn't throw, we're good.
    const { cachedValue: { state } } = await contract.readState()
    RelayRegistryHandle(state, {
      input,
      caller: new Wallet(contractOwnerPrivateKey).address,
      interactionType: 'write'
    })

    // NB: Send off the interaction for real
    const result = await contract
      .connect(new EthereumSigner(contractOwnerPrivateKey))
      .writeInteraction<AddClaimableBatched>(input)

    console.log('Add Relays result', result?.originalTxId)
  } catch(e) {
    console.error(e)
    console.log("Continuing execution")
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; })
