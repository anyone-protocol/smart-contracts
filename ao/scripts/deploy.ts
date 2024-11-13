import dotenv from 'dotenv'
import Consul from 'consul'
import { createReadStream, readFileSync, statSync } from 'fs'
import { join, resolve } from 'path'
import { EthereumSigner, TurboFactory } from '@ardrive/turbo-sdk'
import { spawn } from '@permaweb/aoconnect'

import {
  createEthereumDataItemSigner,
  sendAosMessage
} from './send-aos-message'
import HardhatKeys from './test-keys/hardhat.json'

dotenv.config()

const contractName = process.env.CONTRACT_NAME || ''
const deployerPrivateKey = process.env.DEPLOYER_PRIVATE_KEY
  || HardhatKeys.owner.key
const schedulerUnitAddress = process.env.SCHEDULER_ADDRESS
  || '_GQ33BkPtZrqxA84vM8Zk-N2aO0toNNu_C-l-rawrBA'
const aosModuleId = process.env.AOS_MODULE_ID
  || 'cbn0KKrBZH7hdNkNokuXLtGryrWM--PjSTBqIzw9Kkk'
const consulToken = process.env.CONSUL_TOKEN || 'no-token'

if (!contractName) {
  throw new Error('CONTRACT_NAME is not set!')
}

if (!deployerPrivateKey) {
  throw new Error('DEPLOYER_PRIVATE_KEY is not set!')
}

const signer = new EthereumSigner(deployerPrivateKey)
console.log(
  `Signing using wallet with public key ${signer.publicKey.toString('hex')}`
)
const turbo = TurboFactory.authenticated({ signer })

async function deploy() {
  console.log(`Deploying AO contract: ${contractName}`)

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
        { name: 'Contract-Name', value: contractName }
      ]
    }
  })

  console.log(`Publish ${contractName} source result:`, uploadResult)

  const ethereumDataItemSigner = await createEthereumDataItemSigner(signer)

  console.log(`Spawning new AO Process for ${contractName}...`)
  const processId = await spawn({
    module: aosModuleId,
    scheduler: schedulerUnitAddress,
    signer: ethereumDataItemSigner as any,
    tags: [
      { name: 'App-Name', value: 'ANYONE' },
      { name: 'Contract-Name', value: contractName }
    ]
  })

  console.log(`Sending EVAL of ${contractName} to AO Process ${processId}`)
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

  console.log(`Process Published and Evaluated at: ${processId}`)

  if (process.env.PHASE && process.env.CONSUL_IP) {
    console.log(
      `Connecting to Consul at` +
        ` ${process.env.CONSUL_IP}:${process.env.CONSUL_PORT}...`
    )
    const consul = new Consul({
      host: process.env.CONSUL_IP,
      port: process.env.CONSUL_PORT,
    })
    const sourceKey = process.env.CONTRACT_SOURCE_CONSUL_KEY || 'dummy-path'
    const consulKey = process.env.CONTRACT_CONSUL_KEY || 'dummy-path'
    console.log(`Using consul keys ${consulKey} / ${sourceKey}`)

    const contractResult = await consul.kv.set({
      key: consulKey,
      value: processId,
      token: consulToken
    })
    console.log(`Contract address updated: ${contractResult}`)

    const sourceResult = await consul.kv.set({
      key: sourceKey,
      value: uploadResult.id,
      token: consulToken
    })
    console.log(`Contract source updated: ${sourceResult}`)
  } else {
    console.warn(
      'Deployment env var PHASE not defined,' +
        ' skipping update of cluster variable in Consul.'
    )
  }
}

deploy().catch(e => { console.error(e); process.exit(1); })
