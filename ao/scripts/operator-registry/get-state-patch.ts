// import { logger } from './util/logger'
import { sendAosDryRun } from '../send-aos-message';
const logger = console
const processId = process.argv[2]

const action = process.argv[3] || 'View-State'

if (!processId) {
  throw new Error('pass processId as first argument to script!')
}

async function readProcess() {
  // logger.debug(`Calling dry-run ${action} on process ${processId}`)

  const { result } = await sendAosDryRun({
    processId,
    tags: [{ name: 'Action', value: action }]
  })

  const state = JSON.parse(result.Messages[0].Data)
  const stateProps = [
    'ClaimableFingerprintsToOperatorAddresses',
    'VerifiedFingerprintsToOperatorAddresses',
    'BlockedOperatorAddresses',
    'VerifiedHardwareFingerprints',
    'RegistrationCreditsFingerprintsToOperatorAddresses'
  ]

  for (const stateProp of stateProps) {
    console.log(`OperatorRegistry.${stateProp} = {`)
    let i = 0
    for (const fingerprint in state[stateProp]) {
      const addr = state[stateProp][fingerprint]
      console.log(`  ["${fingerprint}"] = "${addr}",`)
      i++
      // if (i >= 10) break // NB: limit output for testing the generated lua code is valid
    }
    console.log(`}`)
  }

  console.log('OperatorRegistry.RegistrationCreditsRequired = false')
  console.log('OperatorRegistry._initialized = true')
}

readProcess().catch(e => { logger.error(e); process.exit(1); })
