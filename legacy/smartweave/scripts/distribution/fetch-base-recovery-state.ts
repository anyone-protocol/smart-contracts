import axios from 'axios'
import _ from 'lodash'
import fs from 'fs'
import BigNumber from 'bignumber.js'

import { DistributionState } from '~/src/contracts'

BigNumber.config({ EXPONENTIAL_AT: 50 })

const contractId = 'yJCe3y5R9ztC1ZYM8RuUuZyPgsINEHZSXXKyagiVLV8'

async function fetchBaseRecoveryState() {
  console.log(`Fetching distribution state for ${contractId}`)
  
  const response = await axios.get(
    `https://dre.ec.anyone.tech/contract?id=${contractId}`
  )

  // console.log(`Got distribution state, saving to disk...`)

  const recoveryState: Partial<DistributionState> = response.data.state

  recoveryState.pendingDistributions = {}
  recoveryState.previousDistributions = {
    '1734164836985': {} as any
  }

  fs.writeFileSync(
    `./scripts/distribution/data/recovery-state-${contractId}.json`,
    JSON.stringify(recoveryState)
  )

  console.log(`Saved distribution recovery state to disk`)
}

fetchBaseRecoveryState().catch(err => {
  console.error(err)
  process.exit(1)
})
