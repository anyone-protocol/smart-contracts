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
const updateConfigData = process.env.UPDATE_CONFIG_DATA

if (!ethPrivateKey) {
  throw new Error('ETH_PRIVATE_KEY is not set!')
}

if (!processId) {
  throw new Error('PROCESS_ID is not set!')
}

if (!updateConfigData) {
  throw new Error('UPDATE_CONFIG_DATA is not set!')
}

const signer = new EthereumSigner(ethPrivateKey)

async function updateRoles() {
  logger.info(
    `Signing using wallet with public key ${signer.publicKey.toString('hex')}`
  )
  logger.info(`Calling Update-Configuration on Staking Rewards AO Process ${processId}`)
  logger.info(`With Data: `, JSON.stringify(updateConfigData))

  const { messageId, result } = await sendAosMessage({
    processId: processId!,
    signer: await createEthereumDataItemSigner(signer) as any,
    tags: [{ name: 'Action', value: 'Update-Configuration' },
      { name: 'Update-Configuration-Timestamp', value: new Date().toISOString() }
    ],
    data: updateConfigData
  })

  logger.info(`Got reply with messageId: ${messageId}`)
  logger.info(`Update-Configuration Result:`, JSON.stringify(result))
}

updateRoles().catch(e => { logger.error(e); process.exit(1); })
