import { EthereumSigner } from '@ardrive/turbo-sdk'
import dotenv from 'dotenv'
import { readFileSync } from 'fs'

import { logger } from '../util/logger'
import {
  createEthereumDataItemSigner,
  sendAosMessage
} from '../send-aos-message'

dotenv.config()
const ethPrivateKey = process.env.ETH_PRIVATE_KEY
const processId = process.env.PROCESS_ID || ''
const snapshotDataPath = process.env.SNAPSHOT_DATA_PATH || ''
if (!ethPrivateKey) {
  throw new Error('ETH_PRIVATE_KEY is not set!')
}
if (!processId) {
  throw new Error('PROCESS_ID is not set!')
}
if (!snapshotDataPath) {
  throw new Error('SNAPSHOT_DATA_PATH is not set!')
}

const signer = new EthereumSigner(ethPrivateKey)

async function addStakingSnapshot() {
  logger.info(
    `Signing using wallet with public key [${signer.publicKey.toString('hex')}]`
  )

  const stakingSnapshotData = readFileSync(snapshotDataPath, 'utf-8')
  if (!stakingSnapshotData) {
    throw new Error(
      `Failed to read staking snapshot data from path [${snapshotDataPath}]`
    )
  }
  logger.info(`Read staking snapshot data from path [${snapshotDataPath}]`)
  logger.info(
    `Calling Add-Staking-Snapshot on AO Process [${processId}]`
  )

  const { messageId, result } = await sendAosMessage({
    processId,
    signer: await createEthereumDataItemSigner(signer) as any,
    tags: [
      { name: 'Action', value: 'Add-Staking-Snapshot' },
      { name: 'Add-Staking-Snapshot-Timestamp', value: Date.now().toString() }
    ],
    data: JSON.stringify(stakingSnapshotData)
  })

  logger.info(`Got reply with messageId [${messageId}]`)
  logger.info(`Add-Staking-Snapshot Result [${JSON.stringify(result)}]`)
  logger.info(
    `View message at https://aolink.ar.anyone.tech/message/${messageId}`
  )
}

addStakingSnapshot().catch(e => { logger.error(e); process.exit(1); })
