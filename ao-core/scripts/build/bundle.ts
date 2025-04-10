import path from 'path'
import fs from 'fs'

import { logger } from '../util/logger'
import { bundleLua } from '../util/bundle-lua'

const CONTRACT_NAMES = process.env.CONTRACT_NAMES
  ? process.env.CONTRACT_NAMES.split(',')
  : ['ping-pong', 'relay-auth']

export async function bundle(contractNames: string[] = []) {
  logger.info(
    `Bundling ${contractNames.length} contracts: ${contractNames.join(',')}`
  )

  for (const contractName of contractNames) {
    logger.info(`Bundling Lua for ${contractName}...`)

    const luaEntryPath = path.join(
      path.resolve(),
      `./src/contracts/${contractName}.lua`
    )
    if (!fs.existsSync(luaEntryPath)) {
      throw new Error(`Lua entry path not found: ${luaEntryPath}`)
    }

    const bundledLua = bundleLua(luaEntryPath)
    fs.mkdirSync(
      path.join(path.resolve(), `./dist/${contractName}`),
      { recursive: true }
    )
    fs.writeFileSync(
      path.join(path.resolve(), `./dist/${contractName}/process.lua`),
      bundledLua
    )

    logger.info(`Done Bundling Lua for ${contractName}`)
  }
}

bundle(CONTRACT_NAMES).then().catch(err => logger.error(err.stack))
