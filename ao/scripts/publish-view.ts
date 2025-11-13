import 'dotenv/config'
import { createReadStream, statSync } from 'fs'
import { EthereumSigner, TurboFactory, TurboSigner } from '@ardrive/turbo-sdk'
import { logger as utilLogger } from './util/logger'

let logger = console
if (process.env.USE_CONSOLE_LOGGER !== 'true') {
  logger.info('Using json logger from util/logger.ts')
  logger = utilLogger as any
}

const VIEW_VERSION = process.env.VIEW_VERSION || 'dev'
const VIEW_NAME = process.env.VIEW_NAME || ''
if (!VIEW_NAME) {
  throw new Error('VIEW_NAME is not set!')
}
const privateKey = process.env.DEPLOYER_PRIVATE_KEY || ''
if (!privateKey) {
  throw new Error('DEPLOYER_PRIVATE_KEY is not set!')
}
const signer = new EthereumSigner(privateKey)

export async function publish(
  viewName: string,
  viewVersion: string,
  signer: TurboSigner
) {
  logger.info(`Publishing LUA View Source for [${viewName}]`)
  logger.info(`Using view version: ${viewVersion}`)
  const luaPath = `./src/views/${viewName}.lua`
  const luaSize = statSync(luaPath).size
  const turbo = TurboFactory.authenticated({ signer })
  const uploadResult = await turbo.uploadFile({
    fileStreamFactory: () => createReadStream(luaPath),
    fileSizeFactory: () => luaSize,
    dataItemOpts: {
      tags: [
        { name: 'Content-Type', value: 'application/lua' },
        { name: 'App-Name', value: 'ANYONE' },
        { name: 'View-Name', value: viewName },
        { name: 'Version', value: viewVersion },
        { name: 'Data-Protocol', value: 'ao' }
      ]
    }
  })

  logger.info(
    `Published ${viewName} source result: ${JSON.stringify(uploadResult)}`
  )
  logger.info(`Check it out at https://arweave.net/${uploadResult.id}`)
}

publish(VIEW_NAME, VIEW_VERSION, signer).then(() => {
  logger.info('Publish view script executed successfully!')
}).catch(error => {
  logger.error(
    `Error executing publish view script: ${error.message}`,
    error.stack
  )
  process.exit(1)
})
