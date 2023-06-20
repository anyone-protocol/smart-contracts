import 'mocha'
import { expect } from 'chai'
import { ContractError, ContractInteraction } from 'warp-contracts'

import {
  DistributionHandle,
  DistributionState,
  INVALID_DISTRIBUTION_AMOUNT
} from '../../src/contracts'
import { ERROR_ONLY_OWNER, INVALID_INPUT } from '../../src/util'

const OWNER  = '0x1111111111111111111111111111111111111111'
const ALICE  = '0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa'
const DEFAULT_DISTRIBUTION_AMOUNT = 100

let initState: DistributionState
function resetState() {
  initState = {
    owner: OWNER,
    distributionAmount: DEFAULT_DISTRIBUTION_AMOUNT
  }
}

function createInteraction(
  caller: string,
  input: any,
  interactionType: 'write' | 'view' = 'write'
): ContractInteraction<any> {
  return { caller, interactionType, input }
}

describe('Distribution Contract', () => {
  beforeEach(resetState)

  it('Initializes state with owner as deployer', () => {
    expect(initState.owner).to.equal(OWNER)
  })

  it('Throws on invalid input', () => {
    expect(
      () => DistributionHandle(initState, { caller: OWNER, input: {} } as any)
    ).to.throw(ContractError, INVALID_INPUT)
  })

  it('Allows owner to set distribution amount', () => {
    const distributionAmount = 200
    const setDistributionAmount = createInteraction(OWNER, {
      function: 'setDistributionAmount',
      distributionAmount
    })

    const { state } = DistributionHandle(initState, setDistributionAmount)

    expect(state.distributionAmount).to.equal(distributionAmount)
  })

  it('Requires non-negative number when setting distribution amount', () => {
    const setMissingDistributionAmount = createInteraction(OWNER, {
      function: 'setDistributionAmount'
    })
    const negativeDistributionAmount = -100
    const setNegativeDistributionAmount = createInteraction(OWNER, {
      function: 'setDistributionAmount',
      distributionAmount: negativeDistributionAmount
    })
    
    expect(
      () => DistributionHandle(initState, setMissingDistributionAmount)
    ).to.throw(ContractError, INVALID_DISTRIBUTION_AMOUNT)
    expect(
      () => DistributionHandle(initState, setNegativeDistributionAmount)
    ).to.throw(ContractError, INVALID_DISTRIBUTION_AMOUNT)
  })

  it('Prevents non-owners from setting distribution amount', () => {
    const aliceSetDistribution = createInteraction(ALICE, {
      function: 'setDistributionAmount',
      distributionAmount: 500
    })

    expect(
      () => DistributionHandle(initState, aliceSetDistribution)
    ).to.throw(ContractError, ERROR_ONLY_OWNER)
  })

  it('Allows owner to distribute given total network score and user scores')
  it('Prevents non-owners from distributing')
})
