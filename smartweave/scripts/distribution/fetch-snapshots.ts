import Query from '@irys/query'
import axios from 'axios'
import _ from 'lodash'
import fs from 'fs'

async function fetchSnapshots() {
  const from = 1728479113000
  const to = 1731242011000

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
      )
    })),
    'tagTimestamp'
  )

  let current = 1
  for (const { result, irysTimestamp, tagTimestamp } of mapped) {
    console.log(
      `[${current}/${mapped.length}] Fetching snapshot` +
        ` ${result.id} - ${irysTimestamp} - ${tagTimestamp}`
    )
    const response = await axios.get(
      `https://gateway.irys.xyz/${result.id}`,
      { transformResponse: res => res }
    )
    console.log(
      `[${current}/${mapped.length}] Got snapshot ${result.id}, saving to disk`
    )
    fs.writeFileSync(
      `./scripts/distribution/snapshots/${tagTimestamp}-${result.id}.json`,
      response.data
    )
    console.log(`[${current}/${mapped.length}] Saved snapshot ${result.id}`)
    current++
  }

  console.log('Done fetching & saving snapshots')
}

fetchSnapshots().catch(err => {
  console.error(err)
  process.exit(1)
})
