import { EthereumSigner } from '@ardrive/turbo-sdk'
import dotenv from 'dotenv'

import { logger } from '../util/logger'
import {
  createEthereumDataItemSigner,
  sendAosMessage
} from '../send-aos-message'
import { updateRoles } from '../acl/update-roles'

dotenv.config()

const ethPrivateKey = process.env.ETH_PRIVATE_KEY
const processId = process.env.PROCESS_ID

if (!ethPrivateKey) {
  throw new Error('ETH_PRIVATE_KEY is not set!')
}

if (!processId) {
  throw new Error('PROCESS_ID is not set!')
}

const signer = new EthereumSigner(ethPrivateKey)

export async function addWorkerAcl(signer: EthereumSigner, processId: string) {

}

addWorkerAcl(signer, processId)
  .catch(e => { logger.error(e); process.exit(1); })
