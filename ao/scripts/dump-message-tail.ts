/**
 * Fetches the TAIL of the scheduler (SU) message log for the
 * operator-registry, relay-rewards, and staking-rewards AO processes
 * (live + stage) to determine the final writes each process received
 * before legacynet went read-only — e.g. whether a batch of
 * Add-Scores was cut off before its Complete-Round.
 *
 * For each process: pages the SU log to the end, saves the last
 * MAX_TAIL messages to <outputDir>/<network>-<name>.message-tail.json,
 * prints an action timeline, and fetches the CU result for the last
 * few messages to surface in-process errors.
 *
 * Usage: npx tsx scripts/dump-message-tail.ts [outputDir]
 */
import { computeAddress } from 'ethers'
import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'

const SU_ROUTER = 'https://su-router.ao-testnet.xyz'
const MAX_TAIL = 300
const RESULTS_TO_CHECK = 15
const PAGE_SIZE = 100
const LOOKBACK_DAYS = [1, 3, 7, 14, 30, 90, 365]

type Target = {
  network: 'live' | 'stage'
  name: string
  processId: string
  cuUrl: string
}

const TARGETS: Target[] = [
  {
    network: 'live',
    name: 'operator-registry',
    processId: 'W5XIwvQ6pJBtL_Hhvx9KH4fj4LNoyHDLtbAILMM_lCs',
    cuUrl: 'https://cu.anyone.tech'
  },
  {
    network: 'live',
    name: 'relay-rewards',
    processId: 'uEtOd6F1Yv0Fg_Ym161taXFjIokBgDUNEBDcgGWA6aA',
    cuUrl: 'https://cu.anyone.tech'
  },
  {
    network: 'live',
    name: 'staking-rewards',
    processId: 'eg3xbZ_Br_rPVaMhdzeMUImS1whZhOZXgdaVgWY0AWs',
    cuUrl: 'https://cu.anyone.tech'
  },
  {
    network: 'stage',
    name: 'operator-registry',
    processId: 'hvDrJZWwTjAI7Li38biqu1D9FCUT1q6sAUKNDKaH-xc',
    cuUrl: 'https://cu-stage.anyone.tech'
  },
  {
    network: 'stage',
    name: 'relay-rewards',
    processId: '74JFIXlX_W4gldyrU6hckHU8-zpMSWEbnk9q_XZrHwg',
    cuUrl: 'https://cu-stage.anyone.tech'
  },
  {
    network: 'stage',
    name: 'staking-rewards',
    processId: 'WyHZzCYO3tP2tRq1i2L8vnsgxahqGLLZ0H7aWfPLMwY',
    cuUrl: 'https://cu-stage.anyone.tech'
  }
]

async function fetchJsonWithRetry(url: string, retries = 5): Promise<any> {
  let lastError: Error | undefined
  for (let attempt = 0; attempt < retries; attempt++) {
    if (attempt > 0) {
      await new Promise(resolve => setTimeout(resolve, 2 ** attempt * 1000))
    }
    try {
      const res = await fetch(url)
      if (!res.ok) {
        throw new Error(`Request failed: ${res.status} ${(await res.text()).slice(0, 200)}`)
      }

      return await res.json()
    } catch (error) {
      lastError = error
      console.error(`  attempt ${attempt + 1} failed for ${url.slice(0, 100)}: ${error.message.slice(0, 100)}`)
    }
  }

  throw lastError
}

async function fetchPage(processId: string, from: number | null, limit: number) {
  const url = `${SU_ROUTER}/${processId}?process-id=${processId}&limit=${limit}`
    + (from !== null ? `&from=${from}` : '')

  return await fetchJsonWithRetry(url)
}

function tagValue(tags: any[], name: string): string | undefined {
  return tags?.find((t: any) => t.name === name)?.value
}

function senderOf(message: any): string {
  const fromProcess = tagValue(message.tags, 'From-Process')
  if (fromProcess) { return `process:${fromProcess}` }
  const key = message.owner?.key
  if (key) {
    const bytes = Buffer.from(key, 'base64url')
    if (bytes.length === 65 && bytes[0] === 0x04) {
      // NB: secp256k1 pubkey; the CU normalizes these senders to their
      // checksummed 0x address, so report that form
      return computeAddress('0x' + bytes.toString('hex'))
    }
  }

  return message.owner?.address || 'unknown'
}

