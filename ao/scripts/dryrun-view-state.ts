import 'dotenv/config'
import { sendAosDryRun } from './send-aos-message'

const processId = process.env.PROCESS_ID || ''

if (!processId) {
  throw new Error('PROCESS_ID is not set!')
}

async function dryrunViewState() {
  const result = await sendAosDryRun({
    processId,
    tags: [ { name: 'Action', value: 'View-State' } ]
  })
  console.log(result.result.Messages[0].Data)
}

dryrunViewState().catch(e => {
  console.error(e)
  process.exit(1)
})
