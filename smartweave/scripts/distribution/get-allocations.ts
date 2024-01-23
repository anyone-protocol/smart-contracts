import dotenv from 'dotenv'
import { LoggerFactory, WarpFactory } from 'warp-contracts'
import { EthersExtension } from 'warp-contracts-plugin-ethers'
import { Wallet } from 'ethers'

import {
  DistributionState,
  Claimable
} from '../../src/contracts'

dotenv.config()

LoggerFactory.INST.logLevel('error')

interface RewardAllocationData {
  address: string
  amount: string
}

// put keys here...
const updateData: string[] = []
 
const distributionContractTxId = process.env.DISTRIBUTION_CONTRACT_TXID
  || 'Missing DISTRIBUTION_CONTRACT_TXID'

const distributionWarp = WarpFactory.forMainnet({
  inMemory: true,
  dbLocation: '-distribution',
})
  .use(new EthersExtension())

const distributionContract =
  distributionWarp.contract<DistributionState>(
      distributionContractTxId,
  )

async function getAllocation(
  address: string,
): Promise<RewardAllocationData | undefined> {
    try {
        const response = await distributionContract
            .viewState<Claimable, string>({
                function: 'claimable',
                address: address,
            })

        if (response.result == undefined) {
            console.log(
                `Failed to fetch distribution state: ${response.errorMessage}`,
            )
            return undefined
        } else {
            return {
                address: address,
                amount: response.result,
            }
        }
    } catch (error) {
        console.log(`Exception in getAllocation:`, error)
        return undefined
    }
}

async function main() {
  
  for(let address of updateData) {
    const reward = await getAllocation(address)
    if (reward) {
      console.log(`{address:"${address}",amount:"${reward.amount}"},`)
    } else {
      console.log(`${address}:failed`)
    }
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
