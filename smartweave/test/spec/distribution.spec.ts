import 'mocha'
import { expect } from 'chai'
import { ContractError, ContractInteraction } from 'warp-contracts'

import {
  ADDRESS_REQUIRED,
  CANNOT_BACKDATE_SCORES,
  DUPLICATE_FINGERPRINT_SCORES,
  DistributionHandle,
  DistributionState,
  INVALID_ADDRESS,
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
const fingerprintC = 'CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC'
const DEFAULT_TOKENS_PER_SECOND = '1000'

let initState: DistributionState
function resetState() {
  initState = {
    owner: OWNER,
    tokensDistributedPerSecond: DEFAULT_TOKENS_PER_SECOND,
    pendingDistributions: {},
    claimable: {},
    previousDistributions: {}
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
    const tokensDistributedPerSecond = '200'
    const setTokenDistributionRate = createInteraction(OWNER, {
      function: 'setTokenDistributionRate',
      tokensDistributedPerSecond
    })

    const { state } = DistributionHandle(initState, setTokenDistributionRate)

    expect(state.tokensDistributedPerSecond).to.equal(
      tokensDistributedPerSecond
    )
  })

  it('Validates when setting distribution amount', () => {
    const setMissingDistributionAmount = createInteraction(OWNER, {
      function: 'setTokenDistributionRate'
    })
    const negativeDistributionAmount = '-100'
    const setNegativeDistributionAmount = createInteraction(OWNER, {
      function: 'setTokenDistributionRate',
      tokensDistributedPerSecond: negativeDistributionAmount
    })
    const numberDistributionAmount = 100
    const setNumberDistributionAmount = createInteraction(OWNER, {
      function: 'setTokenDistributionRate',
      tokensDistributedPerSecond: numberDistributionAmount
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
      function: 'setTokenDistributionRate',
      tokensDistributedPerSecond: BigInt(500)
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
        { score: '1000', address: ALICE, fingerprint: fingerprintA }
      ]
    })

    const { state } = DistributionHandle(initState, ownerAddScores)

    expect(state.pendingDistributions).to.deep.equal({
      [timestamp]: [
        { score: '1000', address: ALICE, fingerprint: fingerprintA }
      ]
    })
  })

  it('Requires a valid timestamp when adding scores', () => {
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

  it('Requires at least one score when adding scores', () => {
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

  it('Requires added scores be valid (score, address, fingerprint)', () => {
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

  it('Requires added scores have unique fingerprints', () => {
    const addDuplicateFingerprintScores = createInteraction(OWNER, {
      function: 'addScores',
      timestamp: Date.now().toString(),
      scores: [
        { score: '100', address: ALICE, fingerprint: fingerprintA },
        { score: '100', address: BOB, fingerprint: fingerprintB },
        { score: '100', address: ALICE, fingerprint: fingerprintA }
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
        { score: '100', address: ALICE, fingerprint: fingerprintA }
      ]
    })
    const distribute = createInteraction(OWNER, {
      function: 'distribute',
      timestamp
    })

    DistributionHandle(initState, addScores)
    const { state } = DistributionHandle(initState, distribute)

    expect(state.pendingDistributions).to.be.empty
    expect(state.previousDistributions).to.deep.equal({
      [timestamp]: {
        totalScore: '100',
        timeElapsed: '0',
        totalDistributed: '0',
        tokensDistributedPerSecond: '1000'
      }
    })
  })

  it('Prevents non-owner from distributing token claims', () => {
    const aliceDistribute = createInteraction(ALICE, { function: 'distribute' })

    expect(
      () => DistributionHandle(initState, aliceDistribute)
    ).to.throw(ContractError, ERROR_ONLY_OWNER)
  })

  it('Requires a valid timestamp to distribute', () => {
    const distributeNoTimestamp = createInteraction(OWNER, {
      function: 'distribute'
    })

    expect(
      () => DistributionHandle(initState, distributeNoTimestamp)
    ).to.throw(ContractError, INVALID_TIMESTAMP)
  })

  it('Requires previously added scores to distribute', () => {
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
        { score: '100', address: ALICE, fingerprint: fingerprintA },
        { score: '100', address: BOB, fingerprint: fingerprintB }
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

  it('Prevents adding of backdated scores and backdating distributions', () => {
    const now = Date.now()
    const timestamp = now.toString()
    const addScores = createInteraction(OWNER, {
      function: 'addScores',
      timestamp,
      scores: [
        { score: '100', address: ALICE, fingerprint: fingerprintA }
      ]
    })
    const distribute = createInteraction(OWNER, {
      function: 'distribute',
      timestamp
    })
    const backdatedTimestamp = (now - 10000).toString()
    const addScoresBackdated = createInteraction(OWNER, {
      function: 'addScores',
      timestamp: backdatedTimestamp,
      scores: [
        { score: '100', address: BOB, fingerprint: fingerprintB }
      ]
    })
    const distributeBackdated = createInteraction(OWNER, {
      function: 'distribute',
      timestamp: backdatedTimestamp
    })

    DistributionHandle(initState, addScores)
    DistributionHandle(initState, distribute)

    expect(
      () => DistributionHandle(initState, addScoresBackdated)
    ).to.throw(ContractError, CANNOT_BACKDATE_SCORES)
    expect(
      () => DistributionHandle(initState, distributeBackdated)
    ).to.throw(ContractError, NO_PENDING_SCORES)
  })
  
  it('Should not add claimable tokens on initial distribution', () => {
    const timestamp = Date.now().toString()
    const addScores = createInteraction(OWNER, {
      function: 'addScores',
      timestamp,
      scores: [
        { score: '100', address: ALICE, fingerprint: fingerprintA }
      ]
    })
    const distribute = createInteraction(OWNER, {
      function: 'distribute',
      timestamp
    })

    DistributionHandle(initState, addScores)
    const { state } = DistributionHandle(initState, distribute)

    expect(state.claimable).to.deep.equal({})
  })

  it('Should add claimable tokens on subsequent distributions', () => {
    const timeBetweenDistributions = 1000
    const now = Date.now()
    const firstTimestamp = now.toString()
    const firstAliceScore = '100'
    const firstAddScores = createInteraction(OWNER, {
      function: 'addScores',
      timestamp: firstTimestamp,
      scores: [
        { score: firstAliceScore, address: ALICE, fingerprint: fingerprintA }
      ]
    })
    const firstDistribute = createInteraction(OWNER, {
      function: 'distribute',
      timestamp: firstTimestamp
    })
    const secondTimestamp = (now + timeBetweenDistributions).toString()
    const secondAliceScore = '500'
    const secondAddScores = createInteraction(OWNER, {
      function: 'addScores',
      timestamp: secondTimestamp,
      scores: [
        { score: secondAliceScore, address: ALICE, fingerprint: fingerprintA }
      ]
    })
    const secondDistribute = createInteraction(OWNER, {
      function: 'distribute',
      timestamp: secondTimestamp
    })

    DistributionHandle(initState, firstAddScores)
    DistributionHandle(initState, firstDistribute)
    DistributionHandle(initState, secondAddScores)
    const { state } = DistributionHandle(initState, secondDistribute)

    expect(state.pendingDistributions).to.be.empty
    expect(state.previousDistributions).to.deep.equal({
      [firstTimestamp]: {
        timeElapsed: '0',
        tokensDistributedPerSecond: DEFAULT_TOKENS_PER_SECOND,
        totalDistributed: '0',
        totalScore: '100'
      },
      [secondTimestamp]: {
        timeElapsed: timeBetweenDistributions.toString(),
        tokensDistributedPerSecond: DEFAULT_TOKENS_PER_SECOND,
        totalDistributed: '1000',
        totalScore: '500'
      }
    })
    expect(state.claimable).to.deep.equal({
      [ALICE]: DEFAULT_TOKENS_PER_SECOND
    })
  })
  
  it('Provides a view method for claimable tokens by address', () => {
    const aliceClaimable = createInteraction(ALICE, {
      function: 'claimable',
      address: ALICE
    }, 'view')

    const { state, result } = DistributionHandle(
      { ...initState, claimable: { [ALICE]: '1000' } },
      aliceClaimable
    )

    expect(result).to.equal('1000')
  })

  it('Requires a valid address when viewing claimable tokens', () => {
    const undefinedClaimable = createInteraction(ALICE, {
      function: 'claimable'
    }, 'view')
    const objectClaimable = createInteraction(ALICE, {
      function: 'claimable',
      address: { address: ALICE }
    })
    const invalidAddressClaimable = createInteraction(ALICE, {
      function: 'claimable',
      address: 'invalid-address'
    })

    expect(
      () => DistributionHandle(initState, undefinedClaimable)
    ).to.throw(ContractError, ADDRESS_REQUIRED)
    expect(
      () => DistributionHandle(initState, objectClaimable)
    ).to.throw(ContractError, INVALID_ADDRESS)
    expect(
      () => DistributionHandle(initState, invalidAddressClaimable)
    ).to.throw(ContractError, INVALID_ADDRESS)
  })

  it('Should roll up scores by same owner on distribution', () => {
    const timeDifference = 1000
    const now = Date.now()
    const firstTimestamp = now.toString()
    const secondTimestamp = (now + timeDifference).toString()
    const firstAddScores = createInteraction(OWNER, {
      function: 'addScores',
      timestamp: firstTimestamp,
      scores: [
        { score: '100', address: ALICE, fingerprint: fingerprintA },
        { score: '100', address: BOB, fingerprint: fingerprintB },
        { score: '100', address: ALICE, fingerprint: fingerprintC }
      ]
    })
    const firstDistribute = createInteraction(OWNER, {
      function: 'distribute',
      timestamp: firstTimestamp
    })

    const secondAddScores = createInteraction(OWNER, {
      function: 'addScores',
      timestamp: secondTimestamp,
      scores: [
        { score: '75', address: ALICE, fingerprint: fingerprintA },
        { score: '1337', address: BOB, fingerprint: fingerprintB },
        { score: '657', address: ALICE, fingerprint: fingerprintC }
      ]
    })
    const secondDistribute = createInteraction(OWNER, {
      function: 'distribute',
      timestamp: secondTimestamp
    })

    DistributionHandle(initState, firstAddScores)
    DistributionHandle(initState, firstDistribute)
    DistributionHandle(initState, secondAddScores)
    const { state } = DistributionHandle(initState, secondDistribute)

    expect(state.claimable).to.deep.equal({
      [ALICE]: '353',
      [BOB]: '646'
    })
  })

  it('Should scale distribution by time since last distribution', () => {
    const firstTimeDifference = 5432
    const secondTimeDifference = 86400
    const now = Date.now()
    const firstTimestamp = now.toString()
    const secondTimestamp = (now + firstTimeDifference).toString()
    const thirdTimestamp = (
      now + firstTimeDifference + secondTimeDifference
    ).toString()
    const firstAddScores = createInteraction(OWNER, {
      function: 'addScores',
      timestamp: firstTimestamp,
      scores: [
        { score: '100', address: ALICE, fingerprint: fingerprintA },
        { score: '100', address: BOB, fingerprint: fingerprintB },
        { score: '100', address: ALICE, fingerprint: fingerprintC }
      ]
    })
    const firstDistribute = createInteraction(OWNER, {
      function: 'distribute',
      timestamp: firstTimestamp
    })
    const secondAddScores = createInteraction(OWNER, {
      function: 'addScores',
      timestamp: secondTimestamp,
      scores: [
        { score: '75', address: ALICE, fingerprint: fingerprintA },
        { score: '1337', address: BOB, fingerprint: fingerprintB },
        { score: '657', address: ALICE, fingerprint: fingerprintC }
      ]
    }) // total = 2069, alice = 0.353794, bob = 0.646206
    const secondDistribute = createInteraction(OWNER, {
      function: 'distribute',
      timestamp: secondTimestamp
    })
    const thirdAddScores = createInteraction(OWNER, {
      function: 'addScores',
      timestamp: thirdTimestamp,
      scores: [
        { score: '254', address: ALICE, fingerprint: fingerprintA },
        { score: '5676', address: BOB, fingerprint: fingerprintB },
        { score: '2232', address: ALICE, fingerprint: fingerprintC },
      ]
    })
    const thirdDistribute = createInteraction(OWNER, {
      function: 'distribute',
      timestamp: thirdTimestamp
    })
    
    DistributionHandle(initState, firstAddScores)
    DistributionHandle(initState, firstDistribute)
    DistributionHandle(initState, secondAddScores)
    DistributionHandle(initState, secondDistribute)
    DistributionHandle(initState, thirdAddScores)
    const { state } = DistributionHandle(initState, thirdDistribute)

    expect(state.claimable).to.deep.equal({
      [ALICE]: '28235',
      [BOB]: '63594'
    })
    expect(state.previousDistributions).to.deep.equal({
      [firstTimestamp]: {
        timeElapsed: '0',
        tokensDistributedPerSecond: DEFAULT_TOKENS_PER_SECOND,
        totalDistributed: '0',
        totalScore: '300'
      },
      [secondTimestamp]: {
        timeElapsed: firstTimeDifference.toString(),
        tokensDistributedPerSecond: DEFAULT_TOKENS_PER_SECOND,
        totalDistributed: '5430',
        totalScore: '2069'
      },
      [thirdTimestamp]: {
        timeElapsed: (secondTimeDifference).toString(),
        tokensDistributedPerSecond: DEFAULT_TOKENS_PER_SECOND,
        totalDistributed: '86399',
        totalScore: '8162'
      }
    })
    expect(state.pendingDistributions).to.be.empty
  })

  it('Allows distributions faster than assumed 1 second rate', () => {
    const timeDifference = 443
    const now = Date.now()
    const firstTimestamp = now.toString()
    const secondTimestamp = (now + timeDifference).toString()
    const newDistributionAmount = '4333'
    const setNewDistributionAmount = createInteraction(OWNER, {
      function: 'setTokenDistributionRate',
      tokensDistributedPerSecond: newDistributionAmount
    })
    const firstAddScores = createInteraction(OWNER, {
      function: 'addScores',
      timestamp: firstTimestamp,
      scores: [
        { score: '100', address: ALICE, fingerprint: fingerprintA },
        { score: '100', address: BOB, fingerprint: fingerprintB },
        { score: '100', address: ALICE, fingerprint: fingerprintC }
      ]
    })
    const firstDistribute = createInteraction(OWNER, {
      function: 'distribute',
      timestamp: firstTimestamp
    })
    const secondAddScores = createInteraction(OWNER, {
      function: 'addScores',
      timestamp: secondTimestamp,
      scores: [
        { score: '75', address: ALICE, fingerprint: fingerprintA },
        { score: '1337', address: BOB, fingerprint: fingerprintB },
        { score: '657', address: ALICE, fingerprint: fingerprintC }
      ]
    }) // total = 2069, alice = 0.353794, bob = 0.646206
    const secondDistribute = createInteraction(OWNER, {
      function: 'distribute',
      timestamp: secondTimestamp
    })

    DistributionHandle(initState, setNewDistributionAmount)
    DistributionHandle(initState, firstAddScores)
    DistributionHandle(initState, firstDistribute)
    DistributionHandle(initState, secondAddScores)
    const { state } = DistributionHandle(initState, secondDistribute)

    expect(state.claimable).to.deep.equal({
      [ALICE]:  '678',   // ~  679.114
      [BOB]:   '1240'    // ~ 1240.405
    })
    expect(state.previousDistributions).to.deep.equal({
      [firstTimestamp]: {
        timeElapsed: '0',
        tokensDistributedPerSecond: '4333',
        totalDistributed: '0',
        totalScore: '300'
      },
      // 4333 tps rate over 443ms ~= 1,919.519 tokens
      [secondTimestamp]: {
        timeElapsed: '443',
        tokensDistributedPerSecond: '4333',
        totalDistributed: '1918',
        totalScore: '2069'
      }
    })
    expect(state.pendingDistributions).to.be.empty
  })
})
