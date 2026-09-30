import dotenv from 'dotenv'
import { createData, ArweaveSigner, EthereumSigner } from '@dha-team/arbundles'
import { readFileSync } from 'fs'

import { AoModuleTags } from '../util/defaults'
import { logger } from '../util/logger'
import { randomBytes } from 'crypto'
import axios from 'axios'

dotenv.config()

const CONTRACT_NAME = process.env.CONTRACT_NAME || ''
const DEPLOYER_PRIVATE_KEY = process.env.DEPLOYER_PRIVATE_KEY || ''
const DEPLOYER_KEY_NETWORK = process.env.DEPLOYER_KEY_NETWORK || 'ethereum'
const BUNDLER = process.env.BUNDLER || 'https://ar.anyone.tech/bundler'

const signer = DEPLOYER_KEY_NETWORK === 'ethereum'
  ? new EthereumSigner(DEPLOYER_PRIVATE_KEY)
  : new ArweaveSigner(JSON.parse(readFileSync(DEPLOYER_PRIVATE_KEY, 'utf8')))

export async function deploy(
  contractName: string,
  signer: ArweaveSigner | EthereumSigner,
  bundlerUrl: string = BUNDLER
) {
  logger.info(`Publishing AO module: ${contractName}`)
  logger.info(
    `Signing using wallet with public key ${signer.publicKey.toString('hex')}`
  )

  const dataItem = createData(
    readFileSync(`./dist/${contractName}/process.wasm`),
    signer,
    {
      anchor: randomBytes(32).toString('base64').slice(0, 32),
      tags: [
        ...AoModuleTags,
        { name: 'Author', value: 'Anyone Protocol' },
        { name: 'Module-Name', value: contractName }
      ]
    }
  )
  await dataItem.sign(signer)

  try {
    const result = await axios.post(`${bundlerUrl}/tx`, dataItem.getRaw(), {
      headers: {
        'Content-Type': 'application/octet-stream',
        Accept: 'application/json'
      }
    })

    logger.info(
      `Publish ${contractName} source result:` +
      `${result.status} ${JSON.stringify(result.data)}`
    )
  } catch (error) {
    console.error(`Error publishing module: ${error}`)
    throw error
  }
}

deploy(
  CONTRACT_NAME,
  signer
).then().catch(err => logger.error(err.stack))
