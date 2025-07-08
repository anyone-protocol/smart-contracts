import dotenv from 'dotenv'
import { connect, createSigner } from '@permaweb/aoconnect'
import { readFileSync } from 'fs'

import { logger } from './util/logger'

dotenv.config()

const HYPERBEAM_NODE = process.env.HYPERBEAM_NODE
const wallet = JSON.parse(readFileSync('keys/wallet.json', 'utf8'))
const wasmPath = '/~wasm-64@1.0/init/compute/results?function=fac&parameters=3.0'
const metaInfoPath = `/~meta@1.0/info`
const signer = createSigner(wallet)
const { request } = connect({
  MODE: 'mainnet',
  URL: HYPERBEAM_NODE,
  device: '',
  signer
})

export async function postHyperbeamWasm() {
  logger.info(`Posting hyperbeam wasm test to ${HYPERBEAM_NODE}${metaInfoPath}`)

  // const data = {
  //   hello: 'world',
  //   testValue: 'example data'
  // }
  // const response = await request({
  //   path: metaInfoPath,
  //   method: 'POST',
  //   ...data
  // })

  // curl -X POST http://host:port/Init/Compute -H "Device: WASM-64/1.0" \
  //   -H "2.WASM-Function: fac" -H "2.WASM-Params: [10]" -d @test/test-64.wasm

  // hb_message:commit(
  //   #{
  //       <<"path">> =>
  //           <<"/~wasm-64@1.0/init/compute/results?function=fac">>,
  //       <<"body">> => WASMFile,
  //       <<"parameters+list">> => <<"3.0">>
  //   },
  //   ClientWallet
  // )

  const res = await fetch(wasmPath, {
    method: 'POST',
    body: readFileSync('test/util/test-64.wasm')
  })

  const response = await request({
    path: wasmPath,
    method: 'POST',
    body: readFileSync('test/util/test-64.wasm')
  })
  
  logger.info(`Response: ${response.status} ${response.statusText}`)
  console.log(response)  
  // if (response.body) {
  //   const text = await response.text()
  //   logger.info(
  //     `Response body: ${text}`
  //   )
  // }
}

postHyperbeamWasm().then().catch(err => logger.error(err.stack))
