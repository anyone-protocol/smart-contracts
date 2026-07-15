/**
 * Dumps the FULL state of the operator-registry, relay-rewards, and
 * staking-rewards AO processes (live + stage) via dry-run Eval against
 * dedicated CUs. Works against read-only legacynet since dry-runs are
 * unsigned & nothing is persisted.
 *
 * The existing View-State handlers omit parts of state (e.g.
 * PreviousRound.Details, PendingRounds, PreviousRound.Configuration),
 * so instead we Eval `require('json').encode(<StateGlobal>)` with the
 * message From/Owner spoofed to the process owner (dry-runs skip
 * signature verification). NB: These processes were spawned with
 * Ethereum-signed data items, so the aos `Owner` global is the
 * CHECKSUMMED 0x ADDRESS of the deployer key — not the Arweave-style
 * owner address reported by gateways — so we derive it from the spawn
 * tx public key. Dry-runs are POSTed directly to the CU rather than
 * through aoconnect because aoconnect strips the `From` field.
 *
 * Also dumps ACL roles via the unauthenticated View-Roles handler.
 *
 * Usage: npx tsx scripts/dump-full-state.ts [outputDir]
 */
import { createHash } from 'crypto'
import { computeAddress } from 'ethers'
import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'

const GATEWAY_GRAPHQL = 'https://arweave-search.goldsky.com/graphql'

type Target = {
  network: 'live' | 'stage'
  name: string
  stateGlobal: string
  processId: string
  cuUrl: string
}

const TARGETS: Target[] = [
  {
    network: 'live',
    name: 'operator-registry',
    stateGlobal: 'OperatorRegistry',
    processId: 'W5XIwvQ6pJBtL_Hhvx9KH4fj4LNoyHDLtbAILMM_lCs',
    cuUrl: 'https://cu.anyone.tech'
  },
  {
    network: 'live',
    name: 'relay-rewards',
    stateGlobal: 'RelayRewards',
    processId: 'uEtOd6F1Yv0Fg_Ym161taXFjIokBgDUNEBDcgGWA6aA',
    cuUrl: 'https://cu.anyone.tech'
  },
  {
    network: 'live',
    name: 'staking-rewards',
    stateGlobal: 'StakingRewards',
    processId: 'eg3xbZ_Br_rPVaMhdzeMUImS1whZhOZXgdaVgWY0AWs',
    cuUrl: 'https://cu.anyone.tech'
  },
  {
    network: 'stage',
    name: 'operator-registry',
    stateGlobal: 'OperatorRegistry',
    processId: 'hvDrJZWwTjAI7Li38biqu1D9FCUT1q6sAUKNDKaH-xc',
    cuUrl: 'https://cu-stage.anyone.tech'
  },
  {
    network: 'stage',
    name: 'relay-rewards',
    stateGlobal: 'RelayRewards',
    processId: '74JFIXlX_W4gldyrU6hckHU8-zpMSWEbnk9q_XZrHwg',
    cuUrl: 'https://cu-stage.anyone.tech'
  },
  {
    network: 'stage',
    name: 'staking-rewards',
    stateGlobal: 'StakingRewards',
    processId: 'WyHZzCYO3tP2tRq1i2L8vnsgxahqGLLZ0H7aWfPLMwY',
    cuUrl: 'https://cu-stage.anyone.tech'
  }
]

async function fetchProcessOwnerEthAddresses(
  processIds: string[]
): Promise<Record<string, string>> {
  const query = `query {
    transactions(ids: ${JSON.stringify(processIds)}) {
      edges { node { id owner { key } } }
    }
  }`
  const res = await fetch(GATEWAY_GRAPHQL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query })
  })
  if (!res.ok) {
    throw new Error(`Gateway GraphQL request failed: ${res.status}`)
  }
  const body = await res.json()
  const owners: Record<string, string> = {}
  for (const { node } of body.data.transactions.edges) {
    const publicKey = Buffer.from(node.owner.key, 'base64url')
    owners[node.id] = computeAddress('0x' + publicKey.toString('hex'))
  }

  return owners
}

async function dryRun(
  cuUrl: string,
  processId: string,
  msg: { From?: string, Owner?: string, Data?: string, Tags: any[] },
  retries = 3
): Promise<any> {
  const body = JSON.stringify({
    Id: '1234',
    Target: processId,
    Owner: msg.Owner || '1234',
    From: msg.From || msg.Owner || '1234',
    Data: msg.Data || '1234',
    Tags: [
      ...msg.Tags,
      { name: 'Data-Protocol', value: 'ao' },
      { name: 'Type', value: 'Message' },
      { name: 'Variant', value: 'ao.TN.1' }
    ],
    Anchor: '0'
  })

  let lastError: Error | undefined
  for (let attempt = 0; attempt < retries; attempt++) {
    if (attempt > 0) {
      await new Promise(resolve => setTimeout(resolve, 2 ** attempt * 2000))
    }
    try {
      const res = await fetch(
        `${cuUrl}/dry-run?process-id=${processId}`,
        { method: 'POST', headers: { 'content-type': 'application/json' }, body }
      )
      if (!res.ok) {
        throw new Error(`CU dry-run failed: ${res.status} ${await res.text()}`)
      }

      return await res.json()
    } catch (error) {
      lastError = error
      console.error(`  dry-run attempt ${attempt + 1} failed: ${error.message}`)
    }
  }

  throw lastError
}

