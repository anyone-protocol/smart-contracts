import { ContractError } from 'warp-contracts'
import { utils } from 'ethers'

export function ContractAssert(cond: boolean, message: any): asserts cond {
  if (!(cond)) {
    throw new ContractError(message)
  }
}

export const SmartWeave = {
  extensions: { ethers: { utils } },
  transaction: { id: '' },
  unsafeClient: {
    transactions: {
      async getData(txid: string) {
        return null
      }
    }
  }
}
