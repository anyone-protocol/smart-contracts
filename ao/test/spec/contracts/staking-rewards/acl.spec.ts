// ** ACL Handlers
import { expect } from 'chai'

import {
  ALICE_ADDRESS,
  AOTestHandle,
  BOB_ADDRESS,
  ConfigurationPatchTag,
  createLoader,
  FINGERPRINT_A,
  FINGERPRINT_B,
  OWNER_ADDRESS
} from '~/test/util/setup'

const MOCK_SCORES = {
  Scores: {
    [ALICE_ADDRESS]: {
      [BOB_ADDRESS]: {
        Staked: '1',
        Running: 0.0,
        Share: 0.0
      }
    }
  }
}

describe('ACL enforcement of staking rewards', () => {
  let handle: AOTestHandle

  beforeEach(async () => {
    handle = (await createLoader('staking-rewards')).handle

    // NB: Grant ALICE_ADDRESS 'admin' role for each of the admin tests below
    await handle({
      From: OWNER_ADDRESS,
      Tags: [{ name: 'Action', value: 'Update-Roles' }],
      Data: JSON.stringify({
        Grant: { [ALICE_ADDRESS]: [ 'admin' ] }
      })
    })
  })

  describe('Update-Configuration', () => {
    it('Allows Admin Role', async () => {
      const config = {
        TokensPerSecond: '100',
        Requirements: {
          Running: 0.1
        }
      }
      const configResult = await handle({
        From: ALICE_ADDRESS,
        Tags: [
            { name: 'Action', value: 'Update-Configuration' }
        ],
        Data: JSON.stringify(config)
      })
      expect(configResult.Messages).to.have.lengthOf(2)
      expect(configResult.Messages[0].Tags).to.deep.include({ name: 'device', value: 'patch@1.0' })
      const cfgTag = configResult.Messages[0].Tags.find(
        (t: { name: string }) => t.name === 'configuration'
      ) as ConfigurationPatchTag | undefined
      expect(cfgTag).to.exist
      expect(cfgTag!.value.TokensPerSecond).to.equal(config.TokensPerSecond)
      expect(cfgTag!.value.Requirements.Running).to.equal(config.Requirements.Running)
      expect(cfgTag!.value.Shares.Enabled).to.equal(false)
      expect(cfgTag!.value.Shares.Min).to.equal(0.0)
      expect(cfgTag!.value.Shares.Max).to.equal(1.0)
      expect(cfgTag!.value.Shares.Default).to.equal(0.05)
      expect(configResult.Messages[1].Data).to.equal('OK')
    })

    it('Allows Update-Configuration Role', async () => {
      await handle({
        From: OWNER_ADDRESS,
        Tags: [{ name: 'Action', value: 'Update-Roles' }],
        Data: JSON.stringify({
          Grant: { [BOB_ADDRESS]: [ 'Update-Configuration' ] }
        })
      })

      const config = {
        TokensPerSecond: '100',
        Requirements: {
          Running: 0.5
        }
      }
      const configResult = await handle({
        From: BOB_ADDRESS,
        Tags: [
            { name: 'Action', value: 'Update-Configuration' }
        ],
        Data: JSON.stringify(config)
      })

      expect(configResult.Messages).to.have.lengthOf(2)
      expect(configResult.Messages[0].Tags).to.deep.include({ name: 'device', value: 'patch@1.0' })
      const cfgTag2 = configResult.Messages[0].Tags.find(
        (t: { name: string }) => t.name === 'configuration'
      ) as ConfigurationPatchTag | undefined
      expect(cfgTag2).to.exist
      expect(cfgTag2!.value.TokensPerSecond).to.equal(config.TokensPerSecond)
      expect(cfgTag2!.value.Requirements.Running).to.equal(config.Requirements.Running)
      expect(cfgTag2!.value.Shares.Enabled).to.equal(false)
      expect(cfgTag2!.value.Shares.Min).to.equal(0.0)
      expect(cfgTag2!.value.Shares.Max).to.equal(1.0)
      expect(cfgTag2!.value.Shares.Default).to.equal(0.05)
      expect(configResult.Messages[1].Data).to.equal('OK')
    })
  })

  describe('Add-Scores', () => {
    it('Allows Admin Role', async () => {
      const addScoresResult = await handle({
        From: ALICE_ADDRESS,
        Tags: [
            { name: 'Action', value: 'Add-Scores' },
            { name: 'Round-Timestamp', value: '1000' }
        ],
        Data: JSON.stringify(MOCK_SCORES)
      })
      expect(addScoresResult.Messages).to.have.lengthOf(1)
      expect(addScoresResult.Messages[0].Data).to.equal('OK')
    })

    it('Allows Add-Scores Role', async () => {
      await handle({
        From: OWNER_ADDRESS,
        Tags: [{ name: 'Action', value: 'Update-Roles' }],
        Data: JSON.stringify({
          Grant: { [BOB_ADDRESS]: [ 'Add-Scores' ] }
        })
      })

      const addScoresResult = await handle({
        From: BOB_ADDRESS,
        Tags: [
            { name: 'Action', value: 'Add-Scores' },
            { name: 'Round-Timestamp', value: '1000' }
        ],
        Data: JSON.stringify(MOCK_SCORES)
      })

      expect(addScoresResult.Messages).to.have.lengthOf(1)
      expect(addScoresResult.Messages[0].Data).to.equal('OK')
    })
  })

  describe('Complete-Round', () => {
    it('Allows Admin Role', async () => {
      await handle({
        From: OWNER_ADDRESS,
        Tags: [
            { name: 'Action', value: 'Add-Scores' },
            { name: 'Round-Timestamp', value: '2000' }
        ],
        Data: JSON.stringify(MOCK_SCORES)
      })
  
      const completeRoundResult = await handle({
        From: ALICE_ADDRESS,
        Tags: [
            { name: 'Action', value: 'Complete-Round' },
            { name: 'Round-Timestamp', value: '2000' }
        ]
      })
      expect(completeRoundResult.Messages).to.have.lengthOf(2)
      expect(completeRoundResult.Messages[0].Tags).to.deep.include({ name: 'device', value: 'patch@1.0' })
      expect(completeRoundResult.Messages[1].Data).to.equal('OK')
    })

    it('Allows Complete-Round Role', async () => {
      await handle({
        From: OWNER_ADDRESS,
        Tags: [
            { name: 'Action', value: 'Add-Scores' },
            { name: 'Round-Timestamp', value: '2000' }
        ],
        Data: JSON.stringify(MOCK_SCORES)
      })
      await handle({
        From: OWNER_ADDRESS,
        Tags: [{ name: 'Action', value: 'Update-Roles' }],
        Data: JSON.stringify({
          Grant: { [BOB_ADDRESS]: [ 'Complete-Round' ] }
        })
      })

      const completeRoundResult = await handle({
        From: BOB_ADDRESS,
        Tags: [
            { name: 'Action', value: 'Complete-Round' },
            { name: 'Round-Timestamp', value: '2000' }
        ]
      })

      expect(completeRoundResult.Messages).to.have.lengthOf(2)
      expect(completeRoundResult.Messages[0].Tags).to.deep.include({ name: 'device', value: 'patch@1.0' })
      expect(completeRoundResult.Messages[1].Data).to.equal('OK')
    })
  })

  describe('Cancel-Round', () => {
    it('Allows Admin Role', async () => {
      await handle({
        From: OWNER_ADDRESS,
        Tags: [
            { name: 'Action', value: 'Add-Scores' },
            { name: 'Round-Timestamp', value: '2000' }
        ],
        Data: JSON.stringify(MOCK_SCORES)
      })

      const cancelRoundResult = await handle({
        From: ALICE_ADDRESS,
        Tags: [
            { name: 'Action', value: 'Cancel-Round' },
            { name: 'Round-Timestamp', value: '2000' }
        ]
      })

      expect(cancelRoundResult.Messages).to.have.lengthOf(1)
      expect(cancelRoundResult.Messages[0].Data).to.equal('OK')
    })

    it('Allows Cancel-Round Role', async () => {
      await handle({
        From: OWNER_ADDRESS,
        Tags: [
            { name: 'Action', value: 'Add-Scores' },
            { name: 'Round-Timestamp', value: '2000' }
        ],
        Data: JSON.stringify(MOCK_SCORES)
      })
      await handle({
        From: OWNER_ADDRESS,
        Tags: [{ name: 'Action', value: 'Update-Roles' }],
        Data: JSON.stringify({
          Grant: { [BOB_ADDRESS]: [ 'Cancel-Round' ] }
        })
      })

      const cancelRoundResult = await handle({
        From: BOB_ADDRESS,
        Tags: [
            { name: 'Action', value: 'Cancel-Round' },
            { name: 'Round-Timestamp', value: '2000' }
        ]
      })

      expect(cancelRoundResult.Messages).to.have.lengthOf(1)
      expect(cancelRoundResult.Messages[0].Data).to.equal('OK')
    })
  })
})