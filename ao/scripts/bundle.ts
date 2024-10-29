import path from 'path'
import fs from 'fs'

import { bundle } from './lua-bundler'

async function main() {
  const contractNames = [ 'operator-registry', 'relay-directory', 'relay-rewards' ]

  console.log(
    `Bundling ${contractNames.length} contracts: ${contractNames.join(',')}`
  )

  for (const contractName of contractNames) {
    console.log(`Bundling Lua for ${contractName}...`)

    const luaEntryPath = path.join(
      path.resolve(),
      `./src/contracts/${contractName}.lua`
    )
    if (!fs.existsSync(luaEntryPath)) {
      throw new Error(`Lua entry path not found: ${luaEntryPath}`)
    }

    const bundledLua = bundle(luaEntryPath)
    if (!fs.existsSync(path.join(path.resolve(), './dist'))) {
      fs.mkdirSync(path.join(path.resolve(), './dist'))
    }  
    fs.writeFileSync(
      path.join(path.resolve(), `./dist/${contractName}.lua`),
      bundledLua
    )

    console.log(`Done Bundling Lua for ${contractName}!`)
  }
}

main()
  .then()
  .catch(err => console.error(err))
