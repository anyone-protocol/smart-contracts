import { EthereumSigner } from '@ardrive/turbo-sdk'
import dotenv from 'dotenv'

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
  console.log(
    `Signing using wallet with public key ${signer.publicKey.toString('hex')}`
  )
  console.log(`Calling Update-Configuration on Relay Rewards AO Process ${processId}`)
  console.log(`With Data: `, updateConfigData)

  const { messageId, result } = await sendAosMessage({
    processId: processId!,
    signer: await createEthereumDataItemSigner(signer) as any,
    tags: [{ name: 'Action', value: 'Update-Configuration' }],
    data: updateConfigData
  })

  console.log(`Got reply with messageId: ${messageId}`)
  console.log(`Update-Configuration Result:`, result)
}

updateRoles().catch(e => { console.error(e); process.exit(1); })
