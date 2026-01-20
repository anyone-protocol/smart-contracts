// ** Share Change Delay Tests
import { expect } from 'chai'

import {
  ALICE_ADDRESS,
  BOB_ADDRESS,
  CHARLS_ADDRESS,
  AOTestHandle,
  ConfigurationPatchTag,
  PendingShareChange,
  PendingShareChangesPatchTag,
  SharesPatchTag,
  createLoader,
  OWNER_ADDRESS
} from '~/test/util/setup'

describe('Share Change Delay via Update-Shares-Configuration', () => {
  let handle: AOTestHandle

  beforeEach(async () => {
    handle = (await createLoader('staking-rewards')).handle
  })

  describe('ChangeDelaySeconds configuration', () => {
    it('Allows configuring ChangeDelaySeconds via Update-Shares-Configuration', async () => {
      const result = await handle({
        From: OWNER_ADDRESS,
        Tags: [{ name: 'Action', value: 'Update-Shares-Configuration' }],
        Data: JSON.stringify({ ChangeDelaySeconds: 3600 })
      })
      expect(result.Messages).to.have.lengthOf(2)
      const configTag = result.Messages[0].Tags.find(
        (t: { name: string }) => t.name === 'configuration'
      ) as ConfigurationPatchTag | undefined
      expect(configTag).to.exist
      expect(configTag!.value.Shares.ChangeDelaySeconds).to.equal(3600)
    })

    it('Rejects non-integer ChangeDelaySeconds', async () => {
      const result = await handle({
        From: OWNER_ADDRESS,
        Tags: [{ name: 'Action', value: 'Update-Shares-Configuration' }],
        Data: JSON.stringify({ ChangeDelaySeconds: 3600.5 })
      })
      expect(result.Error).to.be.a('string').that.includes('ChangeDelaySeconds')
    })

    it('Rejects negative ChangeDelaySeconds', async () => {
      const result = await handle({
        From: OWNER_ADDRESS,
        Tags: [{ name: 'Action', value: 'Update-Shares-Configuration' }],
        Data: JSON.stringify({ ChangeDelaySeconds: -1 })
      })
      expect(result.Error).to.be.a('string').that.includes('ChangeDelaySeconds has to be >= 0')
    })

    it('Allows ChangeDelaySeconds of 0 (immediate)', async () => {
      const result = await handle({
        From: OWNER_ADDRESS,
        Tags: [{ name: 'Action', value: 'Update-Shares-Configuration' }],
        Data: JSON.stringify({ ChangeDelaySeconds: 0 })
      })
      expect(result.Messages).to.have.lengthOf(2)
      const configTag = result.Messages[0].Tags.find(
        (t: { name: string }) => t.name === 'configuration'
      ) as ConfigurationPatchTag | undefined
      expect(configTag!.value.Shares.ChangeDelaySeconds).to.equal(0)
    })

    it('Can update ChangeDelaySeconds together with other share config options', async () => {
      const result = await handle({
        From: OWNER_ADDRESS,
        Tags: [{ name: 'Action', value: 'Update-Shares-Configuration' }],
        Data: JSON.stringify({
          ChangeDelaySeconds: 7200,
          Default: 0.1,
          Min: 0.05,
          Max: 0.5
        })
      })
      expect(result.Messages).to.have.lengthOf(2)
      const configTag = result.Messages[0].Tags.find(
        (t: { name: string }) => t.name === 'configuration'
      ) as ConfigurationPatchTag | undefined
      expect(configTag!.value.Shares.ChangeDelaySeconds).to.equal(7200)
      expect(configTag!.value.Shares.Default).to.equal(0.1)
      expect(configTag!.value.Shares.Min).to.equal(0.05)
      expect(configTag!.value.Shares.Max).to.equal(0.5)
    })
  })

  describe('Immediate application when ChangeDelaySeconds is 0', () => {
    it('Applies share change immediately when ChangeDelaySeconds is 0', async () => {
      // Enable shares feature
      await handle({
        From: OWNER_ADDRESS,
        Tags: [{ name: 'Action', value: 'Toggle-Feature-Shares' }],
        Data: JSON.stringify({ Enabled: true })
      })

      // Ensure ChangeDelaySeconds is 0 (default) and enable SetSharesEnabled
      await handle({
        From: OWNER_ADDRESS,
        Tags: [{ name: 'Action', value: 'Update-Shares-Configuration' }],
        Data: JSON.stringify({ ChangeDelaySeconds: 0, SetSharesEnabled: true })
      })

      // Set share as operator
      const result = await handle({
        From: BOB_ADDRESS,
        Tags: [{ name: 'Action', value: 'Set-Share' }],
        Data: JSON.stringify({ Share: 0.15 }),
        Timestamp: 1000
      })
      expect(result.Error).to.be.undefined
      expect(result.Messages).to.have.lengthOf(2)

      // Should have shares patch (immediate), not pending_share_changes
      const sharesTag = result.Messages[0].Tags.find(
        (t: { name: string }) => t.name === 'shares'
      ) as SharesPatchTag | undefined
      expect(sharesTag).to.exist
      expect(sharesTag!.value[BOB_ADDRESS]).to.equal(0.15)

      const pendingTag = result.Messages[0].Tags.find(
        (t: { name: string }) => t.name === 'pending_share_changes'
      )
      expect(pendingTag).to.be.undefined
    })
  })

  describe('Delayed application when ChangeDelaySeconds > 0', () => {
    it('Queues share change when ChangeDelaySeconds > 0', async () => {
      // Enable shares feature
      await handle({
        From: OWNER_ADDRESS,
        Tags: [{ name: 'Action', value: 'Toggle-Feature-Shares' }],
        Data: JSON.stringify({ Enabled: true })
      })

      // Set ChangeDelaySeconds to 1 hour (3600 seconds) and enable SetSharesEnabled
      await handle({
        From: OWNER_ADDRESS,
        Tags: [{ name: 'Action', value: 'Update-Shares-Configuration' }],
        Data: JSON.stringify({ ChangeDelaySeconds: 3600, SetSharesEnabled: true })
      })

      // Set share as operator
      const result = await handle({
        From: BOB_ADDRESS,
        Tags: [{ name: 'Action', value: 'Set-Share' }],
        Data: JSON.stringify({ Share: 0.2 }),
        Timestamp: 1000
      })
      expect(result.Error).to.be.undefined
      expect(result.Messages).to.have.lengthOf(2)

      // Should have pending_share_changes patch, not shares
      const pendingTag = result.Messages[0].Tags.find(
        (t: { name: string }) => t.name === 'pending_share_changes'
      ) as PendingShareChangesPatchTag | undefined
      expect(pendingTag).to.exist
      expect(pendingTag!.value[BOB_ADDRESS]).to.deep.equal({
        Share: 0.2,
        RequestedTimestamp: 1000
      })

      const sharesTag = result.Messages[0].Tags.find(
        (t: { name: string }) => t.name === 'shares'
      )
      expect(sharesTag).to.be.undefined
    })

    it('Replaces pending change when Set-Share called again', async () => {
      // Enable shares feature
      await handle({
        From: OWNER_ADDRESS,
        Tags: [{ name: 'Action', value: 'Toggle-Feature-Shares' }],
        Data: JSON.stringify({ Enabled: true })
      })

      // Set ChangeDelaySeconds and enable SetSharesEnabled
      await handle({
        From: OWNER_ADDRESS,
        Tags: [{ name: 'Action', value: 'Update-Shares-Configuration' }],
        Data: JSON.stringify({ ChangeDelaySeconds: 3600, SetSharesEnabled: true })
      })

      // First share change request
      await handle({
        From: BOB_ADDRESS,
        Tags: [{ name: 'Action', value: 'Set-Share' }],
        Data: JSON.stringify({ Share: 0.1 }),
        Timestamp: 1000
      })

      // Second share change request (should replace first)
      const result = await handle({
        From: BOB_ADDRESS,
        Tags: [{ name: 'Action', value: 'Set-Share' }],
        Data: JSON.stringify({ Share: 0.25 }),
        Timestamp: 2000
      })

      const pendingTag = result.Messages[0].Tags.find(
        (t: { name: string }) => t.name === 'pending_share_changes'
      ) as PendingShareChangesPatchTag | undefined
      expect(pendingTag).to.exist
      expect(pendingTag!.value[BOB_ADDRESS]).to.deep.equal({
        Share: 0.25,
        RequestedTimestamp: 2000
      })
    })

    it('Pending changes visible in View-State', async () => {
      // Enable shares feature
      await handle({
        From: OWNER_ADDRESS,
        Tags: [{ name: 'Action', value: 'Toggle-Feature-Shares' }],
        Data: JSON.stringify({ Enabled: true })
      })

      // Set ChangeDelaySeconds and enable SetSharesEnabled
      await handle({
        From: OWNER_ADDRESS,
        Tags: [{ name: 'Action', value: 'Update-Shares-Configuration' }],
        Data: JSON.stringify({ ChangeDelaySeconds: 3600, SetSharesEnabled: true })
      })

      // Queue a pending change
      await handle({
        From: BOB_ADDRESS,
        Tags: [{ name: 'Action', value: 'Set-Share' }],
        Data: JSON.stringify({ Share: 0.15 }),
        Timestamp: 5000
      })

      // View state
      const stateResult = await handle({
        From: ALICE_ADDRESS,
        Tags: [{ name: 'Action', value: 'View-State' }]
      })
      const state = JSON.parse(stateResult.Messages[0].Data)

      expect(state.PendingShareChanges).to.exist
      expect(state.PendingShareChanges[BOB_ADDRESS]).to.deep.equal({
        Share: 0.15,
        RequestedTimestamp: 5000
      })
    })
  })

  describe('Application in Complete-Round', () => {
    const setupRound = async (roundTimestamp: number) => {
      const score = {
        [ALICE_ADDRESS]: {
          [BOB_ADDRESS]: { Staked: '1000', Running: 0.6 }
        }
      }

      await handle({
        From: OWNER_ADDRESS,
        Tags: [{ name: 'Action', value: 'Update-Configuration' }],
        Data: JSON.stringify({ TokensPerSecond: '1000', Requirements: { Running: 0.5 } })
      })

      await handle({
        From: OWNER_ADDRESS,
        Tags: [
          { name: 'Action', value: 'Add-Scores' },
          { name: 'Round-Timestamp', value: String(roundTimestamp) }
        ],
        Data: JSON.stringify({ Scores: score })
      })
    }

    it('Applies pending share change after delay has passed', async () => {
      // Enable shares feature
      await handle({
        From: OWNER_ADDRESS,
        Tags: [{ name: 'Action', value: 'Toggle-Feature-Shares' }],
        Data: JSON.stringify({ Enabled: true })
      })

      // Set ChangeDelaySeconds to 1000 seconds and enable SetSharesEnabled
      await handle({
        From: OWNER_ADDRESS,
        Tags: [{ name: 'Action', value: 'Update-Shares-Configuration' }],
        Data: JSON.stringify({ ChangeDelaySeconds: 1000, SetSharesEnabled: true })
      })

      // Queue pending change at timestamp 1000
      await handle({
        From: BOB_ADDRESS,
        Tags: [{ name: 'Action', value: 'Set-Share' }],
        Data: JSON.stringify({ Share: 0.3 }),
        Timestamp: 1000
      })

      // Setup and complete round at timestamp 2000 (1000 + 1000 = 2000, so delay passed)
      await setupRound(2000)
      const completeResult = await handle({
        From: OWNER_ADDRESS,
        Tags: [
          { name: 'Action', value: 'Complete-Round' },
          { name: 'Round-Timestamp', value: '2000' }
        ]
      })

      // Should have shares in patch (change applied)
      const sharesTag = completeResult.Messages[0].Tags.find(
        (t: { name: string }) => t.name === 'shares'
      ) as SharesPatchTag | undefined
      expect(sharesTag).to.exist
      expect(sharesTag!.value[BOB_ADDRESS]).to.equal(0.3)

      // pending_share_changes should be empty (removed after application)
      const pendingTag = completeResult.Messages[0].Tags.find(
        (t: { name: string }) => t.name === 'pending_share_changes'
      ) as PendingShareChangesPatchTag | undefined
      expect(pendingTag).to.exist
      expect(pendingTag!.value[BOB_ADDRESS]).to.be.undefined
    })

    it('Does NOT apply pending share change before delay has passed', async () => {
      // Enable shares feature
      await handle({
        From: OWNER_ADDRESS,
        Tags: [{ name: 'Action', value: 'Toggle-Feature-Shares' }],
        Data: JSON.stringify({ Enabled: true })
      })

      // Set ChangeDelaySeconds to 2000 seconds and enable SetSharesEnabled
      await handle({
        From: OWNER_ADDRESS,
        Tags: [{ name: 'Action', value: 'Update-Shares-Configuration' }],
        Data: JSON.stringify({ ChangeDelaySeconds: 2000, SetSharesEnabled: true })
      })

      // Queue pending change at timestamp 1000
      await handle({
        From: BOB_ADDRESS,
        Tags: [{ name: 'Action', value: 'Set-Share' }],
        Data: JSON.stringify({ Share: 0.3 }),
        Timestamp: 1000
      })

      // Setup and complete round at timestamp 2000 (1000 + 2000 = 3000 > 2000, so delay NOT passed)
      await setupRound(2000)
      const completeResult = await handle({
        From: OWNER_ADDRESS,
        Tags: [
          { name: 'Action', value: 'Complete-Round' },
          { name: 'Round-Timestamp', value: '2000' }
        ]
      })

      // Should NOT have shares in patch (change not applied)
      const sharesTag = completeResult.Messages[0].Tags.find(
        (t: { name: string }) => t.name === 'shares'
      )
      expect(sharesTag).to.be.undefined

      // pending_share_changes should NOT be in patch (no changes to pending)
      const pendingTag = completeResult.Messages[0].Tags.find(
        (t: { name: string }) => t.name === 'pending_share_changes'
      )
      expect(pendingTag).to.be.undefined

      // Verify pending change still exists in state
      const stateResult = await handle({
        From: OWNER_ADDRESS,
        Tags: [{ name: 'Action', value: 'View-State' }]
      })
      const state = JSON.parse(stateResult.Messages[0].Data)
      expect(state.PendingShareChanges[BOB_ADDRESS]).to.deep.equal({
        Share: 0.3,
        RequestedTimestamp: 1000
      })
    })

    it('Applies multiple pending changes when delay has passed for each', async () => {
      // Enable shares feature
      await handle({
        From: OWNER_ADDRESS,
        Tags: [{ name: 'Action', value: 'Toggle-Feature-Shares' }],
        Data: JSON.stringify({ Enabled: true })
      })

      // Set ChangeDelaySeconds to 500 seconds and enable SetSharesEnabled
      await handle({
        From: OWNER_ADDRESS,
        Tags: [{ name: 'Action', value: 'Update-Shares-Configuration' }],
        Data: JSON.stringify({ ChangeDelaySeconds: 500, SetSharesEnabled: true })
      })

      // Queue pending changes for multiple operators
      await handle({
        From: BOB_ADDRESS,
        Tags: [{ name: 'Action', value: 'Set-Share' }],
        Data: JSON.stringify({ Share: 0.1 }),
        Timestamp: 1000
      })
      await handle({
        From: CHARLS_ADDRESS,
        Tags: [{ name: 'Action', value: 'Set-Share' }],
        Data: JSON.stringify({ Share: 0.2 }),
        Timestamp: 1200
      })

      // Setup round with both operators
      const scores = {
        [ALICE_ADDRESS]: {
          [BOB_ADDRESS]: { Staked: '1000', Running: 0.6 },
          [CHARLS_ADDRESS]: { Staked: '2000', Running: 0.7 }
        }
      }
      await handle({
        From: OWNER_ADDRESS,
        Tags: [{ name: 'Action', value: 'Update-Configuration' }],
        Data: JSON.stringify({ TokensPerSecond: '1000', Requirements: { Running: 0.5 } })
      })
      await handle({
        From: OWNER_ADDRESS,
        Tags: [
          { name: 'Action', value: 'Add-Scores' },
          { name: 'Round-Timestamp', value: '2000' }
        ],
        Data: JSON.stringify({ Scores: scores })
      })

      // Complete round at 2000 - both should apply (1000+500=1500 <= 2000, 1200+500=1700 <= 2000)
      const completeResult = await handle({
        From: OWNER_ADDRESS,
        Tags: [
          { name: 'Action', value: 'Complete-Round' },
          { name: 'Round-Timestamp', value: '2000' }
        ]
      })

      const sharesTag = completeResult.Messages[0].Tags.find(
        (t: { name: string }) => t.name === 'shares'
      ) as SharesPatchTag | undefined
      expect(sharesTag).to.exist
      expect(sharesTag!.value[BOB_ADDRESS]).to.equal(0.1)
      expect(sharesTag!.value[CHARLS_ADDRESS]).to.equal(0.2)
    })

    it('Partial application - only applies changes where delay has passed', async () => {
      // Enable shares feature
      await handle({
        From: OWNER_ADDRESS,
        Tags: [{ name: 'Action', value: 'Toggle-Feature-Shares' }],
        Data: JSON.stringify({ Enabled: true })
      })

      // Set ChangeDelaySeconds to 1000 seconds and enable SetSharesEnabled
      await handle({
        From: OWNER_ADDRESS,
        Tags: [{ name: 'Action', value: 'Update-Shares-Configuration' }],
        Data: JSON.stringify({ ChangeDelaySeconds: 1000, SetSharesEnabled: true })
      })

      // Queue pending changes at different times
      await handle({
        From: BOB_ADDRESS,
        Tags: [{ name: 'Action', value: 'Set-Share' }],
        Data: JSON.stringify({ Share: 0.1 }),
        Timestamp: 500  // Will be ready at 1500
      })
      await handle({
        From: CHARLS_ADDRESS,
        Tags: [{ name: 'Action', value: 'Set-Share' }],
        Data: JSON.stringify({ Share: 0.2 }),
        Timestamp: 1500  // Will be ready at 2500
      })

      // Setup round
      const scores = {
        [ALICE_ADDRESS]: {
          [BOB_ADDRESS]: { Staked: '1000', Running: 0.6 },
          [CHARLS_ADDRESS]: { Staked: '2000', Running: 0.7 }
        }
      }
      await handle({
        From: OWNER_ADDRESS,
        Tags: [{ name: 'Action', value: 'Update-Configuration' }],
        Data: JSON.stringify({ TokensPerSecond: '1000', Requirements: { Running: 0.5 } })
      })
      await handle({
        From: OWNER_ADDRESS,
        Tags: [
          { name: 'Action', value: 'Add-Scores' },
          { name: 'Round-Timestamp', value: '2000' }
        ],
        Data: JSON.stringify({ Scores: scores })
      })

      // Complete round at 2000 - BOB should apply (500+1000=1500 <= 2000), CHARLS should NOT (1500+1000=2500 > 2000)
      const completeResult = await handle({
        From: OWNER_ADDRESS,
        Tags: [
          { name: 'Action', value: 'Complete-Round' },
          { name: 'Round-Timestamp', value: '2000' }
        ]
      })

      const sharesTag = completeResult.Messages[0].Tags.find(
        (t: { name: string }) => t.name === 'shares'
      ) as SharesPatchTag | undefined
      expect(sharesTag).to.exist
      expect(sharesTag!.value[BOB_ADDRESS]).to.equal(0.1)
      expect(sharesTag!.value[CHARLS_ADDRESS]).to.be.undefined

      const pendingTag = completeResult.Messages[0].Tags.find(
        (t: { name: string }) => t.name === 'pending_share_changes'
      ) as PendingShareChangesPatchTag | undefined
      expect(pendingTag).to.exist
      expect(pendingTag!.value[BOB_ADDRESS]).to.be.undefined  // Removed
      expect(pendingTag!.value[CHARLS_ADDRESS]).to.deep.equal({
        Share: 0.2,
        RequestedTimestamp: 1500
      })  // Still pending
    })
  })
})
