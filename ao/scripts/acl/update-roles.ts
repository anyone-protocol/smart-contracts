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
const updateRolesData = process.env.UPDATE_ROLES_DATA

if (!ethPrivateKey) {
  throw new Error('ETH_PRIVATE_KEY is not set!')
}

if (!processId) {
  throw new Error('PROCESS_ID is not set!')
}

if (!updateRolesData) {
  throw new Error('UPDATE_ROLES_DATA is not set!')
}

const signer = new EthereumSigner(ethPrivateKey)

async function updateRoles() {
  logger.info(
    `Signing using wallet with public key ${signer.publicKey.toString('hex')}`
  )
  logger.info(`Calling Update-Roles on AO Process ${processId}`)
  logger.info(`With Data: `, updateRolesData)

  const { messageId, result } = await sendAosMessage({
    processId: processId!,
    signer: await createEthereumDataItemSigner(signer) as any,
    tags: [{ name: 'Action', value: 'Update-Roles' }],
    data: updateRolesData
  })

  logger.info(`Got reply with messageId: ${messageId}`)
  logger.info(`Update-Roles Result:`, JSON.stringify(result))
}

updateRoles().catch(e => { logger.error(e); process.exit(1); })
