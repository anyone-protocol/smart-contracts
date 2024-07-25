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
import {
  ToggleFamilyRequirement
} from '../../src/contracts/relay-registry'

dotenv.config()

let contractTxId = process.env.RELAY_REGISTRY_CONTRACT_ID || ''
const consulToken = process.env.CONSUL_TOKEN
const contractOwnerPrivateKey = process.env.RELAY_REGISTRY_OPERATOR_KEY
const familyRequirementEnabled =
  process.env.FAMILY_REQUIREMENT_ENABLED || ''

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
    throw new Error('RELAY_REGISTRY_OPERATOR_KEY is not set!')
  }

  if (!['true', 'false'].includes(familyRequirementEnabled)) {
    throw new Error(
      'FAMILY_REQUIREMENT_ENABLED must be "true" or "false" (string)'
    )
  }

  const contract = warp.contract<RelayRegistryState>(contractTxId)

  const input: ToggleFamilyRequirement = {
    function: 'toggleFamilyRequirement',
    enabled: familyRequirementEnabled === 'true' ? true : false
  }

  // NB: Sanity check dry run
  const { cachedValue: { state } } = await contract.readState()
  RelayRegistryHandle(state, {
    input,
    caller: new Wallet(contractOwnerPrivateKey).address,
    interactionType: 'write'
  })

  // NB: Send real interaction
  const result = await contract
    .connect(new EthereumSigner(contractOwnerPrivateKey))
    .writeInteraction<ToggleFamilyRequirement>(input)

  console.log(
    `Toggle family requirement ${familyRequirementEnabled} result`,
    result?.originalTxId
  )
}

(async () => {
  try {
    await main()
  } catch (error) {
    console.error('Toggle Family Requirement script error', error)
    process.exitCode = 1
  }
})()
