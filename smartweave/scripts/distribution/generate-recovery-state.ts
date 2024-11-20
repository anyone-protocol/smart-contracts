import BigNumber from 'bignumber.js'
import fs from 'fs'
import _ from 'lodash'

BigNumber.config({ EXPONENTIAL_AT: 50 })

type Fingerprint = string
type EvmAddress = string
type DistributionResult = {
  timeElapsed: string
  tokensDistributedPerSecond: string
  baseNetworkScore: string
  baseDistributedTokens: string
  bonuses: {
    hardware: {
      enabled: boolean
      tokensDistributedPerSecond: string
      networkScore: string
      distributedTokens: string
    }
    quality: {
      enabled: boolean
      tokensDistributedPerSecond: string
      settings: {
        uptime: {
          [days: number]: number
        }
      }
      uptime: {
        [fingerprint: Fingerprint]: number
      }
      networkScore: string
      distributedTokens: string
    }
  }
  multipliers: {
    family: {
      enabled: boolean
      familyMultiplierRate: string
    }
  }
  families: { [fingerprint in Fingerprint as string]: Fingerprint[] }
  totalTokensDistributedPerSecond: string
  totalNetworkScore: string
  totalDistributedTokens: string
  details: {
    [fingerprint: Fingerprint]: {
      address: EvmAddress
      score: string
      distributedTokens: string
      bonuses: {
        hardware: string
        quality: string
      }
      multipliers: {
        family: string
        region: string
      }
    }
  }
}

const lastSafeTimestamp = 1731082380618

async function generateRecoveryState() {
  const paths = fs.readdirSync('./scripts/distribution/snapshots')
  const snapshots = _.sortBy(
    paths
      .map(path => {
        const timestamp = Number.parseInt(path.split('-')[0])
        const snapshot = JSON.parse(
          fs.readFileSync(
            `./scripts/distribution/snapshots/${path}`,
            'utf8'
          )
        ) as { [timestamp:string]: DistributionResult }

        return { timestamp, snapshot }
      })
      .filter(({ timestamp }) => timestamp <= lastSafeTimestamp),
    'timestamp'
  )

  console.log(`Got ${snapshots.length} snapshots`)

  const claimable: { [ address: string ]: string } = {}
  let current = 1
  let lastTimestamp: string = ''
  for (const { timestamp, snapshot } of snapshots) {
    console.log(
      `[${current}/${snapshots.length}][${timestamp}] Processing snapshot` +
        ` ${new Date(timestamp).toISOString()}`
    )
    const result = snapshot[timestamp]
    // console.log(
    //   `[${current}/${snapshots.length}][${timestamp}]` +
    //     ` ${result.totalDistributedTokens} total tokens distributed over` +
    //     ` ${result.timeElapsed}` +
    //     ` with expected rate ${result.totalTokensDistributedPerSecond} tps` +
    //     ` with actual rate ${
    //         BigNumber(result.totalDistributedTokens)
    //           .dividedBy(BigNumber(result.timeElapsed).abs())
    //           .toString()
    //       }`
    // )
    for (const fingerprint in result.details) {
      const { address, distributedTokens } = result.details[fingerprint]

      if (!claimable[address]) {
        claimable[address] = distributedTokens
      } else {
        claimable[address] = BigNumber(claimable[address])
          .plus(distributedTokens)
          .toString()
      }
    }

    lastTimestamp = timestamp.toString()
    current++
  }

  if (lastTimestamp) {
    const recoveryState = JSON.parse(
      fs.readFileSync(
        './scripts/distribution/data/base-init-state.json',
        'utf8'
      )
    )

    recoveryState['claimable'] = claimable
    recoveryState['previousDistributions'] = {
      [lastTimestamp]: {}
    }

    fs.writeFileSync(
      './scripts/distribution/data/recovery-state.json',
      JSON.stringify(recoveryState)
    )
  }
}

generateRecoveryState().catch(err => {
  console.error(err)
  process.exit(1)
})
