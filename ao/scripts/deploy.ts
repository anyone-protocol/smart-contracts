import dotenv from 'dotenv'
import Consul from 'consul'
import { readFileSync } from 'fs'
import { join, resolve } from 'path'
import { EthereumSigner } from '@ardrive/turbo-sdk'
import { spawn } from '@permaweb/aoconnect'

import { logger as utilLogger } from './util/logger'
import {
  createEthereumDataItemSigner,
  sendAosDryRun,
  sendAosMessage  
} from './send-aos-message'
import HardhatKeys from './test-keys/hardhat.json'

dotenv.config()

const contractName = process.env.CONTRACT_NAME || ''
const deployerPrivateKey = process.env.DEPLOYER_PRIVATE_KEY
  || HardhatKeys.owner.key
const schedulerUnitAddress = process.env.SCHEDULER_UNIT_ADDRESS
  || '_GQ33BkPtZrqxA84vM8Zk-N2aO0toNNu_C-l-rawrBA'
const messagingUnitAddress = process.env.MESSAGING_UNIT_ADDRESS
  || 'fcoN_xJeisVsPXA-trzVAuIiqO3ydLQxM-L4XbrQKzY'
const aosModuleId = process.env.AOS_MODULE_ID
  // || 'cbn0KKrBZH7hdNkNokuXLtGryrWM--PjSTBqIzw9Kkk' // OLD MODULE!
  || 'ISShJH1ij-hPPt9St5UFFr_8Ys3Kj5cyg7zrMGt7H9s'
const consulToken = process.env.CONSUL_TOKEN || 'no-token'
const callInitHandler = process.env.CALL_INIT_HANDLER === 'true'
const initDataPath = process.env.INIT_DATA_PATH
const isMigrationDeployment = process.env.IS_MIGRATION_DEPLOYMENT === 'true'
const migrationSourceProcessId = process.env.MIGRATION_SOURCE_PROCESS_ID
const initDelayMs = parseInt(process.env.INIT_DELAY_MS || '30000', 10)

let logger = console
if (process.env.USE_CONSOLE_LOGGER !== 'true') {
  logger.info('Using json logger from util/logger.ts')
  logger = utilLogger as any
}

if (!contractName) {
  throw new Error('CONTRACT_NAME is not set!')
}

if (!deployerPrivateKey) {
  throw new Error('DEPLOYER_PRIVATE_KEY is not set!')
}

if (isMigrationDeployment && !migrationSourceProcessId) {
  throw new Error(
    'IS_MIGRATION_DEPLOYMENT is "true"' +
    ' but MIGRATION_SOURCE_PROCESS_ID is not set!'
  )
}

if (callInitHandler && isMigrationDeployment) {
  throw new Error(
    'Both CALL_INIT_HANDLER & IS_MIGRATION_DEPLOYMENT are "true".' +
    '  Only one can be set to true at a time!'
  )
}

async function deploy() {
  const signer = new EthereumSigner(deployerPrivateKey)
  logger.info(
    `Signing using wallet with public key ${signer.publicKey.toString('hex')}`
  )

  logger.info(`Deploying AO contract: ${contractName}`)
  const ethereumDataItemSigner = await createEthereumDataItemSigner(signer)

  logger.info(`Spawning new AO Process for ${contractName}...`)
  const processId = await spawn({
    module: aosModuleId,
    scheduler: schedulerUnitAddress,
    signer: ethereumDataItemSigner as any,
    tags: [
      { name: 'App-Name', value: 'ANYONE' },
      { name: 'Contract-Name', value: contractName },
      { name: 'Authority', value: messagingUnitAddress },
      { name: 'Timestamp', value: Date.now().toString() }
    ],
    data: 'AnyoneProtocol'
  })

  logger.info(`Sending EVAL of ${contractName} to AO Process ${processId}`)
  await sendAosMessage({
    processId,
    data: readFileSync(join(resolve(), `./dist/${contractName}.lua`), 'utf8'),
    signer: ethereumDataItemSigner as any,
    tags: [
      { name: 'Action', value: 'Eval' },
      { name: 'App-Name', value: 'ANYONE' }
    ]
  })

  logger.info(`Process Published and Evaluated at: ${processId}`)

  const callInitAction = async (initData: string) => {
    const { messageId, result } = await sendAosMessage({
      processId,
      data: initData,
      signer: ethereumDataItemSigner as any,
      tags: [{ name: 'Action', value: 'Init' }]
    })

    if (result.Error) {
      logger.error('Init Action resulted in an error', result.Error)
    } else {
      logger.info(`Init Action successful with message id ${messageId}`)
    }
  }

  if (callInitHandler || isMigrationDeployment) {
    logger.info(`Sleeping ${initDelayMs / 1000}s to allow EVAL action to settle`)
    await new Promise(resolve => setTimeout(resolve, initDelayMs))
  }

  if (callInitHandler) {
    logger.info('Initializing with INIT action')
    const initData = readFileSync(initDataPath || 'NO_INIT_DATA_PATH', 'utf8')
    if (!initData) {
      logger.error('INIT_DATA is not present, could not initialize')
    } else {
      await callInitAction(initData)
    }
  } else if (isMigrationDeployment) {
    const { result: migrationReadResult } = await sendAosDryRun({
      processId: migrationSourceProcessId!,
      tags: [{ name: 'Action', value: 'View-State' }]
    })

    const previousState = migrationReadResult.Messages[0].Data

    if (!previousState) {
      logger.error(
        'Error getting previous state from migration source AO process'
      )
    } else {
      await callInitAction(previousState)
    }
  } else {
    logger.info('CALL_INIT_HANDLER is not set to "true", skipping INIT')
  }

  if (process.env.PHASE && process.env.CONSUL_IP) {
    logger.info(
      `Connecting to Consul at` +
        ` ${process.env.CONSUL_IP}:${process.env.CONSUL_PORT}...`
    )
    const consul = new Consul({
      host: process.env.CONSUL_IP,
      port: process.env.CONSUL_PORT
    })
    const consulKey = process.env.CONTRACT_CONSUL_KEY || 'dummy-path'
    logger.info(`Using consul key ${consulKey}`)

    const contractResult = await consul.kv.set({
      key: consulKey,
      value: processId,
      token: consulToken
    })
    logger.info(`Contract address updated: ${contractResult}`)
  } else {
    console.warn(
      'Deployment env var PHASE not defined,' +
        ' skipping update of cluster variable in Consul.'
    )
  }

  logger.info(
    `Deployment of ${contractName} complete!`
      + ` Check the deployed process in your browser at`
      + ` https://ao.link/#/entity/${processId}`
  )
}

deploy().catch(e => { logger.error(e); process.exit(1); })