function extractEvalOutput(result: any): string {
  if (result.Error) {
    throw new Error(`Eval error: ${JSON.stringify(result.Error)}`)
  }
  const data = result.Output?.data
  if (typeof data === 'string') { return data }
  if (typeof data?.output === 'string') { return data.output }
  if (data?.json !== undefined && data.json !== 'undefined') {
    return JSON.stringify(data.json)
  }

  throw new Error(
    `Unexpected Eval output shape: ${JSON.stringify(result.Output)?.slice(0, 500)}`
  )
}

function sha256(data: string): string {
  return createHash('sha256').update(data).digest('hex')
}

function summarize(json: string): string {
  const parsed = JSON.parse(json)
  return Object.entries(parsed).map(([key, value]) => {
    if (value !== null && typeof value === 'object') {
      return `${key}(${Object.keys(value).length})`
    }

    return `${key}=${value}`
  }).join(' ')
}

async function dumpFullState() {
  const startedAt = new Date().toISOString()
  const outputDir = process.argv[2]
    || join('state-dumps', startedAt.split('T')[0])
  mkdirSync(outputDir, { recursive: true })

  const owners = await fetchProcessOwnerEthAddresses(
    TARGETS.map(t => t.processId)
  )
  const manifest: any[] = []
  const failures: string[] = []

  for (const target of TARGETS) {
    const { network, name, stateGlobal, processId, cuUrl } = target
    const label = `${network}/${name}`
    const owner = owners[processId]
    if (!owner) {
      failures.push(`${label}: could not resolve process owner`)
      continue
    }

    try {
      console.log(`[${label}] dumping full state from ${cuUrl} (Owner ${owner}) ...`)
      const stateResult = await dryRun(cuUrl, processId, {
        Owner: owner,
        Tags: [{ name: 'Action', value: 'Eval' }],
        Data: `require('json').encode(${stateGlobal})`
      })
      const stateJson = extractEvalOutput(stateResult)
      JSON.parse(stateJson) // NB: validate before writing
      const stateFile = join(outputDir, `${network}-${name}.state.json`)
      writeFileSync(stateFile, stateJson)
      console.log(`[${label}] state: ${stateJson.length} bytes`)
      console.log(`[${label}]   ${summarize(stateJson)}`)

      console.log(`[${label}] dumping ACL roles ...`)
      const rolesResult = await dryRun(cuUrl, processId, {
        Owner: owner,
        Tags: [{ name: 'Action', value: 'View-Roles' }]
      })
      const rolesJson = rolesResult.Messages?.[0]?.Data
      if (typeof rolesJson !== 'string') {
        throw new Error(
          `No View-Roles response: ${JSON.stringify(rolesResult).slice(0, 500)}`
        )
      }
      JSON.parse(rolesJson)
      const rolesFile = join(outputDir, `${network}-${name}.roles.json`)
      writeFileSync(rolesFile, rolesJson)
      console.log(`[${label}] roles: ${rolesJson.length} bytes`)

      manifest.push({
        network,
        name,
        processId,
        processOwner: owner,
        cuUrl,
        stateGlobal,
        dumpedAt: new Date().toISOString(),
        state: {
          file: `${network}-${name}.state.json`,
          bytes: stateJson.length,
          sha256: sha256(stateJson)
        },
        roles: {
          file: `${network}-${name}.roles.json`,
          bytes: rolesJson.length,
          sha256: sha256(rolesJson)
        }
      })
    } catch (error) {
      console.error(`[${label}] FAILED:`, error.message)
      failures.push(`${label}: ${error.message}`)
    }
  }

  writeFileSync(
    join(outputDir, 'manifest.json'),
    JSON.stringify({ startedAt, dumps: manifest, failures }, null, 2)
  )
  console.log(`\nManifest written to ${join(outputDir, 'manifest.json')}`)

  if (failures.length > 0) {
    console.error(`\n${failures.length} dump(s) failed:`)
    for (const failure of failures) { console.error(`  - ${failure}`) }
    process.exit(1)
  }

  console.log(`All ${manifest.length} dumps completed successfully.`)
}

dumpFullState().catch(e => {
  console.error(e)
  process.exit(1)
})
