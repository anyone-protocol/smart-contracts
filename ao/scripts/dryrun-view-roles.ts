import 'dotenv/config'
import { sendAosDryRun } from './send-aos-message'

const processId = process.env.PROCESS_ID || ''
if (!processId) {
  throw new Error('PROCESS_ID is not set!')
}

const convertToMigratableState = process.argv.includes('--convert')

async function dryrunViewState() {
  const result = await sendAosDryRun({
    processId,
    tags: [ { name: 'Action', value: 'View-Roles' } ]
  })
  if (result.result?.Messages && result.result.Messages[0]) {
    if (convertToMigratableState) {
      const parsedAcl = JSON.parse(result.result.Messages[0].Data)
      const migratedAcl: any = { Grant: {} }
      for (const role in parsedAcl.Roles) {
        for (const address in parsedAcl.Roles[role]) {
          migratedAcl.Grant[address] = migratedAcl.Grant[address] || []
          migratedAcl.Grant[address].push(role)
        }
      }
      console.log(JSON.stringify(migratedAcl))
    } else {
      console.log(result.result.Messages[0].Data)
    }
  } else {
    console.error('Result error:', JSON.stringify(result.result, null, 2))
  }
}

dryrunViewState().catch(e => {
  console.error(e)
  process.exit(1)
})
