import fs from 'fs'
import path from 'path'
import AoLoader from '@permaweb/ao-loader'

export const MODULE_NAME = 'Encrypted-Messages'
export const OWNER_ADDRESS = '0x'.padEnd(42, '1')
export const ALICE_ADDRESS = '0x'.padEnd(42, 'a')
export const ALICE_PUBKEY = ''.padEnd(64, 'a')
export const BOB_ADDRESS = '0x'.padEnd(42, 'b')
export const BOB_PUBKEY = ''.padEnd(64, 'b')
export const PROCESS_ID = ''.padEnd(43, '2')
export const MODULE_ID = ''.padEnd(43, '3')
export const DEFAULT_MODULE_ID = ''.padEnd(43, '4')
export const DEFAULT_TARGET = ''.padEnd(43, '5')
export const DEFAULT_MESSAGE_ID = ''.padEnd(43, 'f')
export const FINGERPRINT_A = ''.padEnd(40, 'A')
export const FINGERPRINT_B = ''.padEnd(40, 'B')
export const FINGERPRINT_C = ''.padEnd(40, 'C')
export const FINGERPRINT_D = ''.padEnd(40, 'D')
export const FINGERPRINT_E = ''.padEnd(40, 'E')
export const FINGERPRINT_F = ''.padEnd(40, 'F')

export const EXAMPLE_MASTER_ID_PUBLIC_KEY = fs.readFileSync(
  path.join(
    path.resolve(),
    './test/util/test-keys/ed25519_master_id_public_key'
  )
)

export const EXAMPLE_MASTER_ID_SECRET_KEY = fs.readFileSync(
  path.join(
    path.resolve(),
    './test/util/test-keys/ed25519_master_id_secret_key'
  )
)

export const EXAMPLE_SIGNING_CERT = fs.readFileSync(
  path.join(path.resolve(), './test/util/test-keys/ed25519_signing_cert')
)

export const EXAMPLE_SIGNING_SECRET_KEY = fs.readFileSync(
  path.join(path.resolve(), './test/util/test-keys/ed25519_signing_secret_key')
)

// const pubkey = crypto.createPublicKey({
//   key: `
// -----BEGIN RSA PRIVATE KEY-----
// MIICXAIBAAKBgQDcvhABzy0a1mKCXKUdl415T2h0VEFOqx6rpWuiwQll+i3wS9hB
// U3x/X+61j1g3uMtYGKltT51HkldNDuzxIznsKXEWpHJQE9HYW+t9GjUaYUhYqi5k
// K4fHcvA5ixDoGd1NWfOxBTiWIkf6o2Ib2O30ieVkgney2gS8Gm59WGBI6wIDAQAB
// AoGBAIf89vOGZG0iIbHZzUa7tMZFKz5vIYSLWuu3juXHMjkGtQJSVzl3az01JmPn
// mRtK1srA9q+G2ofbGbk5NrMfVnCHQ43HAQ/DObTl5Nc3NOzRI/IKpdZ+2ceKBqNt
// XM7Nj4U1zQypNpRL+hhiql6NV7SrROnUqFZpGtkyyFGUPBQxAkEA/t///UpF5+Wu
// cZhIEkdfHOs+l4ir5GF+HUC8DzOn9sPXjWe4Dp3h3jxoiCJS7xLepz1ze+P1y8BA
// 09Gh1vLC7QJBAN23fnJotczaa+/4TLT3QU8wVDNkPQXTZe68jjXsuIhB1TsnDP+P
// 7ZUTuPud7IzV/MualLukN7OMnJEhwauFCDcCQCiU/AqVf+n7nToDGD6o1JEjN9Ui
// 8tOrXkxEGW2GORFGf5TJVfol02fyUGaUqIXeiEsysqegVWu60deoQk+aWcUCQDfN
// yl6jajagNxCUD0JxBRgYUukIbq97sKkw/h4mcZ+h6jhUMNpV8HdYGnQCIJql9VWN
// l6fOwlJHrtR8iZFRD2sCQBFAozWaIpfn4X8//IgsT+MKWQtO/48rXSYHU41V7ZY9
// NWtVGaZI2AWpyjRgHhBTMSLyme5rtFtETkfKHyKok7k=
// -----END RSA PRIVATE KEY-----
// `
// })

export const AO_ENV = {
  Process: {
    Id: PROCESS_ID,
    Owner: OWNER_ADDRESS,
    Tags: [
      // { name: 'Authority', value: 'XXXXXX' }
    ],
  },
  Module: {
    Id: MODULE_ID,
    Owner: OWNER_ADDRESS,
    Tags: [
      { name: 'Authority', value: 'YYYYYY' }
    ],
  }
}

const AOS_WASM = fs.readFileSync(
  path.join(
    path.resolve(),
    './test/util/aos-cbn0KKrBZH7hdNkNokuXLtGryrWM--PjSTBqIzw9Kkk.wasm'
  )
)

export const DEFAULT_HANDLE_OPTIONS = {
  Id: DEFAULT_MESSAGE_ID,
  ['Block-Height']: '1',
  // NB: Important to set the address so that that `Authority` check passes.
  //     Else the `isTrusted` with throw an error.
  Owner: OWNER_ADDRESS,
  Module: MODULE_NAME,
  Target: DEFAULT_TARGET,
  Timestamp: Date.now().toString(),
  Tags: [],
  Cron: false,
  From: ''
}

const BUNDLED_SOURCE = fs.readFileSync(
  path.join(path.resolve(), './dist/bundled.lua'),
  'utf-8',
)

export type FullAOHandleFunction = (
  buffer: ArrayBuffer | null,
  msg: AoLoader.Message,
  env: AoLoader.Environment
) => Promise<AoLoader.HandleResponse & { Error?: string }>

export type AOTestHandle = (
  options?: Partial<AoLoader.Message>,
  mem?: ArrayBuffer | null
) => Promise<AoLoader.HandleResponse & { Error?: string }>

export async function createLoader() {
  const originalHandle = await AoLoader(AOS_WASM, {
    format: 'wasm64-unknown-emscripten-draft_2024_02_15',
    memoryLimit: '524288000', // in bytes
    computeLimit: 9e12,
    extensions: []
  })

  const programs = [
    {
      action: 'Eval',
      args: [{ name: 'Module', value: DEFAULT_MODULE_ID }],
      Data: BUNDLED_SOURCE
    }
  ]
  let memory: ArrayBuffer | null = null
  for (const { action, args, Data } of programs) {
    await originalHandle(
      memory,
      {
        ...DEFAULT_HANDLE_OPTIONS,
        Tags: [
          ...args,
          { name: 'Action', value: action }
        ],
        Data,
        From: OWNER_ADDRESS
      },
      AO_ENV
    )
  }

  async function handle(
    options: Partial<AoLoader.Message> = {},
    mem = memory
  ) {
    return originalHandle(
      mem,
      {
        ...DEFAULT_HANDLE_OPTIONS,
        ...options,
      },
      AO_ENV
    )
  }

  return {
    handle,
    originalHandle,
    memory: memory as unknown as ArrayBuffer
  }
}
