import { EthereumSigner } from '@ardrive/turbo-sdk'
import dotenv from 'dotenv'

import { logger } from '../util/logger'
import {
  createEthereumDataItemSigner,
  sendAosDryRun,
  sendAosMessage
} from '../send-aos-message'
import { oldState } from './oldState'

dotenv.config()

const ethPrivateKey = process.env.ETH_PRIVATE_KEY
const processId = process.env.RELAY_REWARDS_PROCESS_ID
const operatorProcessId = process.env.OPERATOR_REGISTRY_PROCESS_ID

if (!ethPrivateKey) {
  throw new Error('ETH_PRIVATE_KEY is not set!')
}

if (!processId) {
  throw new Error('RELAY_REWARDS_PROCESS_ID is not set!')
} else { logger.info(`Relay rewards process ID: ${processId}`)}

if (!operatorProcessId) {
  throw new Error('OPERATOR_REGISTRY_PROCESS_ID is not set!')
} else { logger.info(`Operator registry process ID: ${operatorProcessId}`)}

const signer = new EthereumSigner(ethPrivateKey)
logger.info(
  `Using wallet with public key ${signer.publicKey.toString('hex')}`
)

async function fetchOldState() {
  logger.info(`Calling View-State on Relay Rewards AO Process ${processId}`)

  const result = await sendAosDryRun({
    processId: operatorProcessId!,
    // signer: await createEthereumDataItemSigner(signer) as any,
    tags: [{ name: 'Action', value: 'View-State' }],
    data: ''
  })
  console.log(result)

  const json = JSON.parse(result.result.Messages[0].Data)

  return json
}

async function getForFingerprint(fingerprint: string) {
  const { result } = await sendAosDryRun({
    processId: operatorProcessId!,
    //signer: await createEthereumDataItemSigner(signer) as any,
    tags: [
      { name: 'Action', value: 'Get-Rewards' },
      { name: 'Address', value: '0x6D454e61876334ee2Ca473E3b4B66777C931886E' },
      { name: 'Fingerprint', value: fingerprint}
    ]
  })
  console.log(result)
  return result.Messages[0].Data
}

async function doFlow() {
  // const oldState = await fetchOldState()

  const fingerprints = Object.keys(oldState.VerifiedFingerprintsToOperatorAddresses)
  const addresses = [ ... new Set(Object.values(oldState.VerifiedFingerprintsToOperatorAddresses))]
  
  logger.info(`Processing fingerprints ${fingerprints.length} addresses: ${addresses.length}`)

  // fingerprints.forEach(async (fingerprint) => {
    const rewardForFingerprint = await getForFingerprint(fingerprints[0])
    console.log(`${fingerprints[0]}: ${rewardForFingerprint}`)
  // })
}

doFlow().catch(e => { logger.error(e); process.exit(1); })
