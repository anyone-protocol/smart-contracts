import { EthereumSigner } from '@ardrive/turbo-sdk'
import dotenv from 'dotenv'

import { logger } from '../util/logger'
import {
  createEthereumDataItemSigner,
  sendAosMessage
} from '../send-aos-message'

dotenv.config()
const ethPrivateKey = process.env.ETH_PRIVATE_KEY
const processId = process.env.PROCESS_ID || ''
const historySize = process.env.HISTORY_SIZE || ''
if (!ethPrivateKey) {
  throw new Error('ETH_PRIVATE_KEY is not set!')
}
if (!processId) {
  throw new Error('PROCESS_ID is not set!')
}
if (!historySize) {
  throw new Error('HISTORY_SIZE is not set!')
}

const signer = new EthereumSigner(ethPrivateKey)

async function setHistorySize() {
  logger.info(
    `Signing using wallet with public key [${signer.publicKey.toString('hex')}]`
  )
  logger.info(
    `Calling Set-History-Size [${historySize}] on AO Process [${processId}]`
  )

  const { messageId, result } = await sendAosMessage({
    processId,
    signer: await createEthereumDataItemSigner(signer) as any,
    tags: [
      { name: 'Action', value: 'Set-History-Size' },
      { name: 'History-Size', value: historySize },
      { name: 'Set-History-Size-Timestamp', value: Date.now().toString() }
    ]
  })

  logger.info(`Got reply with messageId [${messageId}]`)
  logger.info(`Set-History-Size Result [${JSON.stringify(result)}]`)
  logger.info(
    `View message at https://aolink.ar.anyone.tech/message/${messageId}`
  )
}

setHistorySize().catch(e => { logger.error(e); process.exit(1); })
