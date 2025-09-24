import { writeFileSync } from 'fs'
import { logger } from '../util/logger'
import { sendAosDryRun } from '../send-aos-message'
const processId = process.env.PROCESS_ID || ''
const phase = process.env.PHASE || 'dev'
const patchName = process.env.PATCH_NAME ||
  `operator-registry-patch-${phase}-${new Date().toISOString().split('T')[0]}`

if (!processId) {
  throw new Error('PROCESS_ID is not set!')
}

async function getStatePatch() {
  logger.debug(`Generating patch [${patchName}] from process id [${processId}]`)

  const { result } = await sendAosDryRun({
    processId,
    tags: [{ name: 'Action', value: 'View-State' }]
  })

  const state = JSON.parse(result.Messages[0].Data)

  let output = 'if not OperatorRegistry.PatchesApplied then OperatorRegistry.PatchesApplied = {} end\n'
  output += `local currentPatchName = '${patchName}'\n`
  output += 'if not OperatorRegistry.PatchesApplied[currentPatchName] then\n'

  const stateProps = [
    'ClaimableFingerprintsToOperatorAddresses',
    'VerifiedFingerprintsToOperatorAddresses',
    'BlockedOperatorAddresses',
    'VerifiedHardwareFingerprints',
    'RegistrationCreditsFingerprintsToOperatorAddresses'
  ]
  for (const stateProp of stateProps) {
    output += `OperatorRegistry.${stateProp} = {\n`
    let i = 0
    for (const fingerprint in state[stateProp]) {
      const addr = state[stateProp][fingerprint]
      output += `  ["${fingerprint}"] = ${typeof addr === 'boolean' ? addr : `"${addr}"`},\n`
      i++
      // if (i >= 10) break // NB: limit output for testing the generated lua code is valid
    }
    output += `}\n`
  }

  output += 'OperatorRegistry.RegistrationCreditsRequired = false\n'
  output += 'OperatorRegistry._initialized = true\n'

  output += 'OperatorRegistry.PatchesApplied[currentPatchName] = true\n'
  output += 'end\n'

  const filename = `src/patches/${patchName}.lua`
  writeFileSync(filename, output)
  console.log(`Patch written to [${filename}]`)
}

getStatePatch().catch(e => { logger.error(e); process.exit(1) })