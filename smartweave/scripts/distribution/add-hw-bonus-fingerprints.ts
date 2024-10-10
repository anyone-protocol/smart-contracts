import dotenv from 'dotenv'
import { LoggerFactory, WarpFactory } from 'warp-contracts'
import EthereumSigner from 'arbundles/src/signing/chains/ethereumSigner'
import { EthersExtension } from 'warp-contracts-plugin-ethers'
import { Wallet } from 'ethers'
import Consul from 'consul'
import BigNumber from 'bignumber.js'
import _ from 'lodash'

import {
  AddFingerprintsToBonus,
  DistributionHandle,
  DistributionState,
  RelayRegistryState,
} from '../../src/contracts'

dotenv.config()

const consulToken = process.env.CONSUL_TOKEN
const contractOwnerPrivateKey = process.env.DISTRIBUTION_OPERATOR_KEY
let distributionContractId = process.env.DISTRIBUTION_CONTRACT_ID
let relayRegistryContractId = process.env.RELAY_REGISTRY_CONTRACT_ID
let dreHostname = process.env.DRE_HOSTNAME
const FINGERPRINTS = process.env.FINGERPRINTS

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
      distributionAddressKey = process.env.DISTRIBUTION_ADDRESS_CONSUL_KEY,
      relayRegistryAddressKey = process.env.RELAY_REGISTRY_ADDRESS_CONSUL_KEY
      // dreHostnameKey = process.env.DRE_HOSTNAME_CONSUL_KEY
    if (!host) { throw new Error('CONSUL_IP is not set!') }
    if (!port) { throw new Error('CONSUL_PORT is not set!') }
    if (!distributionAddressKey) {
      throw new Error('DISTRIBUTION_ADDRESS_CONSUL_KEY is not set!')
    }
    if (!relayRegistryAddressKey) {
      throw new Error('RELAY_REGISTRY_ADDRESS_CONSUL_KEY is not set!')
    }
    // if (!dreHostnameKey) {
    //   throw new Error('DRE_HOSTNAME_CONSUL_KEY is not set!')
    // }

    console.log(`Connecting to Consul at ${host}:${port}`)
    consul = new Consul({ host, port })

    const {
      Value: distributionContractIdValue
    } = await consul.kv.get<{ Value: string }>({
      token: consulToken,
      key: distributionAddressKey
    })
    distributionContractId = distributionContractIdValue

    const {
      Value: relayRegistryContractIdValue
    } = await consul.kv.get<{ Value: string }>({
      token: consulToken,
      key: relayRegistryAddressKey
    })
    relayRegistryContractId = relayRegistryContractIdValue

    // const { Value: dreHostnameValue } = await consul.kv.get<{ Value: string }>({
    //   token: consulToken,
    //   key: dreHostnameKey
    // })
    // dreHostname = dreHostnameValue
  }

  if (!distributionContractId) {
    throw new Error('DISTRIBUTION_CONTRACT_ID is not set!')
  }

  if (!relayRegistryContractId) {
    throw new Error('RELAY_REGISTRY_CONTRACT_ID is not set!')
  }

  if (!contractOwnerPrivateKey) {
    throw new Error('DISTRIBUTION_OPERATOR_KEY is not set!')
  }

  const relayRegistryContract = warp
    .contract<RelayRegistryState>(relayRegistryContractId)
    .setEvaluationOptions({
      remoteStateSyncEnabled: true
    })
  const distributionContract = warp
    .contract<DistributionState>(distributionContractId)
    .setEvaluationOptions({
      remoteStateSyncEnabled: true
    })
  const contractOwner = new Wallet(contractOwnerPrivateKey)

  const fingerprints: string[] = []

  if (FINGERPRINTS) {
    fingerprints.push(...FINGERPRINTS.split(','))
  } else {
    const {
      cachedValue: { state: { verifiedHardware } }
    } = await relayRegistryContract.readState()
    const relayRegistryHardwareFingerprints = Object.keys(verifiedHardware)

    const {
      cachedValue: {
        state: {
          bonuses: {
            hardware: { fingerprints: distributionHardwareFingerprints }
          }
        }
      }
    } = await distributionContract.readState()
    fingerprints.push(
      ..._.difference(
        relayRegistryHardwareFingerprints,
        distributionHardwareFingerprints
      )
    )
  }

  const batches = _.chunk(fingerprints, 25)
  for (const fingerprints of batches) {
    const input: AddFingerprintsToBonus = {
      function: 'addFingerprintsToBonus',
      bonusName: 'hardware',
      fingerprints
    }

    // NB: Sanity check by getting current state and "dry-running" thru
    //     contract source handle directly.  If it doesn't throw, we're good.
    const { cachedValue: { state } } = await distributionContract.readState()
    DistributionHandle(state, {
      input,
      caller: contractOwner.address,
      interactionType: 'write'
    })

    try {
      // NB: Send off the interaction for real
      const result = await distributionContract
        .connect(new EthereumSigner(contractOwnerPrivateKey))
        .writeInteraction<AddFingerprintsToBonus>(input)

      console.log(
        `AddFingerprintsToBonus hardware [${fingerprints.join(',')}] result`,
        result?.originalTxId
      )
    } catch(e) {
      console.error(e)
      console.log("Continuing execution")
    }
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; })
