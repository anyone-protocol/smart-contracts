import { sendAosDryRun } from './send-aos-message';

const processId = process.argv[2]

const action = process.argv[3] || 'View-State'

if (!processId) {
  throw new Error('pass processId as first argument to script!')
}

async function readProcess() {
  console.log(`Calling dry-run ${action} on process ${processId}`)

  const { result } = await sendAosDryRun({
    processId,
    tags: [{ name: 'Action', value: 'View-State' }]
  })

  console.log(result)
}

readProcess().catch(e => { console.error(e); process.exit(1); })
