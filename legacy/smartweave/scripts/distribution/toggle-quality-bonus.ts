import dotenv from 'dotenv'
import { LoggerFactory, WarpFactory } from 'warp-contracts'
import { EthersExtension } from 'warp-contracts-plugin-ethers'
import { Wallet } from 'ethers'
import Consul from 'consul'
import EthereumSigner from 'arbundles/src/signing/chains/ethereumSigner'

import {
  DistributionHandle,
  DistributionState,
  ToggleQualityTierBonus
} from '../../src/contracts'

dotenv.config()

const consulToken = process.env.CONSUL_TOKEN
const contractOwnerPrivateKey = process.env.DISTRIBUTION_OPERATOR_KEY
const qualityBonusEnabled = process.env.QUALITY_BONUS_ENABLED || ''
let contractTxId = process.env.DISTRIBUTION_CONTRACT_ID

LoggerFactory.INST.logLevel('error')

const warp = WarpFactory
  .forMainnet()
  .use(new EthersExtension())

async function main() {
  if (!['true', 'false'].includes(qualityBonusEnabled)) {
    throw new Error(
      'QUALITY_BONUS_ENABLED must be "true" or "false" (string)'
    )
  }

  if (consulToken) {
    const host = process.env.CONSUL_IP,
      port = process.env.CONSUL_PORT,
      key = process.env.DISTRIBUTION_ADDRESS_CONSUL_KEY
    if (!host) { throw new Error('CONSUL_IP is not set!') }
    if (!port) { throw new Error('CONSUL_PORT is not set!') }
    if (!key) { throw new Error('DISTRIBUTION_ADDRESS_CONSUL_KEY is not set!') }

    console.log(`Connecting to Consul at ${host}:${port}`)
    const consul = new Consul({ host, port })

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
    throw new Error('DISTRIBUTION_OPERATOR_KEY is not set!')
  }

  const contract = warp.contract<DistributionState>(contractTxId)
  const contractOwner = new Wallet(contractOwnerPrivateKey)
  const enabled = qualityBonusEnabled === 'true' ? true : false
  const input: ToggleQualityTierBonus = {
    function: 'toggleQualityTierBonus',
    enabled
  }

  console.log(
    `Toggling quality bonus enabled ${enabled} on contract ${contractTxId}`
  )

  // NB: Sanity check by getting current state and "dry-running" thru contract
  //     source handle directly.  If it doesn't throw, we're good.
  const { cachedValue: { state } } = await contract.readState()
  DistributionHandle(state, {
    input,
    caller: contractOwner.address,
    interactionType: 'write'
  })

  // NB: Send off the interaction for real
  const result = await contract
    .connect(new EthereumSigner(contractOwnerPrivateKey))
    .writeInteraction<ToggleQualityTierBonus>(input)

  console.log(
    `Toggling quality bonus enabled ${enabled} result`
      + ` txid ${result?.originalTxId}`
  )
}

main().catch(error => { console.error(error); process.exitCode = 1; })
