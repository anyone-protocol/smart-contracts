import { EthereumSigner } from '@ardrive/turbo-sdk'
import dotenv from 'dotenv'

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
    'FINGERPRINTS is not set! (comma separated, e.g. abc123,def456,ghi789'
  )
}

const signer = new EthereumSigner(ethPrivateKey)

async function updateRoles() {
  console.log(
    `Signing using wallet with public key ${signer.publicKey.toString('hex')}`
  )
  console.log(`Calling Add-Verified-Hardware on AO Process ${processId}`)
  console.log(`With Data: `, fingerprints)

  const { messageId, result } = await sendAosMessage({
    processId: processId!,
    signer: await createEthereumDataItemSigner(signer) as any,
    tags: [{ name: 'Action', value: 'Add-Verified-Hardware' }],
    data: fingerprints
  })

  console.log(`Got reply with messageId: ${messageId}`)
  console.log(`Add-Verified-Hardware Result:`, result)
}

updateRoles().catch(e => { console.error(e); process.exit(1); })
