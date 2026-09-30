import AoLoader from '@permaweb/ao-loader'
import { expect } from 'chai'
import fs from 'fs'

const contractName = 'ping-pong'
const ENV = {
  Process: {
    Id: "2",
    Tags: [
      { name: "Authority", value: "XXXXXX" },
    ],
  },
}

describe('Ping Pong', () => {
  let handle: Awaited<ReturnType<typeof AoLoader>>

  beforeEach(async () => {
    const wasm = fs.readFileSync(`./dist/${contractName}/process.wasm`)
    handle = await AoLoader(wasm, {
      format: 'wasm64-unknown-emscripten-draft_2024_02_15',
      memoryLimit: '524288000', // in bytes
      computeLimit: 9e12,
      extensions: []
    })
  })

  it('should reply pong to ping', async () => {
    let memory: ArrayBuffer | null = null

    const result = await handle(memory, {
      Owner: 'OWNER_ADDRESS',
      Target: 'XXXXX',
      From: 'YYYYYY',
      Tags: [{ name: 'Action', value: 'Ping' }],
      Data: 'ping'
    }, ENV)

    expect(result.Output).to.equal('sent pong reply')
    expect(result.Messages).to.have.lengthOf(1)
    expect(result.Messages[0].Data).to.equal('pong')
  })
})
