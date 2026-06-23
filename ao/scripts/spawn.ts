import 'dotenv/config'
import {
  connect as aoConnect
} from '@permaweb/aoconnect'
import { EthereumSigner } from '@dha-team/arbundles'
import {
  createEthSigner,
  resolveAuthority,
  resolveImportAuthority
} from './util/helpers'
import HardhatKeys from './test-keys/hardhat.json'
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const DEPLOYER_PRIVATE_KEY = process.env.DEPLOYER_PRIVATE_KEY || HardhatKeys.owner.key
const HB_URL = process.env.HB_URL || 'https://push.forward.computer'
// const GATEWAY_URL = process.env.GATEWAY_URL || 'https://arweave.net'
const SCHEDULER = process.env.SCHEDULER //|| 'n_XZJhUnmldNFo4dhajoPZWhBXuJk-OcQr5JQ49c4Zo'
const module = process.env.MODULE || 'ISShJH1ij-hPPt9St5UFFr_8Ys3Kj5cyg7zrMGt7H9s'//'wal-fUK-YnB9Kp5mN8dgMsSqPSqiGx-0SvwFUSwpDBI'
const PROCESS_NAME = process.env.PROCESS_NAME || 'default'

if (!DEPLOYER_PRIVATE_KEY) { throw new Error('DEPLOYER_PRIVATE_KEY is required') }

async function spawn() {
  const ethSigner = new EthereumSigner(DEPLOYER_PRIVATE_KEY)
  const signer = await createEthSigner(ethSigner)
  const ao = aoConnect({
    MODE: 'mainnet',
    signer: signer as any,
    // GATEWAY_URL,
    URL: HB_URL,
    SCHEDULER
  })
  
  console.log(`Resolving scheduler & authority for [${HB_URL}]...`)
  // The scheduler is the node's own operator address; the Authority tag must be
  // one of the node's genesis-wasm import authorities (often a separate address)
  // or the node silently 504s on the eval push.
  const nodeAddress = await resolveAuthority(HB_URL)
  const scheduler = SCHEDULER || nodeAddress
  const authority = await resolveImportAuthority(HB_URL)
  console.log(`Hyperbeam Node: ${HB_URL}`)
  console.log(`Module:         ${module}`)
  console.log(`Scheduler:      ${scheduler}`)
  console.log(`Authority:      ${authority}`)
  console.log(`Process Name:   ${PROCESS_NAME}`)

  console.log('Spawning process...')
  const processId = await ao.spawn({
    tags: [
      { name: 'App-Name', value: 'Anyone-Protocol' },
      { name: 'Name', value: PROCESS_NAME+'_'+Date.now() },
      { name: 'Authority', value: authority }
    ],
    signer: signer,
    authority,
    scheduler,
    module,
    data: 'Anyone Protocol'
  })
  console.log(`Process spawned with ID: ${processId}`)
  console.log('Waiting for process spawn to settle before Eval...')
  await new Promise(resolve => setTimeout(resolve, 5000)) // Wait for process to be registered
  console.info(`Sending EVAL of [${PROCESS_NAME}] bundled source to AO Process [${processId}]`)
  const sourcePath = join(resolve(), `./dist/${PROCESS_NAME}.lua`)
  if (!existsSync(sourcePath)) {
    throw new Error(`Source file not found at path: ${sourcePath}`)
  }
  await ao.message({
    process: processId,
    data: readFileSync(sourcePath, 'utf8'),
    signer: signer as any,
    tags: [{ name: 'Action', value: 'Eval' }]
  })

  console.log(`Process spawned at [${HB_URL}/${processId}]`)
  console.log(`Check process via explorer at [https://lunar.ar.anyone.tech/#/explorer/${processId}]`)
}

spawn()
  .then(() => process.exit(0))
  .catch(e => {
    console.error(e)
    // console.dir(e, { depth: null })
    console.log('context', Object.getOwnPropertyNames(e))
    process.exit(1)
  })
