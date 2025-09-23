import { EthereumSigner } from '@ardrive/turbo-sdk'
import dotenv from 'dotenv'

import { logger } from '../util/logger'
import {
  createEthereumDataItemSigner,
  sendAosMessage
} from '../send-aos-message'

dotenv.config()

const ethPrivateKey = process.env.ETH_PRIVATE_KEY
const processId = process.env.PROCESS_ID
const evalCode = process.env.EVAL_CODE

if (!evalCode) {
  throw new Error('EVAL_CODE is not set!')
}

if (!ethPrivateKey) {
  throw new Error('ETH_PRIVATE_KEY is not set!')
}

if (!processId) {
  throw new Error('PROCESS_ID is not set!')
}

const signer = new EthereumSigner(ethPrivateKey)

async function evalAction() {
  logger.info(
    `Signing using wallet with public key ${signer.publicKey.toString('hex')}`
  )
  logger.info(`Calling Eval on AO Process ${processId}`)
  logger.info(`With Data: `, evalCode)

  const { messageId, result } = await sendAosMessage({
    processId: processId!,
    signer: await createEthereumDataItemSigner(signer) as any,
    tags: [{ name: 'Action', value: 'Eval' }],
    data: evalCode
  })

  logger.info(`Got reply with messageId: ${messageId}`)
  logger.info(`Eval Result:`, JSON.stringify(result))
}

evalAction().catch(e => { logger.error(e); process.exit(1); })
