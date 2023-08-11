import { LoggerFactory, WarpFactory } from 'warp-contracts'
import { EthereumSigner } from 'warp-contracts-plugin-deploy'
import { EthersExtension } from 'warp-contracts-plugin-ethers'
import {
  buildEvmSignature,
  EvmSignatureVerificationServerPlugin
  // @ts-ignore
} from 'warp-contracts-plugin-signature/server'
import { Wallet } from 'ethers'
import Consul from 'consul'

import {
  DistributionHandle,
  DistributionState,
  SetTokenDistributionRate
} from '~/src/contracts'

let consulToken = process.env.CONSUL_TOKEN,
  contractTxId = process.env.DISTRIBUTION_CONTRACT_ID,
  contractOwnerPrivateKey = process.env.DISTRIBUTION_OWNER_KEY,
  tokensDistributedPerSecond = process.env.TOKENS_DISTRIBUTED_PER_SECOND

LoggerFactory.INST.logLevel('error')

const warp = WarpFactory
  .forMainnet()
  .use(new EthersExtension())
  .use(new EvmSignatureVerificationServerPlugin())

async function main() {
  if (!tokensDistributedPerSecond) {
    throw new Error('TOKENS_DISTRIBUTED_PER_SECOND is not set!')
  }

  if (consulToken) {
    const host = process.env.CONSUL_IP, port = process.env.CONSUL_PORT
    if (!host) { throw new Error('CONSUL_IP is not set!') }
    if (!port) { throw new Error('CONSUL_PORT is not set!') }
    
    console.log(`Connecting to Consul at ${host}:${port}`)
    const consul = new Consul({ host, port })

    contractTxId = await consul.kv.get({
      token: consulToken,
      key: 'smart-contracts/stage/distribution-address'
    })
  }

  if (!contractTxId) {
    throw new Error('DISTRIBUTION_CONTRACT_ID is not set!')
  }

  if (!contractOwnerPrivateKey) {
    throw new Error('DISTRIBUTION_OWNER_KEY is not set!')
  }

  const contract = warp.contract<DistributionState>(contractTxId)
  const contractOwner = new EthereumSigner(contractOwnerPrivateKey)
  const contractOwnerAddress = new Wallet(contractOwnerPrivateKey).address

  const input: SetTokenDistributionRate = {
    function: 'setTokenDistributionRate',
    tokensDistributedPerSecond
  }

  // NB: Sanity check by getting current state and "dry-running" thru contract
  //     source handle directly.  If it doesn't throw, we're good.
  const { cachedValue: { state } } = await contract.readState()
  DistributionHandle(state, {
    input,
    caller: contractOwnerAddress,
    interactionType: 'write'
  })

  // NB: Send off the interaction for real
  await contract
    .connect({
      signer: buildEvmSignature(contractOwner),
      type: 'ethereum'
    })
    .writeInteraction<SetTokenDistributionRate>(input)
}

main().catch(error => { console.error(error); process.exitCode = 1; })