import dotenv from 'dotenv'
import Consul from 'consul'
import { createReadStream, readFileSync, statSync } from 'fs'
import { join, resolve } from 'path'
import { EthereumSigner, TurboFactory } from '@ardrive/turbo-sdk'
import { spawn } from '@permaweb/aoconnect'

import { logger } from './util/logger'
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
  || 'cbn0KKrBZH7hdNkNokuXLtGryrWM--PjSTBqIzw9Kkk'
const consulToken = process.env.CONSUL_TOKEN || 'no-token'
const callInitHandler = process.env.CALL_INIT_HANDLER === 'true'
const initData = process.env.INIT_DATA
const isMigrationDeployment = process.env.IS_MIGRATION_DEPLOYMENT === 'true'
const migrationSourceProcessId = process.env.MIGRATION_SOURCE_PROCESS_ID

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

const signer = new EthereumSigner(deployerPrivateKey)
logger.info(
  `Signing using wallet with public key ${signer.publicKey.toString('hex')}`
)
const turbo = TurboFactory.authenticated({ signer })

async function deploy() {
  logger.info(`Deploying AO contract: ${contractName}`)

  const bundledLuaPath = `./dist/${contractName}.lua`
  const bundledLuaSize = statSync(bundledLuaPath).size
  const uploadResult = await turbo.uploadFile({
    fileStreamFactory: () => createReadStream(bundledLuaPath),
    fileSizeFactory: () => bundledLuaSize,
    dataItemOpts: {
      tags: [
        { name: 'App-Name', value: 'aos-LUA' },
        { name: 'App-Version', value: '0.0.1' },
        { name: 'Content-Type', value: 'text/x-lua' },
        { name: 'Author', value: 'Anyone Protocol' },
        { name: 'Contract-Name', value: contractName },
        { name: 'Deploy-Nonce', value: new Date().getTime().toString() }
      ]
    }
  })

  logger.info(
    `Publish ${contractName} source result: ${JSON.stringify(uploadResult)}`
  )

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
      { name: 'Timestamp', value: Date.now().toString() },
      {
        name: 'Source-Code-TX-ID',
        value: uploadResult.id
      }
    ]
  })

  logger.info(`Sending EVAL of ${contractName} to AO Process ${processId}`)
  await sendAosMessage({
    processId,
    data: readFileSync(join(resolve(), `./dist/${contractName}.lua`), 'utf8'),
    signer: ethereumDataItemSigner as any,
    tags: [
      { name: 'Action', value: 'Eval' },
      { name: 'App-Name', value: 'ANYONE' },
      {
        name: 'Source-Code-TX-ID',
        value: uploadResult.id
      }
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
    logger.info('Sleeping 10s to allow EVAL action to settle')
    await new Promise(resolve => setTimeout(resolve, 10_000))
  }

  if (callInitHandler) {
    logger.info('Initializing with INIT action')
    
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
    const sourceKey = process.env.CONTRACT_SOURCE_CONSUL_KEY || 'dummy-path'
    const consulKey = process.env.CONTRACT_CONSUL_KEY || 'dummy-path'
    logger.info(`Using consul keys ${consulKey} / ${sourceKey}`)

    const contractResult = await consul.kv.set({
      key: consulKey,
      value: processId,
      token: consulToken
    })
    logger.info(`Contract address updated: ${contractResult}`)

    const sourceResult = await consul.kv.set({
      key: sourceKey,
      value: uploadResult.id,
      token: consulToken
    })
    logger.info(`Contract source updated: ${sourceResult}`)
  } else {
    console.warn(
      'Deployment env var PHASE not defined,' +
        ' skipping update of cluster variable in Consul.'
    )
  }
}

deploy().catch(e => { logger.error(e); process.exit(1); })
