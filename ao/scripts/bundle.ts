import path from 'path'
import fs from 'fs'

import { logger } from './util/logger'
import { bundle } from './lua-bundler'

async function main() {
  const contractNames = [ 'operator-registry', 'relay-rewards', 'acl-test' ]

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

    const bundledLua = bundle(luaEntryPath)
    if (!fs.existsSync(path.join(path.resolve(), `./dist`))) {
      fs.mkdirSync(
        path.join(path.resolve(), `./dist`),
        { recursive: true }
      )
    }
    fs.writeFileSync(
      path.join(path.resolve(), `./dist/${contractName}.lua`),
      bundledLua
    )

    logger.info(`Done Bundling Lua for ${contractName}!`)
  }
}

main()
  .then()
  .catch(err => logger.error(err))
