import 'mocha'
import { expect } from 'chai'
import { ContractError, ContractInteraction } from 'warp-contracts'

import {
  CANNOT_BACKDATE_SCORES,
  DUPLICATE_FINGERPRINT_SCORES,
  DistributionHandle,
  DistributionState,
  INVALID_DISTRIBUTION_AMOUNT,
  INVALID_SCORES,
  INVALID_TIMESTAMP,
  NO_DISTRIBUTION_TO_CANCEL,
  NO_PENDING_SCORES,
  VALID_BONUS_NAME_REQUIRED
} from '../../src/contracts'
import { ERROR_ONLY_OWNER, INVALID_INPUT } from '../../src/util'
import {
  ADDRESS_REQUIRED,
  DUPLICATE_FINGERPRINT,
  ENABLED_REQUIRED,
  FINGERPRINT_REQUIRED,
  INVALID_ADDRESS,
  INVALID_FINGERPRINT,
  INVALID_FAMILY,
  FAMILIES_REQUIRED
} from '../../src/common/errors'
import {
  INVALID_FAMILY_MULTIPLIER_RATE,
  INVALID_LIMIT,
  INVALID_QUALITY_BONUS_SETTINGS,
  INVALID_UPTIMES
} from '../../src/contracts/distribution'
import TestScoresHWBonuses from '../e2e/data/scores_hw_bonuses.json'
import TestResultsHWBonuses from '../e2e/data/results_hw_bonuses.json'
import TestFamilies from '../e2e/data/families.json'
import TestScoresFamilyMultiplier
  from '../e2e/data/scores_family_multipliers.json'
import TestResultsFamilyMultiplier
  from '../e2e/data/results_family_multipliers.json'
import TestScoresQualityBonus from '../e2e/data/scores_quality_bonuses.json'
import TestResultsQualityBonus from '../e2e/data/results_quality_bonuses.json'


const OWNER  = '0x1111111111111111111111111111111111111111'
const ALICE  = '0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa'
const BOB    = '0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB'
const fingerprintA = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
const fingerprintB = 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB'
const fingerprintC = 'CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC'
const fingerprintD = 'DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD'
const DEFAULT_TOKENS_PER_SECOND = '1000'
const DEFAULT_QUALITY_BONUS_SETTINGS = {
  [ 3]: 1, // NB: At least  3 days uptime => 1 point
  [ 8]: 2, // NB: At least  8 days uptime => 2 points
  [22]: 4  // NB: At least 22 days uptime => 4 points
}

