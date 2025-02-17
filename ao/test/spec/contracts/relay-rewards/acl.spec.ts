// ** ACL Handlers
import { expect } from 'chai'

import {
  ALICE_ADDRESS,
  AOTestHandle,
  BOB_ADDRESS,
  createLoader,
  FINGERPRINT_A,
  FINGERPRINT_B,
  OWNER_ADDRESS
} from '~/test/util/setup'

const MOCK_SCORES = {
  Scores: {
    [FINGERPRINT_A]: {
      Address: ALICE_ADDRESS,
      Network: 0,
      IsHardware: false, 
      UptimeStreak: 0,
      ExitBonus: false,
      FamilySize: 0,
      LocationSize: 0
    },
    [FINGERPRINT_B]: {
      Address: BOB_ADDRESS,
      Network: 100,
      IsHardware: false, 
      UptimeStreak: 0,
      ExitBonus: false,
      FamilySize: 0,
      LocationSize: 0
    }
  }
}

describe('ACL enforcement of relay rewards', () => {
  let handle: AOTestHandle

  beforeEach(async () => {
    handle = (await createLoader('relay-rewards')).handle

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
      const configResult = await handle({
        From: ALICE_ADDRESS,
        Tags: [
            { name: 'Action', value: 'Update-Configuration' }
        ],
        Data: JSON.stringify({
          TokensPerSecond: 100,
          Modifiers: {
            Network: {
              Share: 1
            },
            Hardware: { Enabled: false, Share: 0, UptimeInfluence: 0 },
            Uptime: { Enabled: false, Share: 0 },
            ExitBonus: { Enabled: false, Share: 0 }
          },
          Multipliers: {
            Location: { Enabled: false, Offset: 1, Power: 1, Divider: 1 },
            Family: { Enabled: false, Offset: 1, Power: 1 }
          }
        })
      })

      expect(configResult.Messages).to.have.lengthOf(1)
      expect(configResult.Messages[0].Data).to.equal('OK')
    })

    it('Allows Update-Configuration Role', async () => {
      await handle({
        From: OWNER_ADDRESS,
        Tags: [{ name: 'Action', value: 'Update-Roles' }],
        Data: JSON.stringify({
          Grant: { [BOB_ADDRESS]: [ 'Update-Configuration' ] }
        })
      })

      const configResult = await handle({
        From: BOB_ADDRESS,
        Tags: [
            { name: 'Action', value: 'Update-Configuration' }
        ],
        Data: JSON.stringify({
          TokensPerSecond: 100,
          Modifiers: {
            Network: {
              Share: 1
            },
            Hardware: { Enabled: false, Share: 0, UptimeInfluence: 0 },
            Uptime: { Enabled: false, Share: 0 },
            ExitBonus: { Enabled: false, Share: 0 }
          },
          Multipliers: {
            Location: { Enabled: false, Offset: 1, Power: 1, Divider: 1 },
            Family: { Enabled: false, Offset: 1, Power: 1 }
          }
        })
      })

      expect(configResult.Messages).to.have.lengthOf(1)
      expect(configResult.Messages[0].Data).to.equal('OK')
    })
  })

  describe('Add-Scores', () => {
    it('Allows Admin Role', async () => {
      const addScoresResult = await handle({
        From: ALICE_ADDRESS,
        Tags: [
            { name: 'Action', value: 'Add-Scores' },
            { name: 'Timestamp', value: '1000' }
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
            { name: 'Timestamp', value: '1000' }
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
            { name: 'Timestamp', value: '2000' }
        ],
        Data: JSON.stringify(MOCK_SCORES)
      })
  
      const completeRoundResult = await handle({
        From: ALICE_ADDRESS,
        Tags: [
            { name: 'Action', value: 'Complete-Round' },
            { name: 'Timestamp', value: '2000' }
        ]
      })

      expect(completeRoundResult.Messages).to.have.lengthOf(1)
      expect(completeRoundResult.Messages[0].Data).to.equal('OK')
    })

    it('Allows Complete-Round Role', async () => {
      await handle({
        From: OWNER_ADDRESS,
        Tags: [
            { name: 'Action', value: 'Add-Scores' },
            { name: 'Timestamp', value: '2000' }
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
            { name: 'Timestamp', value: '2000' }
        ]
      })

      expect(completeRoundResult.Messages).to.have.lengthOf(1)
      expect(completeRoundResult.Messages[0].Data).to.equal('OK')
    })
  })

  describe('Cancel-Round', () => {
    it('Allows Admin Role', async () => {
      await handle({
        From: OWNER_ADDRESS,
        Tags: [
            { name: 'Action', value: 'Add-Scores' },
            { name: 'Timestamp', value: '2000' }
        ],
        Data: JSON.stringify(MOCK_SCORES)
      })

      const cancelRoundResult = await handle({
        From: ALICE_ADDRESS,
        Tags: [
            { name: 'Action', value: 'Cancel-Round' },
            { name: 'Timestamp', value: '2000' }
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
            { name: 'Timestamp', value: '2000' }
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
            { name: 'Timestamp', value: '2000' }
        ]
      })

      expect(cancelRoundResult.Messages).to.have.lengthOf(1)
      expect(cancelRoundResult.Messages[0].Data).to.equal('OK')
    })
  })
})