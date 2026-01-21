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
const updateSharesConfigData = process.env.UPDATE_SHARES_CONFIG_DATA

if (!ethPrivateKey) {
  throw new Error('ETH_PRIVATE_KEY is not set!')
}

if (!processId) {
  throw new Error('PROCESS_ID is not set!')
}

if (!updateSharesConfigData) {
  throw new Error('UPDATE_SHARES_CONFIG_DATA is not set!')
}

const signer = new EthereumSigner(ethPrivateKey)

async function updateRoles() {
  logger.info(
    `Signing using wallet with public key ${signer.publicKey.toString('hex')}`
  )
  logger.info(`Calling Update-Shares-Configuration on Staking Rewards AO Process ${processId}`)
  logger.info(`With Data: `, JSON.stringify(updateSharesConfigData))

  const { messageId, result } = await sendAosMessage({
    processId: processId!,
    signer: await createEthereumDataItemSigner(signer) as any,
    tags: [{ name: 'Action', value: 'Update-Shares-Configuration' },
      { name: 'Update-Shares-Configuration-Timestamp', value: new Date().toISOString() }
    ],
    data: updateSharesConfigData
  })

  logger.info(`Got reply with messageId: ${messageId}`)
  logger.info(`Update-Shares-Configuration Result:`, JSON.stringify(result))
  logger.info(`See message at https://aolink.ar.anyone.tech/message/${messageId}`)
}

updateRoles().catch(e => { logger.error(e); process.exit(1); })
