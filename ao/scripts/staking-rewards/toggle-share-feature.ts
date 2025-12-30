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
const featureSharesEnabled = process.env.FEATURE_SHARES_ENABLED || ''

if (!ethPrivateKey) {
  throw new Error('ETH_PRIVATE_KEY is not set!')
}

if (!processId) {
  throw new Error('PROCESS_ID is not set!')
}

if (featureSharesEnabled !== 'true' && featureSharesEnabled !== 'false') {
  throw new Error('FEATURE_SHARES_ENABLED must be "true" or "false"!')
}

const signer = new EthereumSigner(ethPrivateKey)

async function toggleShareFeature() {
  logger.info(
    `Signing using wallet with public key ${signer.publicKey.toString('hex')}`
  )
  logger.info(`Calling Toggle-Feature-Shares on Staking Rewards AO Process ${processId}`)
  const config = { Enabled: featureSharesEnabled === 'true' }
  logger.info(`With Data: `, JSON.stringify(config))

  const { messageId, result } = await sendAosMessage({
    processId: processId!,
    signer: await createEthereumDataItemSigner(signer) as any,
    tags: [
      { name: 'Action', value: 'Toggle-Feature-Shares' },
      {
        name: 'Toggle-Feature-Shares-Timestamp',
        value: new Date().toISOString()
      }
    ],
    data: JSON.stringify(config)
  })

  logger.info(`Got reply with messageId: ${messageId}`)
  logger.info(`Toggle-Feature-Shares Result:`, JSON.stringify(result))
}

toggleShareFeature().catch(e => { logger.error(e); process.exit(1); })
