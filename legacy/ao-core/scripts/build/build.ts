import path from 'path'
import fs from 'fs'
import { exec, execSync } from 'child_process'

import { logger } from '../util/logger'

const BUILD_COMMAND_AO = 'ao build'
// NB: ao-build-module requires code be in /src
const BUILD_COMMAND_AO_MODULE = 'rm -rf /src && cp -R . /src && ao-build-module'

const CONTRACT_NAMES = process.env.CONTRACT_NAMES
  ? process.env.CONTRACT_NAMES.split(',')
  : fs.readdirSync(path.join(path.resolve(), './dist'))

async function getBuildCommand() {
  return new Promise<string>((resolve, reject) => {
    // NB: Try to detect `ao-build-module` (from within ao dev container)
    //     Otherwise, fall back to `ao build`, which runs an ao dev container
    exec(
      'which ao-build-module',
      err => resolve(err ? BUILD_COMMAND_AO : BUILD_COMMAND_AO_MODULE)
    )
  })
}

export async function build(contractNames: string[] = []) {
  logger.info(
    `Building ${contractNames.length} contracts: ${contractNames.join(',')}`
  )

  const buildCommand = await getBuildCommand()
  logger.info(`Using build command: ${buildCommand}`)

  for (const contractName of contractNames) {
    logger.info(`Building WASM for ${contractName}...`)
    execSync(`cd ./dist/${contractName} && ${buildCommand}`)
    logger.info(`Done Building WASM for ${contractName}`)
  }
}

build(CONTRACT_NAMES).then().catch(err => logger.error(err.stack))
