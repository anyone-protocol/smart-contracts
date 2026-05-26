import 'dotenv/config'
import {
  connect as aoConnect
  // @ts-ignore
} from '@permaweb/aoconnect/node'
import { EthereumSigner } from '@dha-team/arbundles'
import { createEthereumDataItemSigner, resolveAuthority } from './util/helpers'
import HardhatKeys from './test-keys/hardhat.json'

const DEPLOYER_PRIVATE_KEY = process.env.DEPLOYER_PRIVATE_KEY || HardhatKeys.owner.key
const HB_URL = process.env.HB_URL || 'https://push.forward.computer'
// const GATEWAY_URL = process.env.GATEWAY_URL || 'https://arweave.net'
const SCHEDULER = process.env.SCHEDULER //|| 'n_XZJhUnmldNFo4dhajoPZWhBXuJk-OcQr5JQ49c4Zo'
const module = process.env.MODULE || 'ISShJH1ij-hPPt9St5UFFr_8Ys3Kj5cyg7zrMGt7H9s'//'wal-fUK-YnB9Kp5mN8dgMsSqPSqiGx-0SvwFUSwpDBI'
const PROCESS_NAME = process.env.PROCESS_NAME || 'default'

if (!DEPLOYER_PRIVATE_KEY) { throw new Error('DEPLOYER_PRIVATE_KEY is required') }

async function spawn() {
  const signer = new EthereumSigner(DEPLOYER_PRIVATE_KEY)
  const ethereumDataItemSigner = await createEthereumDataItemSigner(signer)
  const ao = aoConnect({
    MODE: 'mainnet',
    signer: ethereumDataItemSigner,
    // GATEWAY_URL,
    URL: HB_URL,
    SCHEDULER
  })
  
  console.log(`Resolving authority for [${HB_URL}]...`)
  const authority = await resolveAuthority(HB_URL)
  const scheduler = SCHEDULER || authority
  console.log(`Hyperbeam Node: ${HB_URL}`)
  console.log(`Module:         ${module}`)
  console.log(`Scheduler:      ${scheduler}`)
  console.log(`Authority:      ${authority}`)
  console.log(`Process Name:   ${PROCESS_NAME}`)

  console.log('Spawning process...')
  const processId = await ao.spawn({
    tags: [
      { name: 'App-Name', value: 'Anyone-Protocol' },
      { name: 'Name', value: PROCESS_NAME },
      { name: 'Authority', value: authority }
    ],
    signer: ethereumDataItemSigner,
    authority,
    scheduler,
    module,
    data: 'Anyone Protocol'
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
