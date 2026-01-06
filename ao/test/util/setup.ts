import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import AoLoader from '@permaweb/ao-loader'

export const MODULE_NAME = 'Encrypted-Messages'
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

export const EXAMPLE_SIGNING_PUBLIC_KEY = EXAMPLE_SIGNING_CERT.subarray(39, 71)

export const EXAMPLE_SECRET_ID_KEY = fs.readFileSync(
  path.join(path.resolve(), './test/util/test-keys/secret_id_key')
)

export const EXAMPLE_RSA_IDENTITY_PUBLIC_KEY = crypto
  .createPublicKey(EXAMPLE_SECRET_ID_KEY)
  .export({ type: 'pkcs1', format: 'der' })

export const EXAMPLE_FINGERPRINT = crypto
  .createHash('sha1')
  .update(EXAMPLE_RSA_IDENTITY_PUBLIC_KEY as any)
  .digest()

// const okcc = Buffer.concat([
//   Buffer.from(EXAMPLE_FINGERPRINT),
//   EXAMPLE_MASTER_ID_PUBLIC_KEY.subarray(32)
// ])
// const okccSignature = crypto.sign(null, okcc, EXAMPLE_SECRET_ID_KEY)
// const verified = crypto.verify(
//   null,
//   okcc,
//   EXAMPLE_SECRET_ID_KEY,
//   okccSignature
// )
// console.log('verified', verified)

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
    // './test/util/aos-cbn0KKrBZH7hdNkNokuXLtGryrWM--PjSTBqIzw9Kkk.wasm'
    './test/util/aos-Pq2Zftrqut0hdisH_MC2pDOT6S4eQFoxGsFUzR6r350.wasm'
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

const contractNames = [
  'operator-registry',
  'relay-rewards',
  'staking-rewards',
  'acl-test'
]
const bundledContractSources = Object.fromEntries(contractNames.map(cn => [
  cn,
  fs.readFileSync(path.join(path.resolve(), `./dist/${cn}.lua`), 'utf-8')
]))

// Staking Rewards Configuration Shares structure
export interface StakingRewardsConfigurationShares {
  Enabled: boolean
  Min: number
  Max: number
  Default: number
}

// Staking Rewards Configuration structure for patch tags
export interface StakingRewardsConfiguration {
  TokensPerSecond: string
  Requirements: {
    Running: number
  }
  Shares: StakingRewardsConfigurationShares
}

// Patch tag with typed value for configuration
export interface ConfigurationPatchTag {
  name: 'configuration'
  value: StakingRewardsConfiguration
}

// Patch tag with typed value for shares (operator address -> share value)
export interface SharesPatchTag {
  name: 'shares'
  value: Record<string, number>
}

// Score structure within previous round details
export interface StakingRewardsScore {
  Staked: string
  Restaked: string
  Running: number
  Share: number
}

// Reward structure within previous round details
export interface StakingRewardsReward {
  Hodler: string
  Operator: string
}

// Detail entry for a hodler-operator pair
export interface StakingRewardsDetail {
  Score: StakingRewardsScore
  Rating: string
  Reward: StakingRewardsReward
}

// Previous round summary
export interface StakingRewardsSummary {
  Rewards: string
  Ratings: string
  Stakes: string
}

// Previous round value structure
export interface StakingRewardsPreviousRound {
  Timestamp: number
  Period: number
  Summary: StakingRewardsSummary
  Configuration: StakingRewardsConfiguration
  Details: Record<string, Record<string, StakingRewardsDetail>>
}

// Patch tag with typed value for previous_round
export interface PreviousRoundPatchTag {
  name: 'previous_round'
  value: StakingRewardsPreviousRound
}

export type FullAOHandleFunction = (
  buffer: ArrayBuffer | null,
  msg: AoLoader.Message,
  env: AoLoader.Environment
) => Promise<AoLoader.HandleResponse & { Error?: string }>

export type AOTestHandle = (
  options?: Partial<AoLoader.Message>,
  mem?: ArrayBuffer | null
) => Promise<AoLoader.HandleResponse & { Error?: string }>

export async function createLoader(
  contractName: string,
  contractSource?: string
) {
  const originalHandle = await AoLoader(AOS_WASM, {
    format: 'wasm64-unknown-emscripten-draft_2024_02_15',
    memoryLimit: '524288000', // in bytes
    computeLimit: 9e12,
    extensions: []
  })

  if (!bundledContractSources[contractName] && !contractSource) {
    throw new Error(`Unknown contract: ${contractName}`)
  }

  const programs = [
    {
      action: 'Eval',
      args: [{ name: 'Module', value: DEFAULT_MODULE_ID }],
      Data: contractSource || bundledContractSources[contractName]
    }
  ]
  let memory: ArrayBuffer | null = null
  for (const { action, args, Data } of programs) {
    const result = await originalHandle(
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
    // console.log(`DEBUG - AO Result `, result)
  }

  async function handle(
    options: Partial<AoLoader.Message> = {},
    mem = memory
  ) {
    const result = await originalHandle(
      mem,
      {
        ...DEFAULT_HANDLE_OPTIONS,
        ...options,
      },
      AO_ENV
    )

    // NB: ao-loader isn't updated for this aos wasm, so stitch Error back in
    if (
      (result.Output.data as string || '').startsWith('\x1B[31mError\x1B[90m')
    ) {
      result.Error = result.Output.data
    }

    return result
  }

  return {
    handle,
    originalHandle,
    memory: memory as unknown as ArrayBuffer
  }
}
