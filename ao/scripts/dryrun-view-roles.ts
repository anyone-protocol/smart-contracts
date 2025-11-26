import 'dotenv/config'
import { sendAosDryRun } from './send-aos-message'

const processId = process.env.PROCESS_ID || ''

if (!processId) {
  throw new Error('PROCESS_ID is not set!')
}

async function dryrunViewState() {
  const result = await sendAosDryRun({
    processId,
    tags: [ { name: 'Action', value: 'View-Roles' } ]
  })
  if (result.result.Messages[0]) {
    console.log(result.result.Messages[0].Data)
  } else {
    console.error('Result error:', JSON.stringify(result.result, null, 2))
  }
}

dryrunViewState().catch(e => {
  console.error(e)
  process.exit(1)
})
