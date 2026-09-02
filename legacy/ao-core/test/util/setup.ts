import AoLoader from '@permaweb/ao-loader'
import fs from 'fs'

export const OWNER_ADDRESS = '0x'.padEnd(42, '1')
export const ALICE_ADDRESS = '0x'.padEnd(42, 'A')
export const ALICE_PUBKEY = ''.padEnd(64, 'a')
export const BOB_ADDRESS = '0x'.padEnd(42, 'B')
export const BOB_PUBKEY = ''.padEnd(64, 'b')
export const CHARLS_ADDRESS = '0x'.padEnd(42, 'C')
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

// export async function createLoader(contractName: string) {
  

//   await AoLoader(wasm)
// }

// export async function createLoader(
//   contractName: string,
//   contractSource?: string
// ) {
//   const wasm = fs.readFileSync(`./dist/${contractName}/process.wasm`)

//   const originalHandle = await AoLoader(wasm, {
//     format: 'wasm64-unknown-emscripten-draft_2024_02_15',
//     memoryLimit: '524288000', // in bytes
//     computeLimit: 9e12,
//     extensions: []
//   })

//   let memory: ArrayBuffer | null = null

//   async function handle(
//     options: Partial<AoLoader.Message> = {},
//     mem = memory
//   ) {
//     const result = await originalHandle(
//       mem,
//       {
//         ...DEFAULT_HANDLE_OPTIONS,
//         ...options,
//       },
//       AO_ENV
//     )

//     // NB: ao-loader isn't updated for this aos wasm, so stitch Error back in
//     if (
//       (result.Output.data as string || '').startsWith('\x1B[31mError\x1B[90m')
//     ) {
//       result.Error = result.Output.data
//     }

//     return result
//   }

//   return {
//     handle,
//     originalHandle,
//     memory: memory as unknown as ArrayBuffer
//   }
// }
