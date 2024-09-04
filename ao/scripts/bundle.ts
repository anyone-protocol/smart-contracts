import path from 'path'
import fs from 'fs'

import { bundle } from './lua-bundler'

async function main() {
  console.log('Bundling Lua...')
  const luaEntryPath = path.join(
    path.resolve(),
    './src/contracts/relay-registry/relay-registry.lua'
  )

  if (!fs.existsSync(luaEntryPath)) {
    throw new Error(`Lua entry path not found: ${luaEntryPath}`)
  }

  const bundledLua = bundle(luaEntryPath)

  if (!fs.existsSync(path.join(path.resolve(), './dist'))) {
    fs.mkdirSync(path.join(path.resolve(), './dist'))
  }

  fs.writeFileSync(path.join(path.resolve(), './dist/bundled.lua'), bundledLua)
  console.log('Done Bundling Lua!')
}

main()
  .then()
  .catch(err => console.error(err))
