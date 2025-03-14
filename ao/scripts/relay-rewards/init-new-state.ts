import { EthereumSigner } from '@ardrive/turbo-sdk'
import dotenv from 'dotenv'

import { logger } from '../util/logger'
import {
  createEthereumDataItemSigner,
  sendAosDryRun,
  sendAosMessage
} from '../send-aos-message'
import { oldState } from './oldState'
import { setMaxIdleHTTPParsers } from 'http'
import { newState } from './newState'

dotenv.config()

const ethPrivateKey = process.env.ETH_PRIVATE_KEY
const processId = process.env.NEW_RELAY_REWARDS_PROCESS_ID

if (!ethPrivateKey) {
  throw new Error('ETH_PRIVATE_KEY is not set!')
}

if (!processId) {
  throw new Error('NEW_RELAY_REWARDS_PROCESS_ID is not set!')
} else { logger.info(`Relay rewards process ID: ${processId}`)}

const signer = new EthereumSigner(ethPrivateKey)
logger.info(
  `Using wallet with public key ${signer.publicKey.toString('hex')}`
)

async function initState() {
  logger.info(`Calling Init on Relay Rewards AO Process ${processId}`)

  const result = await sendAosMessage({
    processId: processId!,
    signer: await createEthereumDataItemSigner(signer) as any,
    tags: [{ name: 'Action', value: 'Init' }],
    data: JSON.stringify(newState)
  })
  console.log(result)
  console.log(result.result.Messages[0].Data)
}

initState().catch(e => { logger.error(e); process.exit(1); })
