import { EthereumSigner } from '@ardrive/turbo-sdk'
import dotenv from 'dotenv'

import { logger } from '../util/logger'
import {
  createEthereumDataItemSigner,
  sendAosDryRun,
  sendAosMessage
} from '../send-aos-message'
import { oldState } from './oldState'
import { setMaxIdleHTTPParsers } from 'http'

dotenv.config()

// const ethPrivateKey = process.env.ETH_PRIVATE_KEY
const processId = process.env.RELAY_REWARDS_PROCESS_ID
const operatorProcessId = process.env.OPERATOR_REGISTRY_PROCESS_ID

// if (!ethPrivateKey) {
//   throw new Error('ETH_PRIVATE_KEY is not set!')
// }

if (!processId) {
  throw new Error('RELAY_REWARDS_PROCESS_ID is not set!')
} else { logger.info(`Relay rewards process ID: ${processId}`)}

if (!operatorProcessId) {
  throw new Error('OPERATOR_REGISTRY_PROCESS_ID is not set!')
} else { logger.info(`Operator registry process ID: ${operatorProcessId}`)}

// const signer = new EthereumSigner(ethPrivateKey)
// logger.info(
//   `Using wallet with public key ${signer.publicKey.toString('hex')}`
// )

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
    processId: processId!,
    //signer: await createEthereumDataItemSigner(signer) as any,
    tags: [
      { name: 'Action', value: 'Get-Rewards' },
      { name: 'Address', value: '0x6D454e61876334ee2Ca473E3b4B66777C931886E' },
      { name: 'Fingerprint', value: fingerprint}
    ]
  })
  return result.Messages[0].Data
}


async function getForAddress(address: string) {
  const { result } = await sendAosDryRun({
    processId: processId!,
    //signer: await createEthereumDataItemSigner(signer) as any,
    tags: [
      { name: 'Action', value: 'Get-Rewards' },
      { name: 'Address', value: address }
    ]
  })
  return result.Messages[0].Data
}

async function doFlow() {
  // const oldState = await fetchOldState()

  const fingerprints = Object.keys(oldState.Messages[0].Data.VerifiedFingerprintsToOperatorAddresses)
  const addresses = [ ... new Set(Object.values(oldState.Messages[0].Data.VerifiedFingerprintsToOperatorAddresses))]
  
  logger.info(`Processing fingerprints ${fingerprints.length} addresses: ${addresses.length}`)

  console.log(`{ "PreviousRound": { "Period": 3600, "Timestamp": 1741948079386},`)
  console.log(`  "Configuration": { "TokensPerSecond": "40509259200000000", "Multipliers": {"Family": {"Enabled": true,"Offset": 0.02,"Power": 0.7}, "Location": {"Offset": 0.001,"Enabled": true,"Divider": 20,"Power": 1.85}}, "Modifiers": {"ExitBonus": {"Share": 0.1,"Enabled": true},"Hardware": {"Enabled": true,"Share": 0.2,"UptimeInfluence": 0.35}, "Uptime": {"Enabled": true,"Share": 0.14,"Tiers": {"0": 0,"3": 1,"14": 3}}, "Network": {"Share": 0.56}}},`)
  console.log(`  "TotalFingerprintReward": {`)
  for(var i = 0; i < fingerprints.length; i++) {
    const rewardForFingerprint = await getForFingerprint(fingerprints[i])
    if (rewardForFingerprint) {
      console.log(`    "${fingerprints[i]}": "${rewardForFingerprint}",`)
    }
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  console.log(`  },`)

  console.log(`  "TotalAddressReward": {`)
  for(var i = 0; i < addresses.length; i++) {
    const rewardForAddress = await getForAddress(addresses[i])
    if (rewardForAddress) {
      console.log(`    "${addresses[i]}": "${rewardForAddress}",`)
    }
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  console.log(`  }`)
  console.log(`}`)
}

doFlow().catch(e => { logger.error(e); process.exit(1); })