let initState: DistributionState
function resetState() {
  initState = {
    owner: OWNER,
    tokensDistributedPerSecond: DEFAULT_TOKENS_PER_SECOND,
    pendingDistributions: {},
    claimable: {},
    previousDistributions: {},
    previousDistributionsTrackingLimit: 10,
    bonuses: {
      hardware: {
        enabled: false,
        tokensDistributedPerSecond: '0',
        fingerprints: []
      },
      quality: {
        enabled: false,
        tokensDistributedPerSecond: '0',
        settings: {
          uptime: {}
        },
        uptime: {}
      }
    },
    families: {},
    multipliers: {
      family: {
        enabled: false,
        familyMultiplierRate: '0'
      }
    }
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

  it('Throws on invalid input', () => {
    expect(
      () => DistributionHandle(initState, { caller: OWNER, input: {} } as any)
    ).to.throw(ContractError, INVALID_INPUT)
  })

  it('Ensures state properties after evolution', () => {
    const setTokenDistributionRate = createInteraction(OWNER, {
      function: 'setTokenDistributionRate',
      tokensDistributedPerSecond: '1000'
    })

    const { state } = DistributionHandle(
      { owner: OWNER } as any,
      setTokenDistributionRate
    )

    expect(state.tokensDistributedPerSecond).to.exist
    expect(state.pendingDistributions).to.exist
    expect(state.claimable).to.exist
    expect(state.previousDistributions).to.exist
    expect(state.previousDistributionsTrackingLimit).to.exist
    expect(state.bonuses).to.exist
    expect(state.bonuses.hardware).to.exist
    expect(state.bonuses.hardware.enabled).to.be.a('boolean')
    expect(state.bonuses.hardware.tokensDistributedPerSecond).to.be.a('string')
    expect(state.bonuses.hardware.fingerprints).to.be.an('array')
    expect(state.families).to.exist
    expect(state.multipliers).to.exist
    expect(state.multipliers.family).to.exist
    expect(state.multipliers.family.enabled).to.be.a('boolean')
    expect(state.multipliers.family.familyMultiplierRate).to.be.a('string')
  })

  describe('Setting Distribution Amount', () => {
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

      expect(
        () => DistributionHandle(initState, setMissingDistributionAmount)
      ).to.throw(ContractError, INVALID_DISTRIBUTION_AMOUNT)

      const negativeDistributionAmount = '-100'
      const setNegativeDistributionAmount = createInteraction(OWNER, {
        function: 'setTokenDistributionRate',
        tokensDistributedPerSecond: negativeDistributionAmount
      })

      expect(
        () => DistributionHandle(initState, setNegativeDistributionAmount)
      ).to.throw(ContractError, INVALID_DISTRIBUTION_AMOUNT)

      const numberDistributionAmount = 100
      const setNumberDistributionAmount = createInteraction(OWNER, {
        function: 'setTokenDistributionRate',
        tokensDistributedPerSecond: numberDistributionAmount
      })
      
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
  })

  describe('Adding Scores', () => {
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
        [timestamp]: {
          scores: [
            { score: '1000', address: ALICE, fingerprint: fingerprintA }
          ]
        }
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
  })

  describe('Families', () => {
    it('Allows Owner to set relay families', () => {
      const setFamilies = createInteraction(OWNER, {
        function: 'setFamilies',
        families: [
          {
            fingerprint: fingerprintA,
            add: [ fingerprintA, fingerprintB, fingerprintC ]
          },
          {
            fingerprint: fingerprintB,
            add: [ fingerprintA, fingerprintB, fingerprintC ]
          },
          {
            fingerprint: fingerprintC,
            add: [ fingerprintA, fingerprintB, fingerprintC ]
          }
        ]
      })

      const { state: firstState } = DistributionHandle(initState, setFamilies)

      expect(firstState.families).to.deep.equal({
        [fingerprintA]: [ fingerprintA, fingerprintB, fingerprintC ],
        [fingerprintB]: [ fingerprintA, fingerprintB, fingerprintC ],
        [fingerprintC]: [ fingerprintA, fingerprintB, fingerprintC ]
      })

      const setMoreFamilies = createInteraction(OWNER, {
        function: 'setFamilies',
        families: [
          {
            fingerprint: fingerprintA,
            add: [ fingerprintD ],
            remove: [ fingerprintB ]
          },
          {
            fingerprint: fingerprintB,
            remove: [ fingerprintA, fingerprintC ]
          },
          {
            fingerprint: fingerprintC,
            add: [ fingerprintD ],
            remove: [ fingerprintB ]
          },
          {
            fingerprint: fingerprintD,
            add: [ fingerprintA, fingerprintC, fingerprintD ]
          }
        ]
      })

      const { state: secondState } = DistributionHandle(
        firstState,
        setMoreFamilies
      )

      expect(secondState.families).to.deep.equal({
        [fingerprintA]: [ fingerprintA, fingerprintC, fingerprintD ],
        [fingerprintB]: [ fingerprintB ],
        [fingerprintC]: [ fingerprintA, fingerprintC, fingerprintD ],
        [fingerprintD]: [ fingerprintA, fingerprintC, fingerprintD ]
      })
    })

    it('Prevents non-owners from setting relay families', () => {
      const aliceSetFamilies = createInteraction(ALICE, {
        function: 'setFamilies',
        families: [
          {
            fingerprint: fingerprintA,
            add: [ fingerprintC ],
            remove: []
          },
          {
            fingerprint: fingerprintC,
            add: [ fingerprintA ],
            remove: []
          }
        ]
      })

      expect(
        () => DistributionHandle(initState, aliceSetFamilies)
      ).to.throw(ERROR_ONLY_OWNER)
    })

    it('Validates when setting relay families', () => {
      const missingFamilies = createInteraction(OWNER, {
        function: 'setFamilies'      
      })

      expect(
        () => DistributionHandle(initState, missingFamilies)
      ).to.throw(FAMILIES_REQUIRED)

      const noFamilies = createInteraction(OWNER, {
        function: 'setFamilies',
        families: []
      })

      expect(
        () => DistributionHandle(initState, noFamilies)
      ).to.throw(FAMILIES_REQUIRED)

      const nonArrayFamilies = createInteraction(OWNER, {
        function: 'setFamilies',
        families: { weewoo: 'boop' }
      })

      expect(
        () => DistributionHandle(initState, nonArrayFamilies)
      ).to.throw(FAMILIES_REQUIRED)

      const noFingerprintFamily = createInteraction(OWNER, {
        function: 'setFamilies',
        families: [{
          add: []
        }]
      })

      expect(
        () => DistributionHandle(initState, noFingerprintFamily)
      ).to.throw(FINGERPRINT_REQUIRED)

      const invalidFingerprintFamily = createInteraction(OWNER, {
        function: 'setFamilies',
        families: [{
          fingerprint: 'invalid',
          add: []
        }]
      })

      expect(
        () => DistributionHandle(initState, invalidFingerprintFamily)
      ).to.throw(INVALID_FINGERPRINT)

      const nonStringFingerprintFamily = createInteraction(OWNER, {
        function: 'setFamilies',
        families: [{
          fingerprint: {},
          add: []
        }]
      })

      expect(
        () => DistributionHandle(initState, nonStringFingerprintFamily)
      ).to.throw(INVALID_FINGERPRINT)

      const noFamilyFamily = createInteraction(OWNER, {
        function: 'setFamilies',
        families: [{
          fingerprint: fingerprintA
        }]
      })

      expect(
        () => DistributionHandle(initState, noFamilyFamily)
      ).to.throw(INVALID_FAMILY)

      const invalidFamilyFingerprintsFamily = createInteraction(OWNER, {
        function: 'setFamilies',
        families: [{
          fingerprint: fingerprintA,
          add: [{}, 1, undefined, null, 'invalid']
        }]
      })

      expect(
        () => DistributionHandle(initState, invalidFamilyFingerprintsFamily)
      ).to.throw(INVALID_FINGERPRINT)

      const someInvalidFamilyFingerprintsFamily = createInteraction(OWNER, {
        function: 'setFamilies',
        families: [{
          fingerprint: fingerprintA,
          remove: [fingerprintC, 'invalid', null]
        }]
      })

      expect(
        () => DistributionHandle(
          initState,
          someInvalidFamilyFingerprintsFamily
        )
      ).to.throw(INVALID_FINGERPRINT)
    })

    it('Throws when adding duplicate fingerprints to a relay family', () => {
      const addDuplicateFamilyFingerprint = createInteraction(OWNER, {
        function: 'setFamilies',
        families: [
          {
            fingerprint: fingerprintA,
            add: [ fingerprintB ]
          },
          {
            fingerprint: fingerprintB,
            add: [ fingerprintA ]
          }
        ]
      })

      expect(
        () => DistributionHandle(
          {
            ...initState,
            families: {
              [fingerprintB]: [ fingerprintA ]
            }
          },
          addDuplicateFamilyFingerprint
        )
      ).to.throw(DUPLICATE_FINGERPRINT)
    })
  })

  describe('Multipliers', () => {
    it('Allows Owner to set family multiplier rate', () => {
      const familyMultiplierRate = '0.1'
      const setFamilyMultiplierRate = createInteraction(OWNER, {
        function: 'setFamilyMultiplierRate',
        familyMultiplierRate
      })

      const { state } = DistributionHandle(initState, setFamilyMultiplierRate)

      expect(
        state.multipliers.family.familyMultiplierRate
      ).to.equal(familyMultiplierRate)
    })

    it('Prevents non-owners from setting family multiplier rate', () => {
      const aliceSetFamilyMultiplierRate = createInteraction(ALICE, {
        function: 'setFamilyMultiplierRate',
        familyMultiplierRate: '1'
      })

      expect(
        () => DistributionHandle(initState, aliceSetFamilyMultiplierRate)
      ).to.throw(ERROR_ONLY_OWNER)
    })

    it('Validates when setting family multiplier rate', () => {
      const missingFamilyMultiplierRate = createInteraction(OWNER, {
        function: 'setFamilyMultiplierRate'
      })

      expect(
        () => DistributionHandle(initState, missingFamilyMultiplierRate)
      ).to.throw(INVALID_FAMILY_MULTIPLIER_RATE)

      const numberFamilyMultiplierRate = createInteraction(OWNER, {
        function: 'setFamilyMultiplierRate',
        familyMultiplierRate: 1
      })

      expect(
        () => DistributionHandle(initState, numberFamilyMultiplierRate)
      ).to.throw(INVALID_FAMILY_MULTIPLIER_RATE)

      const objectFamilyMultiplierRate = createInteraction(OWNER, {
        function: 'setFamilyMultiplierRate',
        familyMultiplierRate: { rate: 1 }
      })

      expect(
        () => DistributionHandle(initState, objectFamilyMultiplierRate)
      ).to.throw(INVALID_FAMILY_MULTIPLIER_RATE)

      const negativeFamilyMultiplierRate = createInteraction(OWNER, {
        function: 'setFamilyMultiplierRate',
        familyMultiplierRate: '-2'
      })

      expect(
        () => DistributionHandle(initState, negativeFamilyMultiplierRate)
      ).to.throw(INVALID_FAMILY_MULTIPLIER_RATE)

      const nanFamilyMultiplierRate = createInteraction(OWNER, {
        function: 'setFamilyMultiplierRate',
        familyMultiplierRate: 'hello'
      })

      expect(
        () => DistributionHandle(initState, nanFamilyMultiplierRate)
      ).to.throw(INVALID_FAMILY_MULTIPLIER_RATE)

      const infinityMultiplierRate = createInteraction(OWNER, {
        function: 'setFamilyMultiplierRate',
        familyMultiplierRate: 'Infinity'
      })

      expect(
        () => DistributionHandle(initState, infinityMultiplierRate)
      ).to.throw(INVALID_FAMILY_MULTIPLIER_RATE)
    })

    it('Allows Owner to toggle family multipliers', () => {
      const enableFamilyMultipliers = createInteraction(OWNER, {
        function: 'toggleFamilyMultipliers',
        enabled: true
      })

      const {
        state: enabledState
      } = DistributionHandle(initState, enableFamilyMultipliers)

      expect(enabledState.multipliers.family.enabled).to.be.true

      const disableFamilyMultipliers = createInteraction(OWNER, {
        function: 'toggleFamilyMultipliers',
        enabled: false
      })

      const {
        state: disabledState
      } = DistributionHandle(initState, disableFamilyMultipliers)

      expect(disabledState.multipliers.family.enabled).to.be.false
    })

    it('Prevents non-owners from toggling family multipliers', () => {
      const aliceToggleFamilyMultipliers = createInteraction(ALICE, {
        function: 'toggleFamilyMultipliers',
        enabled: true
      })

      expect(
        () => DistributionHandle(initState, aliceToggleFamilyMultipliers)
      ).to.throw(ERROR_ONLY_OWNER)
    })

    it('Validates when toggling family multipliers', () => {
      const undefinedToggle = createInteraction(OWNER, {
        function: 'toggleFamilyMultipliers'
      })

      expect(
        () => DistributionHandle(initState, undefinedToggle)
      ).to.throw(ENABLED_REQUIRED)

      const zeroToggle = createInteraction(OWNER, {
        function: 'toggleFamilyMultipliers',
        enabled: 0
      })

      expect(
        () => DistributionHandle(initState, zeroToggle)
      ).to.throw(ENABLED_REQUIRED)

      const positiveToggle = createInteraction(OWNER, {
        function: 'toggleFamilyMultipliers',
        enabled: 12
      })

      expect(
        () => DistributionHandle(initState, positiveToggle)
      ).to.throw(ENABLED_REQUIRED)

      const objectToggle = createInteraction(OWNER, {
        function: 'toggleFamilyMultipliers',
        enabled: { enabled: true }
      })

      expect(
        () => DistributionHandle(initState, objectToggle)
      ).to.throw(ENABLED_REQUIRED)

      const stringToggle = createInteraction(OWNER, {
        function: 'toggleFamilyMultipliers',
        enabled: 'true'
      })

      expect(
        () => DistributionHandle(initState, stringToggle)
      ).to.throw(ENABLED_REQUIRED)
    })
  })

  describe('Bonuses', () => {
    describe('Hardware', () => {
      it('Allows Owner to set hardware bonus token rate', () => {
        const tokensDistributedPerSecond = '200'
        const setHardwareBonusRate = createInteraction(OWNER, {
          function: 'setHardwareBonusRate',
          tokensDistributedPerSecond
        })
    
        const { state } = DistributionHandle(initState, setHardwareBonusRate)
    
        expect(state.bonuses.hardware.tokensDistributedPerSecond).to.equal(
          tokensDistributedPerSecond
        )
      })

      it('Validates when setting hardware bonus token rate', () => {
        const setMissingRate = createInteraction(OWNER, {
          function: 'setHardwareBonusRate'
        })
  
        expect(
          () => DistributionHandle(initState, setMissingRate)
        ).to.throw(ContractError, INVALID_DISTRIBUTION_AMOUNT)
  
        const negativeDistributionAmount = '-100'
        const setNegativeDistributionAmount = createInteraction(OWNER, {
          function: 'setHardwareBonusRate',
          tokensDistributedPerSecond: negativeDistributionAmount
        })
  
        expect(
          () => DistributionHandle(initState, setNegativeDistributionAmount)
        ).to.throw(ContractError, INVALID_DISTRIBUTION_AMOUNT)
  
        const numberDistributionAmount = 100
        const setNumberDistributionAmount = createInteraction(OWNER, {
          function: 'setHardwareBonusRate',
          tokensDistributedPerSecond: numberDistributionAmount
        })
        
        expect(
          () => DistributionHandle(initState, setNumberDistributionAmount)
        ).to.throw(ContractError, INVALID_DISTRIBUTION_AMOUNT)
      })

      it('Prevents non-owners from setting hardware bonus token rate', () => {
        const aliceSetHardwareBonusRate = createInteraction(ALICE, {
          function: 'setHardwareBonusRate',
          tokensDistributedPerSecond: '1000'
        })
  
        expect(
          () => DistributionHandle(initState, aliceSetHardwareBonusRate)
        ).to.throw(ContractError, ERROR_ONLY_OWNER)
      })

      it('Allows Owner to enable hardware bonus', () => {
        const enabled = true
        const toggleHardwareBonus = createInteraction(OWNER, {
          function: 'toggleHardwareBonus',
          enabled
        })

        const { state } = DistributionHandle(initState, toggleHardwareBonus)

        expect(state.bonuses.hardware.enabled).to.equal(enabled)
      })

      it('Allows Owner to disable hardware bonus', () => {
        const enabled = false
        const toggleHardwareBonus = createInteraction(OWNER, {
          function: 'toggleHardwareBonus',
          enabled
        })

        const { state } = DistributionHandle(initState, toggleHardwareBonus)

        expect(state.bonuses.hardware.enabled).to.equal(enabled)
      })

      it('Validates when toggling hardware bonus', () => {
        const undefinedToggle = createInteraction(OWNER, {
          function: 'toggleHardwareBonus'
        })
  
        expect(
          () => DistributionHandle(initState, undefinedToggle)
        ).to.throw(ENABLED_REQUIRED)
  
        const zeroToggle = createInteraction(OWNER, {
          function: 'toggleHardwareBonus',
          enabled: 0
        })
  
        expect(
          () => DistributionHandle(initState, zeroToggle)
        ).to.throw(ENABLED_REQUIRED)
  
        const positiveToggle = createInteraction(OWNER, {
          function: 'toggleHardwareBonus',
          enabled: 12
        })
  
        expect(
          () => DistributionHandle(initState, positiveToggle)
        ).to.throw(ENABLED_REQUIRED)
  
        const objectToggle = createInteraction(OWNER, {
          function: 'toggleHardwareBonus',
          enabled: { enabled: true }
        })
  
        expect(
          () => DistributionHandle(initState, objectToggle)
        ).to.throw(ENABLED_REQUIRED)
  
        const stringToggle = createInteraction(OWNER, {
          function: 'toggleHardwareBonus',
          enabled: 'true'
        })
  
        expect(
          () => DistributionHandle(initState, stringToggle)
        ).to.throw(ENABLED_REQUIRED)
      })

      it('Prevents non-owners from toggling hardware bonus', () => {
        const aliceToggleHardwareBonus = createInteraction(ALICE, {
          function: 'toggleHardwareBonus',
          enabled: true
        })
  
        expect(
          () => DistributionHandle(initState, aliceToggleHardwareBonus)
        ).to.throw(ContractError, ERROR_ONLY_OWNER)
      })

      it('Allows Owner to add fingerprints to hardware bonus', () => {
        const fingerprints = [fingerprintA, fingerprintC]
        const addFingerprints = createInteraction(OWNER, {
          function: 'addFingerprintsToBonus',
          bonusName: 'hardware',
          fingerprints
        })

        const { state } = DistributionHandle(initState, addFingerprints)

        expect(state.bonuses.hardware.fingerprints).deep.equal(fingerprints)
      })

      it('Validates when adding fingerprints to hardware bonus', () => {
        const fingerprints = [fingerprintA, fingerprintC]

        const missingBonusName = createInteraction(OWNER, {
          function: 'addFingerprintsToBonus',
          fingerprints
        })

        expect(
          () => DistributionHandle(initState, missingBonusName)
        ).to.throw(VALID_BONUS_NAME_REQUIRED)

        const wrongBonusName = createInteraction(OWNER, {
          function: 'addFingerprintsToBonus',
          bonusName: 'special-bonus',
          fingerprints
        })

        expect(
          () => DistributionHandle(initState, wrongBonusName)
        ).to.throw(VALID_BONUS_NAME_REQUIRED)

        const badFingerprints = createInteraction(OWNER, {
          function: 'addFingerprintsToBonus',
          bonusName: 'hardware',
          fingerprints: ['bad-fingerprint', 123]
        })

        expect(
          () => DistributionHandle(initState, badFingerprints)
        ).to.throw(INVALID_FINGERPRINT)
      })

      it('Prevents non-owners from adding fingerprints to hw bonus', () => {
        const aliceAddFingerprints = createInteraction(ALICE, {
          function: 'addFingerprintsToBonus',
          bonusName: 'hardware',
          fingerprints: [fingerprintA]
        })

        expect(
          () => DistributionHandle(initState, aliceAddFingerprints)
        ).to.throw(ERROR_ONLY_OWNER)
      })

      it('Allows Owner to remove fingerprints from hardware bonus', () => {
        const fingerprints = [fingerprintA, fingerprintB, fingerprintC]
        const removeFingerprints = createInteraction(OWNER, {
          function: 'removeFingerprintsFromBonus',
          bonusName: 'hardware',
          fingerprints: [fingerprintB]
        })

        const { state } = DistributionHandle(
          {
            ...initState,
            bonuses: {
              hardware: {
                enabled: true,
                tokensDistributedPerSecond: '100',
                fingerprints
              },
              quality: {
                enabled: false,
                tokensDistributedPerSecond: '0',
                settings: {
                  uptime: {}
                },
                uptime: {}
              }
            }
          },
          removeFingerprints
        )

        expect(state.bonuses.hardware.fingerprints).deep.equal(
          [fingerprintA, fingerprintC]
        )
      })

      it('Validates when removing fingerprints from hardware bonus', () => {
        const fingerprints = [fingerprintA, fingerprintC]

        const missingBonusName = createInteraction(OWNER, {
          function: 'removeFingerprintsFromBonus',
          fingerprints
        })

        expect(
          () => DistributionHandle(initState, missingBonusName)
        ).to.throw(VALID_BONUS_NAME_REQUIRED)

        const wrongBonusName = createInteraction(OWNER, {
          function: 'removeFingerprintsFromBonus',
          bonusName: 'special-bonus',
          fingerprints
        })

        expect(
          () => DistributionHandle(initState, wrongBonusName)
        ).to.throw(VALID_BONUS_NAME_REQUIRED)

        const badFingerprints = createInteraction(OWNER, {
          function: 'removeFingerprintsFromBonus',
          bonusName: 'hardware',
          fingerprints: ['bad-fingerprint', 123]
        })

        expect(
          () => DistributionHandle(initState, badFingerprints)
        ).to.throw(INVALID_FINGERPRINT)
      })

      it('Prevents non-owners from removing fingerprints from hardware bonus', () => {
        const aliceRemoveFingerprints = createInteraction(ALICE, {
          function: 'removeFingerprintsFromBonus',
          bonusName: 'hardware',
          fingerprints: [fingerprintA]
        })

        expect(
          () => DistributionHandle(initState, aliceRemoveFingerprints)
        ).to.throw(ERROR_ONLY_OWNER)
      })
    })

    describe('Quality Tiers', () => {
      it('Allows Owner to set quality tier bonus token rate', () => {
        const tokensDistributedPerSecond = '200'
        const setQualityTierBonusRate = createInteraction(OWNER, {
          function: 'setQualityTierBonusRate',
          tokensDistributedPerSecond
        })
    
        const { state } = DistributionHandle(initState, setQualityTierBonusRate)
    
        expect(state.bonuses.quality.tokensDistributedPerSecond).to.equal(
          tokensDistributedPerSecond
        )
      })

      it('Prevents non-owners from setting quality tier bonus token rate', () => {
        const aliceSetQualityTierBonusRate = createInteraction(ALICE, {
          function: 'setQualityTierBonusRate',
          tokensDistributedPerSecond: '1000'
        })
  
        expect(
          () => DistributionHandle(initState, aliceSetQualityTierBonusRate)
        ).to.throw(ContractError, ERROR_ONLY_OWNER)
      })

      it('Validates when setting quality tier bonus token rate', () => {
        const setMissingRate = createInteraction(OWNER, {
          function: 'setQualityTierBonusRate'
        })
  
        expect(
          () => DistributionHandle(initState, setMissingRate)
        ).to.throw(ContractError, INVALID_DISTRIBUTION_AMOUNT)
  
        const negativeDistributionAmount = '-100'
        const setNegativeDistributionAmount = createInteraction(OWNER, {
          function: 'setQualityTierBonusRate',
          tokensDistributedPerSecond: negativeDistributionAmount
        })
  
        expect(
          () => DistributionHandle(initState, setNegativeDistributionAmount)
        ).to.throw(ContractError, INVALID_DISTRIBUTION_AMOUNT)
  
        const numberDistributionAmount = 100
        const setNumberDistributionAmount = createInteraction(OWNER, {
          function: 'setQualityTierBonusRate',
          tokensDistributedPerSecond: numberDistributionAmount
        })
        
        expect(
          () => DistributionHandle(initState, setNumberDistributionAmount)
        ).to.throw(ContractError, INVALID_DISTRIBUTION_AMOUNT)
      })

      it('Allows Owner to toggle quality tier bonus', () => {
        const enableQualityTierBonus = createInteraction(OWNER, {
          function: 'toggleQualityTierBonus',
          enabled: true
        })
        const { state: firstState } = DistributionHandle(
          { ...initState },
          enableQualityTierBonus
        )
        expect(firstState.bonuses.quality.enabled).to.be.true

        const disableQualityTierBonus = createInteraction(OWNER, {
          function: 'toggleQualityTierBonus',
          enabled: false
        })
        const { state: secondState } = DistributionHandle(
          firstState,
          disableQualityTierBonus
        )
        expect(secondState.bonuses.quality.enabled).to.be.false
      })

      it('Prevents non-owners from toggling quality tier bonus', () => {
        const aliceToggleQualityTierBonus = createInteraction(ALICE, {
          function: 'toggleQualityTierBonus',
          enabled: true
        })
  
        expect(
          () => DistributionHandle(initState, aliceToggleQualityTierBonus)
        ).to.throw(ContractError, ERROR_ONLY_OWNER)
      })

      it('Validates when toggling quality tier bonus', () => {
        const undefinedToggle = createInteraction(OWNER, {
          function: 'toggleQualityTierBonus'
        })
  
        expect(
          () => DistributionHandle(initState, undefinedToggle)
        ).to.throw(ENABLED_REQUIRED)
  
        const zeroToggle = createInteraction(OWNER, {
          function: 'toggleQualityTierBonus',
          enabled: 0
        })
  
        expect(
          () => DistributionHandle(initState, zeroToggle)
        ).to.throw(ENABLED_REQUIRED)
  
        const positiveToggle = createInteraction(OWNER, {
          function: 'toggleQualityTierBonus',
          enabled: 12
        })
  
        expect(
          () => DistributionHandle(initState, positiveToggle)
        ).to.throw(ENABLED_REQUIRED)
  
        const objectToggle = createInteraction(OWNER, {
          function: 'toggleQualityTierBonus',
          enabled: { enabled: true }
        })
  
        expect(
          () => DistributionHandle(initState, objectToggle)
        ).to.throw(ENABLED_REQUIRED)
  
        const stringToggle = createInteraction(OWNER, {
          function: 'toggleQualityTierBonus',
          enabled: 'true'
        })
  
        expect(
          () => DistributionHandle(initState, stringToggle)
        ).to.throw(ENABLED_REQUIRED)
      })      

      it('Allows Owner to set quality tier bonus settings', () => {
        const settings = {
          uptime: {
            [3]: 1,
            [8]: 2,
            [22]: 4
          }
        }
        const setQualityTierBonusSettings = createInteraction(OWNER, {
          function: 'setQualityTierBonusSettings',
          settings
        })

        const { state } = DistributionHandle(
          initState,
          setQualityTierBonusSettings
        )

        expect(state.bonuses.quality.settings).to.deep.equal(settings)
      })

      it('Prevents non-owners from setting quality tier bonus settings', () => {
        const aliceSetQualityTierBonusSettings = createInteraction(ALICE, {
          function: 'setQualityTierBonusSettings',
          settings: { uptime: {} }
        })

        expect(
          () => DistributionHandle(initState, aliceSetQualityTierBonusSettings)
        ).to.throw(ContractError, ERROR_ONLY_OWNER)
      })

      it('Validates when setting quality tier bonus settings', () => {
        const undefinedSettings = createInteraction(OWNER, {
          function: 'setQualityTierBonusSettings'
        })
        expect(
          () => DistributionHandle(initState, undefinedSettings)
        ).to.throw(INVALID_QUALITY_BONUS_SETTINGS)

        const nonObjectSettings = createInteraction(OWNER, {
          function: 'setQualityTierBonusSettings',
          settings: 12
        })
        expect(
          () => DistributionHandle(initState, nonObjectSettings)
        ).to.throw(INVALID_QUALITY_BONUS_SETTINGS)

        const undefinedUptimeSettings = createInteraction(OWNER, {
          function: 'setQualityTierBonusSettings',
          settings: {}
        })
        expect(
          () => DistributionHandle(initState, undefinedUptimeSettings)
        ).to.throw(INVALID_QUALITY_BONUS_SETTINGS)

        const nonObjectUptimeSettings = createInteraction(OWNER, {
          function: 'setQualityTierBonusSettings',
          settings: {
            uptime: 12
          }
        })
        expect(
          () => DistributionHandle(initState, nonObjectUptimeSettings)
        ).to.throw(INVALID_QUALITY_BONUS_SETTINGS)

        const stringKeyQualityUptimeSettings = createInteraction(OWNER, {
          function: 'setQualityTierBonusSettings',
          settings: {
            uptime: {
              ['one']: 'two'
            }
          }
        })
        expect(
          () => DistributionHandle(initState, stringKeyQualityUptimeSettings)
        ).to.throw(INVALID_QUALITY_BONUS_SETTINGS)

        const nonNumericQualityPointsUptimeSettings = createInteraction(OWNER, {
          function: 'setQualityTierBonusSettings',
          settings: {
            uptime: {
              [1]: 'one'
            }
          }
        })
        expect(
          () => DistributionHandle(
            initState,
            nonNumericQualityPointsUptimeSettings
          )
        ).to.throw(INVALID_QUALITY_BONUS_SETTINGS)

        const negativeQualityPointsUptimeSettings = createInteraction(OWNER, {
          function: 'setQualityTierBonusSettings',
          settings: {
            uptime: {
              [1]: -2
            }
          }
        })
        expect(
          () => DistributionHandle(
            initState,
            negativeQualityPointsUptimeSettings
          )
        ).to.throw(INVALID_QUALITY_BONUS_SETTINGS)
      })

      it('Allows Owner to set quality tier batch data', () => {
        const uptimes = {
          [fingerprintA]: 1,
          [fingerprintB]: 0,
          [fingerprintC]: 26,
          [fingerprintD]: 4
        }
        const setQualityTierUptimes = createInteraction(OWNER, {
          function: 'setQualityTierUptimes',
          uptimes
        })

        const { state } = DistributionHandle(initState, setQualityTierUptimes)

        expect(state.bonuses.quality.uptime).to.deep.equal(uptimes)
      })

      it('Prevents non-owners from setting quality tier batch data', () => {
        const aliceSetQualityTierUptimes = createInteraction(ALICE, {
          function: 'setQualityTierUptimes',
          uptimes: {
            [fingerprintA]: 1,
            [fingerprintB]: 0,
            [fingerprintC]: 26,
            [fingerprintD]: 4
          }
        })

        expect(
          () => DistributionHandle(initState, aliceSetQualityTierUptimes)
        ).to.throw(ContractError, ERROR_ONLY_OWNER)
      })

      it('Validates when setting quality tier batch data', () => {
        const undefinedUptimes = createInteraction(OWNER, {
          function: 'setQualityTierUptimes'
        })
        expect(
          () => DistributionHandle(initState, undefinedUptimes)
        ).to.throw(INVALID_UPTIMES)

        const nonObjectUptimes = createInteraction(OWNER, {
          function: 'setQualityTierUptimes',
          uptimes: 'uptimes'
        })
        expect(
          () => DistributionHandle(initState, nonObjectUptimes)
        ).to.throw(INVALID_UPTIMES)

        const invalidFingerprintUptimes = createInteraction(OWNER, {
          function: 'setQualityTierUptimes',
          uptimes: {
            [fingerprintA]: 5,
            ['invalid-fingerprint']: 2
          }
        })
        expect(
          () => DistributionHandle(initState, invalidFingerprintUptimes)
        ).to.throw(INVALID_FINGERPRINT)

        const nonNumericUptimeUptimes = createInteraction(OWNER, {
          function: 'setQualityTierUptimes',
          uptimes: {
            [fingerprintA]: 5,
            [fingerprintB]: '4'
          }
        })
        expect(
          () => DistributionHandle(initState, nonNumericUptimeUptimes)
        ).to.throw(INVALID_UPTIMES)

        const nonIntegerUptimeUptimes = createInteraction(OWNER, {
          function: 'setQualityTierUptimes',
          uptimes: {
            [fingerprintA]: 5,
            [fingerprintB]: 3.4
          }
        })
        expect(
          () => DistributionHandle(initState, nonIntegerUptimeUptimes)
        ).to.throw(INVALID_UPTIMES)

        const negativeUptimeUptimes = createInteraction(OWNER, {
          function: 'setQualityTierUptimes',
          uptimes: {
            [fingerprintA]: 5,
            [fingerprintB]: -3
          }
        })
        expect(
          () => DistributionHandle(initState, negativeUptimeUptimes)
        ).to.throw(INVALID_UPTIMES)
      })
    })
  })

  describe('Distributing', () => {
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
          timeElapsed: '0',
          tokensDistributedPerSecond: '1000',
          baseNetworkScore: '100',
          baseDistributedTokens: '0',
          bonuses: {
            hardware: {
              enabled: false,
              tokensDistributedPerSecond: '0',
              networkScore: '0',
              distributedTokens: '0'
            },
            quality: {
              enabled: false,
              tokensDistributedPerSecond: '0',
              networkScore: '0',
              distributedTokens: '0',
              settings: {
                uptime: {}
              },
              uptime: {}
            }
          },
          totalTokensDistributedPerSecond: '1000',
          totalNetworkScore: '100',
          totalDistributedTokens: '0',
          details: {},
          families: {},
          multipliers: {
            family: {
              enabled: false,
              familyMultiplierRate: '0'
            }
          }
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
          tokensDistributedPerSecond: '1000',
          baseNetworkScore: '100',
          baseDistributedTokens: '0',
          bonuses: {
            hardware: {
              enabled: false,
              tokensDistributedPerSecond: '0',
              networkScore: '0',
              distributedTokens: '0'
            },
            quality: {
              enabled: false,
              tokensDistributedPerSecond: '0',
              networkScore: '0',
              distributedTokens: '0',
              settings: {
                uptime: {}
              },
              uptime: {}
            }
          },
          totalTokensDistributedPerSecond: '1000',
          totalNetworkScore: '100',
          totalDistributedTokens: '0',
          details: {},
          families: {},
          multipliers: {
            family: {
              enabled: false,
              familyMultiplierRate: '0'
            }
          }
        },
        [secondTimestamp]: {
          timeElapsed: timeBetweenDistributions.toString(),
          tokensDistributedPerSecond: DEFAULT_TOKENS_PER_SECOND,
          baseNetworkScore: '500',
          baseDistributedTokens: '1000',
          bonuses: {
            hardware: {
              enabled: false,
              tokensDistributedPerSecond: '0',
              networkScore: '0',
              distributedTokens: '0'
            },
            quality: {
              enabled: false,
              tokensDistributedPerSecond: '0',
              networkScore: '0',
              distributedTokens: '0',
              settings: {
                uptime: {}
              },
              uptime: {}
            }
          },
          totalTokensDistributedPerSecond: DEFAULT_TOKENS_PER_SECOND,
          totalNetworkScore: '500',
          totalDistributedTokens: '1000',
          details: {
            'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA': {
              address: '0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa',
              bonuses: {
                hardware: '0',
                quality: '0'
              },
              distributedTokens: '1000',
              multipliers: {
                family: '1',
                region: '1'
              },
              score: '500'
            }
          },
          families: {},
          multipliers: {
            family: {
              enabled: false,
              familyMultiplierRate: '0'
            }
          }
        }
      })
      expect(state.claimable).to.deep.equal({
        [ALICE]: DEFAULT_TOKENS_PER_SECOND
      })
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
          tokensDistributedPerSecond: '1000',
          baseNetworkScore: '300',
          baseDistributedTokens: '0',
          bonuses: {
            hardware: {
              enabled: false,
              tokensDistributedPerSecond: '0',
              networkScore: '0',
              distributedTokens: '0'
            },
            quality: {
              enabled: false,
              tokensDistributedPerSecond: '0',
              networkScore: '0',
              distributedTokens: '0',
              settings: {
                uptime: {}
              },
              uptime: {}
            }
          },
          totalTokensDistributedPerSecond: '1000',
          totalNetworkScore: '300',
          totalDistributedTokens: '0',
          details: {},
          families: {},
          multipliers: {
            family: {
              enabled: false,
              familyMultiplierRate: '0'
            }
          }
        },
        [secondTimestamp]: {
          timeElapsed: firstTimeDifference.toString(),
          tokensDistributedPerSecond: DEFAULT_TOKENS_PER_SECOND,
          baseNetworkScore: '2069',
          baseDistributedTokens: '5430',
          bonuses: {
            hardware: {
              enabled: false,
              tokensDistributedPerSecond: '0',
              networkScore: '0',
              distributedTokens: '0'
            },
            quality: {
              enabled: false,
              tokensDistributedPerSecond: '0',
              networkScore: '0',
              distributedTokens: '0',
              settings: {
                uptime: {}
              },
              uptime: {}
            }
          },
          totalTokensDistributedPerSecond: DEFAULT_TOKENS_PER_SECOND,
          totalNetworkScore: '2069',
          totalDistributedTokens: '5430',
          details: {
            [fingerprintA]: {
              address: ALICE,
              bonuses: {
                hardware: '0',
                quality: '0'
              },
              distributedTokens: '196',
              multipliers: {
                family: '1',
                region: '1'
              },
              score: '75'
            },
            [fingerprintB]: {
              address: BOB,
              bonuses: {
                hardware: '0',
                quality: '0'
              },
              distributedTokens: '3510',
              multipliers: {
                family: '1',
                region: '1'
              },
              score: '1337'
            },
            [fingerprintC]: {
              address: ALICE,
              bonuses: {
                hardware: '0',
                quality: '0'
              },
              distributedTokens: '1724',
              multipliers: {
                family: '1',
                region: '1'
              },
              score: '657'
            }
          },
          families: {},
          multipliers: {
            family: {
              enabled: false,
              familyMultiplierRate: '0'
            }
          }
        },
        [thirdTimestamp]: {
          timeElapsed: secondTimeDifference.toString(),
          tokensDistributedPerSecond: DEFAULT_TOKENS_PER_SECOND,
          baseNetworkScore: '8162',
          baseDistributedTokens: '86399',
          bonuses: {
            hardware: {
              enabled: false,
              tokensDistributedPerSecond: '0',
              networkScore: '0',
              distributedTokens: '0'
            },
            quality: {
              enabled: false,
              tokensDistributedPerSecond: '0',
              networkScore: '0',
              distributedTokens: '0',
              settings: {
                uptime: {}
              },
              uptime: {}
            }
          },
          totalTokensDistributedPerSecond: DEFAULT_TOKENS_PER_SECOND,
          totalNetworkScore: '8162',
          totalDistributedTokens: '86399',
          details: {
            [fingerprintA]: {
              address: ALICE,
              bonuses: {
                hardware: '0',
                quality: '0'
              },
              distributedTokens: '2688',
              multipliers: {
                family: '1',
                region: '1'
              },
              score: '254'
            },
            [fingerprintB]: {
              address: BOB,
              bonuses: {
                hardware: '0',
                quality: '0'
              },
              distributedTokens: '60084',
              multipliers: {
                family: '1',
                region: '1'
              },
              score: '5676'
            },
            [fingerprintC]: {
              address: ALICE,
              bonuses: {
                hardware: '0',
                quality: '0'
              },
              distributedTokens: '23627',
              multipliers: {
                family: '1',
                region: '1'
              },
              score: '2232'
            }
          },
          families: {},
          multipliers: {
            family: {
              enabled: false,
              familyMultiplierRate: '0'
            }
          }
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
          baseNetworkScore: '300',
          baseDistributedTokens: '0',
          bonuses: {
            hardware: {
              enabled: false,
              tokensDistributedPerSecond: '0',
              networkScore: '0',
              distributedTokens: '0'
            },
            quality: {
              enabled: false,
              tokensDistributedPerSecond: '0',
              networkScore: '0',
              distributedTokens: '0',
              settings: {
                uptime: {}
              },
              uptime: {}
            }
          },
          totalTokensDistributedPerSecond: '4333',
          totalNetworkScore: '300',
          totalDistributedTokens: '0',
          details: {},
          families: {},
          multipliers: {
            family: {
              enabled: false,
              familyMultiplierRate: '0'
            }
          }
        },
        // 4333 tps rate over 443ms ~= 1,919.519 tokens
        [secondTimestamp]: {
          timeElapsed: '443',
          tokensDistributedPerSecond: '4333',
          baseNetworkScore: '2069',
          baseDistributedTokens: '1918',
          bonuses: {
            hardware: {
              enabled: false,
              tokensDistributedPerSecond: '0',
              networkScore: '0',
              distributedTokens: '0'
            },
            quality: {
              enabled: false,
              tokensDistributedPerSecond: '0',
              networkScore: '0',
              distributedTokens: '0',
              settings: {
                uptime: {}
              },
              uptime: {}
            }
          },
          totalTokensDistributedPerSecond: '4333',
          totalNetworkScore: '2069',
          totalDistributedTokens: '1918',
          details: {
            [fingerprintA]: {
              address: ALICE,
              bonuses: {
                hardware: '0',
                quality: '0'
              },
              distributedTokens: '69',
              multipliers: {
                family: '1',
                region: '1'
              },
              score: '75'
            },
            [fingerprintB]: {
              address: BOB,
              bonuses: {
                hardware: '0',
                quality: '0'
              },
              distributedTokens: '1240',
              multipliers: {
                family: '1',
                region: '1'
              },
              score: '1337'
            },
            [fingerprintC]: {
              address: ALICE,
              bonuses: {
                hardware: '0',
                quality: '0'
              },
              distributedTokens: '609',
              multipliers: {
                family: '1',
                region: '1'
              },
              score: '657'
            }
          },
          families: {},
          multipliers: {
            family: {
              enabled: false,
              familyMultiplierRate: '0'
            }
          }
        }
      })
      expect(state.pendingDistributions).to.be.empty
    })

    it('Applies hardware bonus on distribution when enabled', () => {
      const elapsed = 86400
      const timestamp = Date.now()
      const previousTimestamp = (timestamp - elapsed).toString()
      const distribute = createInteraction(OWNER, {
        function: 'distribute',
        timestamp: timestamp.toString()
      })

      const { state } = DistributionHandle(
        {
          ...initState,
          tokensDistributedPerSecond: '1000',
          bonuses: {
            hardware: {
              enabled: true,
              tokensDistributedPerSecond: '500',
              fingerprints: TestScoresHWBonuses
                .filter(({ hardware }) => !!hardware)
                .map(({ fingerprint }) => fingerprint)
            },
            quality: {
              enabled: false,
              tokensDistributedPerSecond: '0',
              settings: {
                uptime: {}
              },
              uptime: {}
            }
          },
          pendingDistributions: {
            [timestamp]: {
              scores: TestScoresHWBonuses
                .map(
                  ({ score, address, fingerprint }) =>
                    ({ score, address, fingerprint })
                )
            }
          },
          previousDistributions: {
            [previousTimestamp]: {
              timeElapsed: '0',
              tokensDistributedPerSecond: '0',
              baseNetworkScore: '0',
              baseDistributedTokens: '0',
              bonuses: {
                hardware: {
                  enabled: false,
                  tokensDistributedPerSecond: '0',
                  networkScore: '0',
                  distributedTokens: '0'
                },
                quality: {
                  enabled: false,
                  tokensDistributedPerSecond: '0',
                  networkScore: '0',
                  distributedTokens: '0',
                  settings: {
                    uptime: {}
                  },
                  uptime: {}
                }
              },
              totalTokensDistributedPerSecond: '0',
              totalNetworkScore: '0',
              totalDistributedTokens: '0',
              details: {},
              families: TestFamilies,
              multipliers: {
                family: {
                  enabled: false,
                  familyMultiplierRate: '0'
                }
              }
            }
          }
        },
        distribute
      )

      const rewards = Object.fromEntries(
        TestResultsHWBonuses.rewards.map(
          ({ address, totalReward }) => [ address, totalReward ]
        )
      )
      expect(state.claimable).to.deep.equal(rewards)
    })

    it('Does not apply hardware bonus on distribution when disabled', () => {
      const elapsed = 86400
      const timestamp = Date.now()
      const previousTimestamp = (timestamp - elapsed).toString()
      const distribute = createInteraction(OWNER, {
        function: 'distribute',
        timestamp: timestamp.toString()
      })

      const { state } = DistributionHandle(
        {
          ...initState,
          tokensDistributedPerSecond: '1000',
          bonuses: {
            hardware: {
              enabled: false,
              tokensDistributedPerSecond: '500',
              fingerprints: TestScoresHWBonuses
                .filter(({ hardware }) => !!hardware)
                .map(({ fingerprint }) => fingerprint)
            },
            quality: {
              enabled: false,
              tokensDistributedPerSecond: '0',
              settings: {
                uptime: {}
              },
              uptime: {}
            }
          },
          pendingDistributions: {
            [timestamp]: {
              scores: TestScoresHWBonuses
                .map(
                  ({ score, address, fingerprint }) =>
                    ({ score, address, fingerprint })
                )
            }
          },
          previousDistributions: {
            [previousTimestamp]: {
              timeElapsed: '0',
              tokensDistributedPerSecond: '0',
              baseNetworkScore: '0',
              baseDistributedTokens: '0',
              bonuses: {
                hardware: {
                  enabled: false,
                  tokensDistributedPerSecond: '0',
                  networkScore: '0',
                  distributedTokens: '0'
                },
                quality: {
                  enabled: false,
                  tokensDistributedPerSecond: '0',
                  networkScore: '0',
                  distributedTokens: '0',
                  settings: {
                    uptime: {}
                  },
                  uptime: {}
                }
              },
              totalTokensDistributedPerSecond: '0',
              totalNetworkScore: '0',
              totalDistributedTokens: '0',
              details: {},
              families: TestFamilies,
              multipliers: {
                family: {
                  enabled: false,
                  familyMultiplierRate: '0'
                }
              }
            }
          }
        },
        distribute
      )

      const rewards = Object.fromEntries(
        TestResultsHWBonuses.rewards.map(
          ({ address, baseReward }) => [ address, baseReward ]
        )
      )
      expect(state.claimable).to.deep.equal(rewards)
    })

    it('Applies family multipliers when enabled', () => {
      const elapsed = 86400
      const timestamp = Date.now()
      const previousTimestamp = (timestamp - elapsed).toString()
      const distribute = createInteraction(OWNER, {
        function: 'distribute',
        timestamp: timestamp.toString()
      })

      const { state } = DistributionHandle(
        {
          ...initState,
          tokensDistributedPerSecond: '1000',
          families: TestFamilies,
          bonuses: {
            hardware: {
              enabled: true,
              tokensDistributedPerSecond: '500',
              fingerprints: TestScoresFamilyMultiplier
                .filter(({ hardware }) => !!hardware)
                .map(({ fingerprint }) => fingerprint)
            },
            quality: {
              enabled: false,
              tokensDistributedPerSecond: '0',
              settings: {
                uptime: {}
              },
              uptime: {}
            }
          },
          multipliers: {
            family: {
              enabled: true,
              familyMultiplierRate: '0.1'
            }
          },
          pendingDistributions: {
            [timestamp]: {
              scores: TestScoresFamilyMultiplier
                .map(
                  ({ score, address, fingerprint }) =>
                    ({ score, address, fingerprint })
                )
            }
          },
          previousDistributions: {
            [previousTimestamp]: {
              timeElapsed: '0',
              tokensDistributedPerSecond: '0',
              baseNetworkScore: '0',
              baseDistributedTokens: '0',
              bonuses: {
                hardware: {
                  enabled: false,
                  tokensDistributedPerSecond: '0',
                  networkScore: '0',
                  distributedTokens: '0'
                },
                quality: {
                  enabled: false,
                  tokensDistributedPerSecond: '0',
                  networkScore: '0',
                  distributedTokens: '0',
                  settings: {
                    uptime: {}
                  },
                  uptime: {}
                }
              },
              totalTokensDistributedPerSecond: '0',
              totalNetworkScore: '0',
              totalDistributedTokens: '0',
              details: {},
              families: TestFamilies,
              multipliers: {
                family: {
                  enabled: false,
                  familyMultiplierRate: '0'
                }
              }
            }
          }
        },
        distribute
      )

      const rewards = Object.fromEntries(
        TestResultsFamilyMultiplier.rewards.map(
          ({ address, totalRewardWithFamilyMultiplier }) =>
            [ address, totalRewardWithFamilyMultiplier ]
        )
      )
      expect(state.claimable).to.deep.equal(rewards)
    })

    it('Applies quality tier bonus when enabled', () => {
      const elapsed = 86400
      const timestamp = Date.now()
      const previousTimestamp = (timestamp - elapsed).toString()

      const distribute = createInteraction(OWNER, {
        function: 'distribute',
        timestamp: timestamp.toString()
      })

      const { state } = DistributionHandle(
        {
          ...initState,
          tokensDistributedPerSecond: '1000',
          families: TestFamilies,
          bonuses: {
            hardware: {
              enabled: true,
              tokensDistributedPerSecond: '500',
              fingerprints: TestScoresQualityBonus
                .filter(({ hardware }) => !!hardware)
                .map(({ fingerprint }) => fingerprint)
            },
            quality: {
              enabled: true,
              tokensDistributedPerSecond: '250',
              settings: {
                uptime: DEFAULT_QUALITY_BONUS_SETTINGS
              },
              uptime: Object.fromEntries(
                TestScoresQualityBonus.map(({ fingerprint, uptime }) => {
                  let parsedUptime = Number.parseInt(uptime)
                  if (Number.isNaN(parsedUptime)) {
                    parsedUptime = 0
                  }

                  return [ fingerprint, parsedUptime ]
                })
              )
            }
          },
          pendingDistributions: {
            [timestamp]: {
              scores: TestScoresQualityBonus
                .map(
                  ({ score, address, fingerprint }) =>
                    ({ score, address, fingerprint })
                )
            }
          },
          previousDistributions: {
            [previousTimestamp]: {
              timeElapsed: '0',
              tokensDistributedPerSecond: '0',
              baseNetworkScore: '0',
              baseDistributedTokens: '0',
              bonuses: {
                hardware: {
                  enabled: false,
                  tokensDistributedPerSecond: '0',
                  networkScore: '0',
                  distributedTokens: '0'
                },
                quality: {
                  enabled: false,
                  tokensDistributedPerSecond: '0',
                  networkScore: '0',
                  distributedTokens: '0',
                  settings: {
                    uptime: {}
                  },
                  uptime: {}
                }
              },
              totalTokensDistributedPerSecond: '0',
              totalNetworkScore: '0',
              totalDistributedTokens: '0',
              details: {},
              families: TestFamilies,
              multipliers: {
                family: {
                  enabled: false,
                  familyMultiplierRate: '0'
                }
              }
            }
          }
        },
        distribute
      )

      const rewards = Object.fromEntries(
        TestResultsQualityBonus.rewards.map(
          ({ address, totalReward }) => [ address, totalReward ]
        )
      )
      expect(state.claimable).to.deep.equal(rewards)
    })

    it('Applies quality tier bonus gracefully if info is missing', () => {
      const elapsed = 86400
      const timestamp = Date.now()
      const previousTimestamp = (timestamp - elapsed).toString()

      const distribute = createInteraction(OWNER, {
        function: 'distribute',
        timestamp: timestamp.toString()
      })

      const { state } = DistributionHandle(
        {
          ...initState,
          tokensDistributedPerSecond: '1000',
          families: TestFamilies,
          bonuses: {
            hardware: {
              enabled: true,
              tokensDistributedPerSecond: '500',
              fingerprints: TestScoresQualityBonus
                .filter(({ hardware }) => !!hardware)
                .map(({ fingerprint }) => fingerprint)
            },
            quality: {
              enabled: true,
              tokensDistributedPerSecond: '250',
              settings: {
                uptime: DEFAULT_QUALITY_BONUS_SETTINGS
              },
              uptime: {}
            }
          },
          pendingDistributions: {
            [timestamp]: {
              scores: TestScoresQualityBonus
                .map(
                  ({ score, address, fingerprint }) =>
                    ({ score, address, fingerprint })
                )
            }
          },
          previousDistributions: {
            [previousTimestamp]: {
              timeElapsed: '0',
              tokensDistributedPerSecond: '0',
              baseNetworkScore: '0',
              baseDistributedTokens: '0',
              bonuses: {
                hardware: {
                  enabled: false,
                  tokensDistributedPerSecond: '0',
                  networkScore: '0',
                  distributedTokens: '0'
                },
                quality: {
                  enabled: false,
                  tokensDistributedPerSecond: '0',
                  networkScore: '0',
                  distributedTokens: '0',
                  settings: {
                    uptime: {}
                  },
                  uptime: {}
                }
              },
              totalTokensDistributedPerSecond: '0',
              totalNetworkScore: '0',
              totalDistributedTokens: '0',
              details: {},
              families: TestFamilies,
              multipliers: {
                family: {
                  enabled: false,
                  familyMultiplierRate: '0'
                }
              }
            }
          }
        },
        distribute
      )

      const rewards = Object.fromEntries(
        TestResultsQualityBonus.rewards.map(
          ({ address, totalReward }) => [ address, totalReward ]
        )
      )
      expect(Object.values(state.claimable)).to.not.include('NaN')
    })
  })

  describe('Claiming', () => {
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
  })

  describe('Previous Distributions', () => {
    it('Allows owner to limit previous distributions tracked in state', () => {
      const limit = 5
      const setPreviousDistributionTrackingLimit = createInteraction(OWNER, {
        function: 'setPreviousDistributionTrackingLimit',
        limit
      })

      const { state } = DistributionHandle(
        initState,
        setPreviousDistributionTrackingLimit
      )

      expect(state.previousDistributionsTrackingLimit).to.equal(limit)
    })

    it('Prevents non-owners from limiting previous distributions', () => {
      const setPreviousDistributionTrackingLimit = createInteraction(ALICE, {
        function: 'setPreviousDistributionTrackingLimit',
        limit: 5
      })

      expect(
        () => DistributionHandle(
          initState,
          setPreviousDistributionTrackingLimit
        )
      ).to.throw(ContractError, ERROR_ONLY_OWNER)
    })

    it('Validates when setting previous distribution tracked limit', () => {
      const missingLimit = createInteraction(OWNER, {
        function: 'setPreviousDistributionTrackingLimit'
      })

      expect(
        () => DistributionHandle(initState, missingLimit)
      ).to.throw(ContractError, INVALID_LIMIT)

      const nonNumberLimit = createInteraction(OWNER, {
        function: 'setPreviousDistributionTrackingLimit',
        limit: 'oops! all berries'
      })

      expect(
        () => DistributionHandle(initState, nonNumberLimit)
      ).to.throw(ContractError, INVALID_LIMIT)

      const negativeLimit = createInteraction(OWNER, {
        function: 'setPreviousDistributionTrackingLimit',
        limit: -6
      })

      expect(
        () => DistributionHandle(initState, negativeLimit)
      ).to.throw(ContractError, INVALID_LIMIT)

      const zeroLimit = createInteraction(OWNER, {
        function: 'setPreviousDistributionTrackingLimit',
        limit: 0
      })

      expect(
        () => DistributionHandle(initState, zeroLimit)
      ).to.throw(ContractError, INVALID_LIMIT)

      const decimalLimit = createInteraction(OWNER, {
        function: 'setPreviousDistributionTrackingLimit',
        limit: 0.5
      })

      expect(
        () => DistributionHandle(initState, decimalLimit)
      ).to.throw(ContractError, INVALID_LIMIT)
    })

    it('Limits previous distributions tracked in state', () => {
      const now = Date.now()
      const scores = [
        { score: '100', address: ALICE, fingerprint: fingerprintA },
        { score: '100', address: BOB, fingerprint: fingerprintB },
        { score: '100', address: ALICE, fingerprint: fingerprintC }
      ]
      const limitPreviousDistributions = createInteraction(OWNER, {
        function: 'setPreviousDistributionTrackingLimit',
        limit: 3
      })
      const firstDistributionTimestamp = now.toString()
      const firstAddScores = createInteraction(OWNER, {
        function: 'addScores',
        timestamp: firstDistributionTimestamp,
        scores
      })
      const firstDistribute = createInteraction(OWNER, {
        function: 'distribute',
        timestamp: firstDistributionTimestamp
      })
      const secondDistributionTimestamp = (now + 1000).toString()
      const secondAddScores = createInteraction(OWNER, {
        function: 'addScores',
        timestamp: secondDistributionTimestamp,
        scores
      })
      const secondDistribute = createInteraction(OWNER, {
        function: 'distribute',
        timestamp: secondDistributionTimestamp
      })
      const thirdDistributionTimestamp = (now + 2000).toString()
      const thirdAddScores = createInteraction(OWNER, {
        function: 'addScores',
        timestamp: thirdDistributionTimestamp,
        scores
      })
      const thirdDistribute = createInteraction(OWNER, {
        function: 'distribute',
        timestamp: thirdDistributionTimestamp
      })
      const fourthDistributionTimestamp = (now + 3000).toString()
      const fourthAddScores = createInteraction(OWNER, {
        function: 'addScores',
        timestamp: fourthDistributionTimestamp,
        scores
      })
      const fourthDistribute = createInteraction(OWNER, {
        function: 'distribute',
        timestamp: fourthDistributionTimestamp
      })

      DistributionHandle(initState, limitPreviousDistributions)
      DistributionHandle(initState, firstAddScores)
      DistributionHandle(initState, firstDistribute)
      DistributionHandle(initState, secondAddScores)
      DistributionHandle(initState, secondDistribute)
      DistributionHandle(initState, thirdAddScores)
      DistributionHandle(initState, thirdDistribute)
      DistributionHandle(initState, fourthAddScores)
      const { state } = DistributionHandle(initState, fourthDistribute)

      expect(Object.keys(state.previousDistributions).length).to.equal(3)
      expect(
        state.previousDistributions[firstDistributionTimestamp]
      ).to.not.exist
      expect(state.previousDistributions[secondDistributionTimestamp]).to.exist
      expect(state.previousDistributions[thirdDistributionTimestamp]).to.exist
      expect(state.previousDistributions[fourthDistributionTimestamp]).to.exist
    })

    it('Tracks bonuses & details in previous distributions', () => {
      const elapsed = 86400
      const timestamp = Date.now()
      const previousTimestamp = (timestamp - elapsed).toString()
      const distribute = createInteraction(OWNER, {
        function: 'distribute',
        timestamp: timestamp.toString()
      })

      const { state } = DistributionHandle(
        {
          ...initState,
          tokensDistributedPerSecond: '1000',
          families: TestFamilies,
          bonuses: {
            hardware: {
              enabled: true,
              tokensDistributedPerSecond: '500',
              fingerprints: TestScoresQualityBonus
                .filter(({ hardware }) => !!hardware)
                .map(({ fingerprint }) => fingerprint)
            },
            quality: {
              enabled: true,
              tokensDistributedPerSecond: '250',
              settings: {
                uptime: DEFAULT_QUALITY_BONUS_SETTINGS
              },
              uptime: Object.fromEntries(
                TestScoresQualityBonus.map(({ fingerprint, uptime }) => {
                  let parsedUptime = Number.parseInt(uptime)
                  if (Number.isNaN(parsedUptime)) {
                    parsedUptime = 0
                  }

                  return [ fingerprint, parsedUptime ]
                })
              )
            }
          },
          pendingDistributions: {
            [timestamp]: {
              scores: TestScoresQualityBonus
                .map(
                  ({ score, address, fingerprint }) =>
                    ({ score, address, fingerprint })
                )
            }
          },
          previousDistributions: {
            [previousTimestamp]: {
              timeElapsed: '0',
              tokensDistributedPerSecond: '0',
              baseNetworkScore: '0',
              baseDistributedTokens: '0',
              bonuses: {
                hardware: {
                  enabled: false,
                  tokensDistributedPerSecond: '0',
                  networkScore: '0',
                  distributedTokens: '0'
                },
                quality: {
                  enabled: false,
                  tokensDistributedPerSecond: '0',
                  networkScore: '0',
                  distributedTokens: '0',
                  settings: {
                    uptime: {}
                  },
                  uptime: {}
                }
              },
              totalTokensDistributedPerSecond: '0',
              totalNetworkScore: '0',
              totalDistributedTokens: '0',
              details: {},
              families: TestFamilies,
              multipliers: {
                family: {
                  enabled: false,
                  familyMultiplierRate: '0'
                }
              }
            }
          }
        },
        distribute
      )

      const distribution = state.previousDistributions[timestamp]

      expect(distribution.timeElapsed).to.equal(elapsed.toString())

      expect(distribution.tokensDistributedPerSecond).to.equal('1000')
      expect(distribution.baseNetworkScore)
        .to.equal(TestResultsQualityBonus.baseNetworkScore)
      expect(distribution.baseDistributedTokens)
        .to.equal(TestResultsQualityBonus.baseActualDistributedTokens)

      expect(distribution.bonuses.hardware.enabled).to.be.true
      expect(distribution.bonuses.hardware.tokensDistributedPerSecond)
        .to.equal('500')
      expect(distribution.bonuses.hardware.networkScore)
        .to.equal(TestResultsQualityBonus.hwBonusNetworkScore)
      expect(distribution.bonuses.hardware.distributedTokens)
        .to.equal(TestResultsQualityBonus.hwBonusActualDistributedTokens)

      expect(distribution.bonuses.quality.enabled).to.be.true
      expect(distribution.bonuses.quality.tokensDistributedPerSecond)
        .to.equal('250')
      expect(distribution.bonuses.quality.networkScore)
        .to.equal(TestResultsQualityBonus.qualityBonusNetworkScore)
      expect(distribution.bonuses.quality.distributedTokens)
        .to.equal(TestResultsQualityBonus.qualityBonusActualDistributedTokens)

      expect(distribution.totalTokensDistributedPerSecond).to.equal('1750')
      expect(distribution.totalNetworkScore)
        .to.equal(TestResultsQualityBonus.totalNetworkScore)
      expect(distribution.totalDistributedTokens)
        .to.equal(TestResultsQualityBonus.totalActualDistributedTokens)
      
      // NB: Spot-check an address that has a family, hw relay, quality bonus
      const address = '0xa2AA87bE9FaaE25F1aC6E6846eC9589b03625ce0'
      const fingerprint1 = '60CCE755BD6B7410C70A16B4204D13A986437FDA'
      const fingerprint2 = '25280148FEF4E800FD179082D9E23276C7199E9D'
      expect(distribution.details[fingerprint1]).to.deep.equal({
        address,
        score: '53000',
        distributedTokens: '8881',
        bonuses: {
          hardware: '5802',
          quality: '526'
        },
        multipliers: {
          family: '1',
          region: '1'
        }
      })
      expect(distribution.details[fingerprint2]).to.deep.equal({
        address,
        score: '56000',
        distributedTokens: '2697',
        bonuses: {
          hardware: '0',
          quality: '0'
        },
        multipliers: {
          family: '1',
          region: '1'
        }
      })
    })
  })
})
