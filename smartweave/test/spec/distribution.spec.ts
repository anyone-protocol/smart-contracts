import 'mocha'
import { expect } from 'chai'
import { ContractError, ContractInteraction } from 'warp-contracts'

import {
  DUPLICATE_FINGERPRINT_SCORES,
  DistributionHandle,
  DistributionState,
  INVALID_DISTRIBUTION_AMOUNT,
  INVALID_SCORES,
  INVALID_TIMESTAMP,
  NO_DISTRIBUTION_TO_CANCEL,
  NO_PENDING_SCORES
} from '../../src/contracts'
import { ERROR_ONLY_OWNER, INVALID_INPUT } from '../../src/util'

const OWNER  = '0x1111111111111111111111111111111111111111'
const ALICE  = '0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa'
const BOB    = '0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB'
const fingerprintA = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
const fingerprintB = 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB'
const DEFAULT_DISTRIBUTION_AMOUNT = BigInt(1000)

let initState: DistributionState
function resetState() {
  initState = {
    owner: OWNER,
    distributionAmount: DEFAULT_DISTRIBUTION_AMOUNT,
    pendingDistributions: {},
    claimable: {}
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

  it('Allows owner to set distribution amount and rate', () => {
    const distributionAmount = BigInt(200)
    const setDistributionAmount = createInteraction(OWNER, {
      function: 'setDistributionAmount',
      distributionAmount
    })

    const { state } = DistributionHandle(initState, setDistributionAmount)

    expect(state.distributionAmount).to.equal(distributionAmount)
  })

  it('Validates when setting distribution amount', () => {
    const setMissingDistributionAmount = createInteraction(OWNER, {
      function: 'setDistributionAmount'
    })
    const negativeDistributionAmount = BigInt(-100)
    const setNegativeDistributionAmount = createInteraction(OWNER, {
      function: 'setDistributionAmount',
      distributionAmount: negativeDistributionAmount
    })
    const numberDistributionAmount = 100
    const setNumberDistributionAmount = createInteraction(OWNER, {
      function: 'setDistributionAmount',
      distributionAmount: numberDistributionAmount
    })
    
    expect(
      () => DistributionHandle(initState, setMissingDistributionAmount)
    ).to.throw(ContractError, INVALID_DISTRIBUTION_AMOUNT)
    expect(
      () => DistributionHandle(initState, setNegativeDistributionAmount)
    ).to.throw(ContractError, INVALID_DISTRIBUTION_AMOUNT)
    expect(
      () => DistributionHandle(initState, setNumberDistributionAmount)
    ).to.throw(ContractError, INVALID_DISTRIBUTION_AMOUNT)
  })

  it('Prevents non-owners from setting distribution amount', () => {
    const aliceSetDistribution = createInteraction(ALICE, {
      function: 'setDistributionAmount',
      distributionAmount: BigInt(500)
    })

    expect(
      () => DistributionHandle(initState, aliceSetDistribution)
    ).to.throw(ContractError, ERROR_ONLY_OWNER)
  })

  it('Allows owner to add scores for a distribution by timestamp', () => {
    const timestamp = Date.now().toString()
    const ownerAddScores = createInteraction(OWNER, {
      function: 'addScores',
      timestamp,
      scores: [
        { score: BigInt(1000), address: ALICE, fingerprint: fingerprintA }
      ]
    })

    const { state } = DistributionHandle(initState, ownerAddScores)

    expect(state.pendingDistributions).to.deep.equal({
      [timestamp]: [
        { score: BigInt(1000), address: ALICE, fingerprint: fingerprintA }
      ]
    })
  })

  it('Adding scores requires a valid timestamp', () => {
    const addScoresNoTimestamp = createInteraction(OWNER, {
      function: 'addScores'
    })
    const addScoresShortTimestamp = createInteraction(OWNER, {
      function: 'addScores',
      timestamp: '168910629097'
    })
    const addScoresCharsTimestamp = createInteraction(OWNER, {
      function: 'addScores',
      timestamp: 'timestamp'
    })
    const addScoresObjectTimestamp = createInteraction(OWNER, {
      function: 'addScores',
      timestamp: {}
    })

    expect(
      () => DistributionHandle(initState, addScoresNoTimestamp)
    ).to.throw(ContractError, INVALID_TIMESTAMP)
    expect(
      () => DistributionHandle(initState, addScoresShortTimestamp)
    ).to.throw(ContractError, INVALID_TIMESTAMP)
    expect(
      () => DistributionHandle(initState, addScoresCharsTimestamp)
    ).to.throw(ContractError, INVALID_TIMESTAMP)
    expect(
      () => DistributionHandle(initState, addScoresObjectTimestamp)
    ).to.throw(ContractError, INVALID_TIMESTAMP)
  })

  it('Adding scores requires at least one score', () => {
    const addScoresUndefinedScores = createInteraction(OWNER, {
      function: 'addScores',
      timestamp: Date.now().toString()
    })
    const addScoresEmptyScores = createInteraction(OWNER, {
      function: 'addScores',
      timestamp: Date.now().toString()
    })

    expect(
      () => DistributionHandle(initState, addScoresUndefinedScores)
    ).to.throw(ContractError, INVALID_SCORES)
    expect(
      () => DistributionHandle(initState, addScoresEmptyScores)
    ).to.throw(ContractError, INVALID_SCORES)
  })

  it('Adding scores requires valid score, address, fingerprint tuples', () => {
    const timestamp = Date.now().toString()
    const addScoresNoScore = createInteraction(OWNER, {
      function: 'addScores',
      timestamp,
      scores: [{ address: ALICE, fingerprint: fingerprintA }]
    })
    const addScoresNegativeScore = createInteraction(OWNER, {
      function: 'addScores',
      timestamp,
      scores: [
        { score: BigInt(-1000), address: ALICE, fingerprint: fingerprintA }
      ]
    })
    const addScoresNoAddress = createInteraction(OWNER, {
      function: 'addScores',
      timestamp,
      scores: [{ score: BigInt(1000), fingerprint: fingerprintA }]
    })
    const addScoresInvalidAddress = createInteraction(OWNER, {
      function: 'addScores',
      timestamp,
      scores: [
        { score: BigInt(1000), address: 'alice', fingerprint: fingerprintA }
      ]
    })
    const addScoresNoChecksumAddress = createInteraction(OWNER, {
      function: 'addScores',
      timestamp,
      scores: [{
        score: BigInt(1000),
        address: ALICE.toLowerCase(),
        fingerprint: fingerprintA 
      }]
    })
    const addScoresNoFingerprint = createInteraction(OWNER, {
      function: 'addScores',
      timestamp,
      scores: [{ score: BigInt(1000), address: ALICE }]
    })
    const addScoresInvalidFingerprint = createInteraction(OWNER, {
      function: 'addScores',
      timestamp,
      scores: [{
        score: BigInt(1000),
        address: ALICE,
        fingerprint: fingerprintA.toLowerCase()
      }]
    })

    expect(
      () => DistributionHandle(initState, addScoresNoScore)
    ).to.throw(ContractError, INVALID_SCORES)
    expect(
      () => DistributionHandle(initState, addScoresNegativeScore)
    ).to.throw(ContractError, INVALID_SCORES)
    expect(
      () => DistributionHandle(initState, addScoresNoAddress)
    ).to.throw(ContractError, INVALID_SCORES)
    expect(
      () => DistributionHandle(initState, addScoresInvalidAddress)
    ).to.throw(ContractError, INVALID_SCORES)
    expect(
      () => DistributionHandle(initState, addScoresNoChecksumAddress)
    ).to.throw(ContractError, INVALID_SCORES)
    expect(
      () => DistributionHandle(initState, addScoresNoFingerprint)
    ).to.throw(ContractError, INVALID_SCORES)
    expect(
      () => DistributionHandle(initState, addScoresInvalidFingerprint)
    ).to.throw(ContractError, INVALID_SCORES)
  })

  it('Adding scores requires unique fingerprints', () => {
    const addDuplicateFingerprintScores = createInteraction(OWNER, {
      function: 'addScores',
      timestamp: Date.now().toString(),
      scores: [
        { score: BigInt(100), address: ALICE, fingerprint: fingerprintA },
        { score: BigInt(100), address: BOB, fingerprint: fingerprintB },
        { score: BigInt(100), address: ALICE, fingerprint: fingerprintA }
      ]
    })

    expect(
      () => DistributionHandle(initState, addDuplicateFingerprintScores)
    ).to.throw(ContractError, DUPLICATE_FINGERPRINT_SCORES)
  })

  it('Prevents non-owners from adding scores', () => {
    const aliceAddScores = createInteraction(ALICE, { function: 'addScores' })

    expect(
      () => DistributionHandle(initState, aliceAddScores)
    ).to.throw(ContractError, ERROR_ONLY_OWNER)
  })

  it('Allows owner to distribute token claims', () => {
    const timestamp = Date.now().toString()
    const addScores = createInteraction(OWNER, {
      function: 'addScores',
      timestamp,
      scores: [
        { score: BigInt(1000), address: ALICE, fingerprint: fingerprintA }
      ]
    })
    const distribute = createInteraction(OWNER, {
      function: 'distribute',
      timestamp
    })

    DistributionHandle(initState, addScores)
    const { state } = DistributionHandle(initState, distribute)

    expect(state.pendingDistributions).to.be.empty
    expect(state.claimable).to.deep.equal({ [ALICE]: BigInt(1000) })
  })

  it('Prevents non-owner from distributing token claims', () => {
    const aliceDistribute = createInteraction(ALICE, { function: 'distribute' })

    expect(
      () => DistributionHandle(initState, aliceDistribute)
    ).to.throw(ContractError, ERROR_ONLY_OWNER)
  })

  it('Distributing requires a timestamp', () => {
    const distributeNoTimestamp = createInteraction(OWNER, {
      function: 'distribute'
    })

    expect(
      () => DistributionHandle(initState, distributeNoTimestamp)
    ).to.throw(ContractError, INVALID_TIMESTAMP)
  })

  it('Distributing requires scores previously added for the timestamp', () => {
    const distributeNoAddedScores = createInteraction(OWNER, {
      function: 'distribute',
      timestamp: Date.now().toString()
    })

    expect(
      () => DistributionHandle(initState, distributeNoAddedScores)
    ).to.throw(ContractError, NO_PENDING_SCORES)
  })

  it('Allows owner to cancel a pending distribution', () => {
    const timestamp = Date.now().toString()
    const addScores = createInteraction(OWNER, {
      function: 'addScores',
      timestamp,
      scores: [
        { score: BigInt(100), address: ALICE, fingerprint: fingerprintA },
        { score: BigInt(100), address: BOB, fingerprint: fingerprintB }
      ]
    })
    const cancelDistribution = createInteraction(OWNER, {
      function: 'cancelDistribution',
      timestamp
    })

    DistributionHandle(initState, addScores)
    const { state } = DistributionHandle(initState, cancelDistribution)

    expect(state.pendingDistributions).to.deep.equal({})
  })

  it('Canceling a distribution requires a valid timestamp', () => {
    const cancelNoTimestamp = createInteraction(OWNER, {
      function: 'cancelDistribution'
    })
    const cancelNotExistTimestamp = createInteraction(OWNER, {
      function: 'cancelDistribution',
      timestamp: Date.now().toString()
    })

    expect(
      () => DistributionHandle(initState, cancelNoTimestamp)
    ).to.throw(ContractError, INVALID_TIMESTAMP)
    expect(
      () => DistributionHandle(initState, cancelNotExistTimestamp)
    ).to.throw(ContractError, NO_DISTRIBUTION_TO_CANCEL)
  })

  it('Prevents non-owners from cancelling a pending distribution', () => {
    const aliceCancelDistribution = createInteraction(ALICE, {
      function: 'cancelDistribution',
      timestamp: Date.now().toString()
    })

    expect(
      () => DistributionHandle(initState, aliceCancelDistribution)
    ).to.throw(ContractError, ERROR_ONLY_OWNER)
  })

  it('Previously distributed score sets should be immutable after distribution')
  it('TODO -> distribution calcs')
  it('TODO -> distribution edge cases')
})
