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
const fingerprints = process.env.FINGERPRINTS

if (!ethPrivateKey) {
  throw new Error('ETH_PRIVATE_KEY is not set!')
}

if (!processId) {
  throw new Error('PROCESS_ID is not set!')
}

if (!fingerprints) {
  throw new Error(
    'FINGERPRINTS is not set! (comma separated, e.g. abc123,def456,ghi789)'
  )
}

const signer = new EthereumSigner(ethPrivateKey)

async function updateRoles() {
  logger.info(
    `Signing using wallet with public key ${signer.publicKey.toString('hex')}`
  )
  logger.info(`Calling Add-Verified-Hardware on AO Process ${processId}`)
  logger.info(`With Data: `, fingerprints)

  const { messageId, result } = await sendAosMessage({
    processId: processId!,
    signer: await createEthereumDataItemSigner(signer) as any,
    tags: [{ name: 'Action', value: 'Add-Verified-Hardware' }],
    data: fingerprints
  })

  logger.info(`Got reply with messageId: ${messageId}`)
  logger.info(`Add-Verified-Hardware Result:`, JSON.stringify(result))
}

updateRoles().catch(e => { logger.error(e); process.exit(1); })
