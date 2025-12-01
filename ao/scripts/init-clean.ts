import { EthereumSigner } from '@ardrive/turbo-sdk'
import dotenv from 'dotenv'

import { logger } from './util/logger'
import {
  createEthereumDataItemSigner,
  sendAosMessage
} from './send-aos-message'

dotenv.config()

const ethPrivateKey = process.env.ETH_PRIVATE_KEY
const processId = process.env.PROCESS_ID
const initCleanData = process.env.INIT_CLEAN_DATA

if (!ethPrivateKey) {
  throw new Error('ETH_PRIVATE_KEY is not set!')
}

if (!processId) {
  throw new Error('PROCESS_ID is not set!')
}

if (!initCleanData) {
  throw new Error('INIT_CLEAN_DATA is not set!')
}

const signer = new EthereumSigner(ethPrivateKey)

async function initClean() {
  logger.info(
    `Signing using wallet with public key ${signer.publicKey.toString('hex')}`
  )
  logger.info(`Calling Init on AO Process ${processId}`)
  logger.info(`With Data: `, JSON.stringify(initCleanData))

  const { messageId, result } = await sendAosMessage({
    processId: processId!,
    signer: await createEthereumDataItemSigner(signer) as any,
    tags: [
      { name: 'Action', value: 'Init' },
      { name: 'Init-Timestamp', value: new Date().toISOString() }
    ],
    data: initCleanData
  })

  logger.info(`Got reply with messageId: ${messageId}`)
  logger.info(`Init Result:`, JSON.stringify(result))
}

initClean().catch(e => { logger.error(e); process.exit(1); })
