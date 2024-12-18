import Query from '@irys/query'
import axios from 'axios'
import _ from 'lodash'
import fs from 'fs'
import BigNumber from 'bignumber.js'

BigNumber.config({ EXPONENTIAL_AT: 50 })

async function fetchSnapshots() {
  const from = new Date('Nov 26 2024 07:19:07 PM (GMT-5)').getTime()
  // const from = new Date('Nov 13 2024 12:00:00 PM').getTime()
  // const from = 1731242011000
  // const to = 1731242011000
  const to = Date.now()

  console.log(
    `Querying distribution results` +
      ` from ${new Date(from).toUTCString()}` +
      ` to ${new Date(to).toUTCString()}`
  )

  const results = await new Query()
    .search('irys:transactions')
    .from([ '0xbB232BC269B0F3aB57e5907F414a2b30421fac07' ])
    .tags([{ name: 'Entity-Type', values: [ 'distribution/summary' ] }])
    .fromTimestamp(from)
    .toTimestamp(to)
    .sort('ASC')
    .limit(1000)

  console.log(`Got ${results.length} snapshots`)

  const mapped = _.sortBy(
    results.map(result => ({
      result,
      irysTimestamp: result.timestamp,
      tagTimestamp: Number.parseInt(
        result.tags.find(t => t.name === 'Content-Timestamp')?.value || ''
      ),
      timeElapsed: Number.parseInt(
        result.tags.find(t => t.name === 'Time-Elapsed')?.value || ''
      ),
      totalDistributed: BigNumber(
        result.tags.find(t => t.name === 'Total-Distributed')?.value || ''
      ).toString()
    })),
    'tagTimestamp'
  )

  let current = 1
  for (const {
    result,
    irysTimestamp,
    tagTimestamp,
    timeElapsed,
    totalDistributed
  } of mapped) {
    if (BigNumber(totalDistributed).lt(0)) {
      console.warn(
        `${logSnapshotIndex(current, mapped.length)} Skipping bad snapshot ${result.id}`
      )
    } else {
      console.log(
        `${logSnapshotIndex(current, mapped.length)} Fetching snapshot` +
          ` ${result.id} - ${irysTimestamp} - ${tagTimestamp},` +
          ` Epoch = ${new Date(tagTimestamp).toUTCString()},` +
          ` Elapsed = ${timeElapsed}, Distributed = ${totalDistributed}`
      )
      const response = await axios.get(
        `https://gateway.irys.xyz/${result.id}`,
        { transformResponse: res => res }
      )
      console.log(
        `${logSnapshotIndex(current, mapped.length)} Got snapshot ${result.id}, saving to disk`
      )
      fs.writeFileSync(
        `./scripts/distribution/snapshots/${tagTimestamp}-${result.id}.json`,
        response.data
      )
      console.log(`${logSnapshotIndex(current, mapped.length)} Saved snapshot ${result.id}`)
    }

    current++
  }

  console.log('Done fetching & saving snapshots')
}

fetchSnapshots().catch(err => {
  console.error(err)
  process.exit(1)
})

function logSnapshotIndex(current: number, total: number) {
  return `[${current.toString().padStart(total.toString().length, '0')}/${total}]`
}