function describeEdge(edge: any) {
  const { message, assignment } = edge.node
  const timestamp = Number(tagValue(assignment.tags, 'Timestamp') || edge.cursor)

  return {
    nonce: Number(tagValue(assignment.tags, 'Nonce')),
    timestamp,
    timestampIso: new Date(timestamp).toISOString(),
    id: message.id,
    action: tagValue(message.tags, 'Action') || `<${tagValue(message.tags, 'Type')}>`,
    sender: senderOf(message),
    dataBytes: typeof message.data === 'string' ? message.data.length : 0
  }
}

async function fetchTail(processId: string) {
  // NB: Find a starting cursor close to the end of the log by stepping
  // back in time until a page is non-empty
  let from: number | null = null
  for (const daysBack of LOOKBACK_DAYS) {
    const cursor = Date.now() - daysBack * 86_400_000
    const probe = await fetchPage(processId, cursor, 1)
    if (probe.edges.length > 0) {
      from = cursor
      break
    }
  }

  let cursor = from
  let edges: any[] = []
  while (true) {
    const page = await fetchPage(processId, cursor, PAGE_SIZE)
    if (page.edges.length === 0) { break }
    edges = [...edges, ...page.edges].slice(-MAX_TAIL)
    cursor = Number(page.edges[page.edges.length - 1].cursor)
    if (!page.page_info.has_next_page) { break }
  }

  return edges
}

async function fetchResult(cuUrl: string, processId: string, messageId: string) {
  try {
    return await fetchJsonWithRetry(
      `${cuUrl}/result/${messageId}?process-id=${processId}`, 3
    )
  } catch (error) {
    return { Error: `CU result request failed: ${error.message.slice(0, 200)}` }
  }
}

async function dumpMessageTails() {
  const startedAt = new Date().toISOString()
  const outputDir = process.argv[2]
    || join('state-dumps', startedAt.split('T')[0])
  mkdirSync(outputDir, { recursive: true })

  for (const { network, name, processId, cuUrl } of TARGETS) {
    const label = `${network}/${name}`
    console.log(`\n===== [${label}] ${processId} =====`)

    const edges = await fetchTail(processId)
    if (edges.length === 0) {
      console.log(`[${label}] no messages found in lookback window!`)
      continue
    }

    const described = edges.map(describeEdge)
    const tailFile = join(outputDir, `${network}-${name}.message-tail.json`)
    writeFileSync(tailFile, JSON.stringify(
      { processId, fetchedAt: startedAt, count: described.length, messages: described },
      null, 2
    ))

    // NB: Check CU evaluation results of the final messages for errors
    const toCheck = described.slice(-RESULTS_TO_CHECK)
    for (const msg of toCheck) {
      const result = await fetchResult(cuUrl, processId, msg.id)
      ;(msg as any).resultError = result.Error ?? null
      ;(msg as any).resultMessages = result.Messages?.length ?? 0
    }
    writeFileSync(tailFile, JSON.stringify(
      { processId, fetchedAt: startedAt, count: described.length, messages: described },
      null, 2
    ))

    // NB: Print a compact action timeline of the last messages
    for (const msg of described.slice(-30)) {
      const err = (msg as any).resultError
      console.log([
        String(msg.nonce).padStart(7),
        msg.timestampIso,
        msg.action.padEnd(24),
        msg.sender.slice(0, 14).padEnd(15),
        `${msg.dataBytes}b`,
        err ? `ERROR: ${JSON.stringify(err).slice(0, 120)}` : ''
      ].join(' '))
    }

    // NB: Batch-completeness check: was the last Add-Scores followed by
    // a Complete-Round?
    const lastAddScores = [...described].reverse()
      .find(m => m.action === 'Add-Scores')
    const lastCompleteRound = [...described].reverse()
      .find(m => m.action === 'Complete-Round')
    if (lastAddScores || lastCompleteRound) {
      console.log(`[${label}] last Add-Scores:     ${lastAddScores?.timestampIso ?? 'none in tail'} (nonce ${lastAddScores?.nonce ?? '-'})`)
      console.log(`[${label}] last Complete-Round: ${lastCompleteRound?.timestampIso ?? 'none in tail'} (nonce ${lastCompleteRound?.nonce ?? '-'})`)
      if (lastAddScores && lastCompleteRound
        && lastAddScores.nonce > lastCompleteRound.nonce) {
        console.log(`[${label}] *** POSSIBLE CUT-OFF: Add-Scores after last Complete-Round ***`)
      }
    }
    console.log(`[${label}] tail of ${described.length} messages saved to ${tailFile}`)
  }
}

dumpMessageTails().catch(e => {
  console.error(e)
  process.exit(1)
})
