// ** Toggle-Set-Shares Handler Tests
import { expect } from 'chai'

import {
  ALICE_ADDRESS,
  BOB_ADDRESS,
  CHARLS_ADDRESS,
  AOTestHandle,
  ConfigurationPatchTag,
  createLoader,
  OWNER_ADDRESS
} from '~/test/util/setup'

describe('Toggle-Set-Shares action of staking rewards', () => {
  let handle: AOTestHandle

  beforeEach(async () => {
    handle = (await createLoader('staking-rewards')).handle
  })

  describe('Permission checks', () => {
    it('Blocks non-owners from toggling set shares', async () => {
      const result = await handle({
        From: ALICE_ADDRESS,
        Tags: [{ name: 'Action', value: 'Toggle-Set-Shares' }],
        Data: JSON.stringify({ Enabled: false })
      })
      expect(result.Error).to.be.a('string').that.includes('Permission Denied')
    })

    it('Allows owner to toggle set shares', async () => {
      const result = await handle({
        From: OWNER_ADDRESS,
        Tags: [{ name: 'Action', value: 'Toggle-Set-Shares' }],
        Data: JSON.stringify({ Enabled: false })
      })
      expect(result.Messages).to.have.lengthOf(2)
      expect(result.Messages[0].Tags).to.deep.include({ name: 'device', value: 'patch@1.0' })
      const configTag = result.Messages[0].Tags.find(
        (t: { name: string }) => t.name === 'configuration'
      ) as ConfigurationPatchTag | undefined
      expect(configTag).to.exist
      expect(configTag!.value.Shares.SetSharesEnabled).to.equal(false)
      expect(result.Messages[1].Data).to.equal('OK')
    })

    it('Allows admin role to toggle set shares', async () => {
      await handle({
        From: OWNER_ADDRESS,
        Tags: [{ name: 'Action', value: 'Update-Roles' }],
        Data: JSON.stringify({ Grant: { [ALICE_ADDRESS]: ['admin'] } })
      })

      const result = await handle({
        From: ALICE_ADDRESS,
        Tags: [{ name: 'Action', value: 'Toggle-Set-Shares' }],
        Data: JSON.stringify({ Enabled: false })
      })
      expect(result.Messages).to.have.lengthOf(2)
      const configTag = result.Messages[0].Tags.find(
        (t: { name: string }) => t.name === 'configuration'
      ) as ConfigurationPatchTag | undefined
      expect(configTag).to.exist
      expect(configTag!.value.Shares.SetSharesEnabled).to.equal(false)
      expect(result.Messages[1].Data).to.equal('OK')
    })

    it('Allows Toggle-Set-Shares specific role', async () => {
      await handle({
        From: OWNER_ADDRESS,
        Tags: [{ name: 'Action', value: 'Update-Roles' }],
        Data: JSON.stringify({ Grant: { [BOB_ADDRESS]: ['Toggle-Set-Shares'] } })
      })

      const result = await handle({
        From: BOB_ADDRESS,
        Tags: [{ name: 'Action', value: 'Toggle-Set-Shares' }],
        Data: JSON.stringify({ Enabled: false })
      })
      expect(result.Error).to.be.undefined
      expect(result.Messages).to.have.lengthOf(2)
      expect(result.Messages[1].Data).to.equal('OK')
    })

    it('Denies users with other roles but not Toggle-Set-Shares', async () => {
      await handle({
        From: OWNER_ADDRESS,
        Tags: [{ name: 'Action', value: 'Update-Roles' }],
        Data: JSON.stringify({ Grant: { [CHARLS_ADDRESS]: ['Add-Scores'] } })
      })

      const result = await handle({
        From: CHARLS_ADDRESS,
        Tags: [{ name: 'Action', value: 'Toggle-Set-Shares' }],
        Data: JSON.stringify({ Enabled: false })
      })
      expect(result.Error).to.be.a('string').that.includes('Permission Denied')
    })
  })

  describe('Input validation', () => {
    it('Requires message data', async () => {
      const result = await handle({
        From: OWNER_ADDRESS,
        Tags: [{ name: 'Action', value: 'Toggle-Set-Shares' }]
      })
      expect(result.Error).to.be.a('string').that.includes('Message data is required')
    })

    it('Requires valid JSON', async () => {
      const result = await handle({
        From: OWNER_ADDRESS,
        Tags: [{ name: 'Action', value: 'Toggle-Set-Shares' }],
        Data: 'not-json'
      })
      expect(result.Error).to.be.a('string').that.includes('Data must be valid JSON')
    })

    it('Requires Enabled to be a boolean', async () => {
      const stringResult = await handle({
        From: OWNER_ADDRESS,
        Tags: [{ name: 'Action', value: 'Toggle-Set-Shares' }],
        Data: JSON.stringify({ Enabled: 'yes' })
      })
      expect(stringResult.Error).to.be.a('string').that.includes('Enabled must be a boolean')

      const numberResult = await handle({
        From: OWNER_ADDRESS,
        Tags: [{ name: 'Action', value: 'Toggle-Set-Shares' }],
        Data: JSON.stringify({ Enabled: 1 })
      })
      expect(numberResult.Error).to.be.a('string').that.includes('Enabled must be a boolean')
    })
  })

  describe('Toggle behavior', () => {
    it('Can disable and re-enable set shares', async () => {
      // Disable
      const disableResult = await handle({
        From: OWNER_ADDRESS,
        Tags: [{ name: 'Action', value: 'Toggle-Set-Shares' }],
        Data: JSON.stringify({ Enabled: false })
      })
      expect(disableResult.Messages).to.have.lengthOf(2)
      const disableConfigTag = disableResult.Messages[0].Tags.find(
        (t: { name: string }) => t.name === 'configuration'
      ) as ConfigurationPatchTag | undefined
      expect(disableConfigTag!.value.Shares.SetSharesEnabled).to.equal(false)

      // Re-enable
      const enableResult = await handle({
        From: OWNER_ADDRESS,
        Tags: [{ name: 'Action', value: 'Toggle-Set-Shares' }],
        Data: JSON.stringify({ Enabled: true })
      })
      expect(enableResult.Messages).to.have.lengthOf(2)
      const enableConfigTag = enableResult.Messages[0].Tags.find(
        (t: { name: string }) => t.name === 'configuration'
      ) as ConfigurationPatchTag | undefined
      expect(enableConfigTag!.value.Shares.SetSharesEnabled).to.equal(true)
    })

    it('SetSharesEnabled is independent from Shares.Enabled', async () => {
      // Enable shares feature
      await handle({
        From: OWNER_ADDRESS,
        Tags: [{ name: 'Action', value: 'Toggle-Feature-Shares' }],
        Data: JSON.stringify({ Enabled: true })
      })

      // Disable set shares
      const result = await handle({
        From: OWNER_ADDRESS,
        Tags: [{ name: 'Action', value: 'Toggle-Set-Shares' }],
        Data: JSON.stringify({ Enabled: false })
      })
      const configTag = result.Messages[0].Tags.find(
        (t: { name: string }) => t.name === 'configuration'
      ) as ConfigurationPatchTag | undefined
      expect(configTag!.value.Shares.Enabled).to.equal(true)
      expect(configTag!.value.Shares.SetSharesEnabled).to.equal(false)
    })
  })

  describe('Set-Share blocking when SetSharesEnabled is false', () => {
    it('Blocks Set-Share when SetSharesEnabled is false', async () => {
      // Enable shares feature first
      await handle({
        From: OWNER_ADDRESS,
        Tags: [{ name: 'Action', value: 'Toggle-Feature-Shares' }],
        Data: JSON.stringify({ Enabled: true })
      })

      // Disable set shares
      await handle({
        From: OWNER_ADDRESS,
        Tags: [{ name: 'Action', value: 'Toggle-Set-Shares' }],
        Data: JSON.stringify({ Enabled: false })
      })

      // Try to set share as operator
      const result = await handle({
        From: ALICE_ADDRESS,
        Tags: [{ name: 'Action', value: 'Set-Share' }],
        Data: JSON.stringify({ Share: 0.1 })
      })
      expect(result.Error).to.be.a('string').that.includes('Operator share setting is disabled')
    })

    it('Allows Set-Share when SetSharesEnabled is re-enabled', async () => {
      // Enable shares feature
      await handle({
        From: OWNER_ADDRESS,
        Tags: [{ name: 'Action', value: 'Toggle-Feature-Shares' }],
        Data: JSON.stringify({ Enabled: true })
      })

      // Disable set shares
      await handle({
        From: OWNER_ADDRESS,
        Tags: [{ name: 'Action', value: 'Toggle-Set-Shares' }],
        Data: JSON.stringify({ Enabled: false })
      })

      // Re-enable set shares
      await handle({
        From: OWNER_ADDRESS,
        Tags: [{ name: 'Action', value: 'Toggle-Set-Shares' }],
        Data: JSON.stringify({ Enabled: true })
      })

      // Set share as operator should work now
      const result = await handle({
        From: ALICE_ADDRESS,
        Tags: [{ name: 'Action', value: 'Set-Share' }],
        Data: JSON.stringify({ Share: 0.1 })
      })
      expect(result.Error).to.be.undefined
      expect(result.Messages).to.have.lengthOf(2)
      expect(result.Messages[1].Data).to.equal('OK')
    })
  })

  describe('Share calculation with SetSharesEnabled', () => {
    const score1 = { [ALICE_ADDRESS]: { [BOB_ADDRESS]: { Staked: '1000', Running: 0.6 } } }

    it('Uses default share when SetSharesEnabled is false, ignoring operator shares', async () => {
      // Enable shares feature
      await handle({
        From: OWNER_ADDRESS,
        Tags: [{ name: 'Action', value: 'Toggle-Feature-Shares' }],
        Data: JSON.stringify({ Enabled: true })
      })

      // Set default share to 0.15
      await handle({
        From: OWNER_ADDRESS,
        Tags: [{ name: 'Action', value: 'Update-Shares-Configuration' }],
        Data: JSON.stringify({ Default: 0.15 })
      })

      // Operator sets their share to 0.25
      await handle({
        From: BOB_ADDRESS,
        Tags: [{ name: 'Action', value: 'Set-Share' }],
        Data: JSON.stringify({ Share: 0.25 })
      })

      // Disable set shares - now all operators should use default
      await handle({
        From: OWNER_ADDRESS,
        Tags: [{ name: 'Action', value: 'Toggle-Set-Shares' }],
        Data: JSON.stringify({ Enabled: false })
      })

      // Configure tokens per second
      await handle({
        From: OWNER_ADDRESS,
        Tags: [{ name: 'Action', value: 'Update-Configuration' }],
        Data: JSON.stringify({ TokensPerSecond: '1000', Requirements: { Running: 0.5 } })
      })

      // Add scores
      await handle({
        From: OWNER_ADDRESS,
        Tags: [
          { name: 'Action', value: 'Add-Scores' },
          { name: 'Round-Timestamp', value: '1000' }
        ],
        Data: JSON.stringify({ Scores: score1 })
      })

      // Complete round
      const completeResult = await handle({
        From: OWNER_ADDRESS,
        Tags: [
          { name: 'Action', value: 'Complete-Round' },
          { name: 'Round-Timestamp', value: '1000' }
        ]
      })
      expect(completeResult.Messages).to.have.lengthOf(2)

      // Check the previous round details - should use Default (0.15), not operator's share (0.25)
      const prevRoundTag = completeResult.Messages[0].Tags.find(
        (t: { name: string }) => t.name === 'previous_round'
      )
      expect(prevRoundTag).to.exist
      expect(prevRoundTag.value.Details[ALICE_ADDRESS][BOB_ADDRESS].Score.Share).to.equal(0.15)
    })

    it('Uses operator share when SetSharesEnabled is true', async () => {
      // Enable shares feature
      await handle({
        From: OWNER_ADDRESS,
        Tags: [{ name: 'Action', value: 'Toggle-Feature-Shares' }],
        Data: JSON.stringify({ Enabled: true })
      })

      // Set default share to 0.15
      await handle({
        From: OWNER_ADDRESS,
        Tags: [{ name: 'Action', value: 'Update-Shares-Configuration' }],
        Data: JSON.stringify({ Default: 0.15 })
      })

      // Operator sets their share to 0.25
      await handle({
        From: BOB_ADDRESS,
        Tags: [{ name: 'Action', value: 'Set-Share' }],
        Data: JSON.stringify({ Share: 0.25 })
      })

      // SetSharesEnabled is true by default, operator's share should be used

      // Configure tokens per second
      await handle({
        From: OWNER_ADDRESS,
        Tags: [{ name: 'Action', value: 'Update-Configuration' }],
        Data: JSON.stringify({ TokensPerSecond: '1000', Requirements: { Running: 0.5 } })
      })

      // Add scores
      await handle({
        From: OWNER_ADDRESS,
        Tags: [
          { name: 'Action', value: 'Add-Scores' },
          { name: 'Round-Timestamp', value: '1000' }
        ],
        Data: JSON.stringify({ Scores: score1 })
      })

      // Complete round
      const completeResult = await handle({
        From: OWNER_ADDRESS,
        Tags: [
          { name: 'Action', value: 'Complete-Round' },
          { name: 'Round-Timestamp', value: '1000' }
        ]
      })
      expect(completeResult.Messages).to.have.lengthOf(2)

      // Check the previous round details - should use operator's share (0.25)
      const prevRoundTag = completeResult.Messages[0].Tags.find(
        (t: { name: string }) => t.name === 'previous_round'
      )
      expect(prevRoundTag).to.exist
      expect(prevRoundTag.value.Details[ALICE_ADDRESS][BOB_ADDRESS].Score.Share).to.equal(0.25)
    })

    it('Uses default share for operators without a set share when SetSharesEnabled is true', async () => {
      // Enable shares feature
      await handle({
        From: OWNER_ADDRESS,
        Tags: [{ name: 'Action', value: 'Toggle-Feature-Shares' }],
        Data: JSON.stringify({ Enabled: true })
      })

      // Set default share to 0.2
      await handle({
        From: OWNER_ADDRESS,
        Tags: [{ name: 'Action', value: 'Update-Shares-Configuration' }],
        Data: JSON.stringify({ Default: 0.2 })
      })

      // Do NOT set operator share - operator BOB has no share set

      // Configure tokens per second
      await handle({
        From: OWNER_ADDRESS,
        Tags: [{ name: 'Action', value: 'Update-Configuration' }],
        Data: JSON.stringify({ TokensPerSecond: '1000', Requirements: { Running: 0.5 } })
      })

      // Add scores
      await handle({
        From: OWNER_ADDRESS,
        Tags: [
          { name: 'Action', value: 'Add-Scores' },
          { name: 'Round-Timestamp', value: '1000' }
        ],
        Data: JSON.stringify({ Scores: score1 })
      })

      // Complete round
      const completeResult = await handle({
        From: OWNER_ADDRESS,
        Tags: [
          { name: 'Action', value: 'Complete-Round' },
          { name: 'Round-Timestamp', value: '1000' }
        ]
      })
      expect(completeResult.Messages).to.have.lengthOf(2)

      // Check the previous round details - should use Default (0.2)
      const prevRoundTag = completeResult.Messages[0].Tags.find(
        (t: { name: string }) => t.name === 'previous_round'
      )
      expect(prevRoundTag).to.exist
      expect(prevRoundTag.value.Details[ALICE_ADDRESS][BOB_ADDRESS].Score.Share).to.equal(0.2)
    })

    it('Preserves operator shares when SetSharesEnabled is toggled off and back on', async () => {
      // Enable shares feature
      await handle({
        From: OWNER_ADDRESS,
        Tags: [{ name: 'Action', value: 'Toggle-Feature-Shares' }],
        Data: JSON.stringify({ Enabled: true })
      })

      // Operator sets their share
      await handle({
        From: BOB_ADDRESS,
        Tags: [{ name: 'Action', value: 'Set-Share' }],
        Data: JSON.stringify({ Share: 0.3 })
      })

      // Disable set shares
      await handle({
        From: OWNER_ADDRESS,
        Tags: [{ name: 'Action', value: 'Toggle-Set-Shares' }],
        Data: JSON.stringify({ Enabled: false })
      })

      // Re-enable set shares
      await handle({
        From: OWNER_ADDRESS,
        Tags: [{ name: 'Action', value: 'Toggle-Set-Shares' }],
        Data: JSON.stringify({ Enabled: true })
      })

      // Configure and add scores
      await handle({
        From: OWNER_ADDRESS,
        Tags: [{ name: 'Action', value: 'Update-Configuration' }],
        Data: JSON.stringify({ TokensPerSecond: '1000', Requirements: { Running: 0.5 } })
      })

      await handle({
        From: OWNER_ADDRESS,
        Tags: [
          { name: 'Action', value: 'Add-Scores' },
          { name: 'Round-Timestamp', value: '1000' }
        ],
        Data: JSON.stringify({ Scores: score1 })
      })

      const completeResult = await handle({
        From: OWNER_ADDRESS,
        Tags: [
          { name: 'Action', value: 'Complete-Round' },
          { name: 'Round-Timestamp', value: '1000' }
        ]
      })

      // Operator's original share (0.3) should be preserved
      const prevRoundTag = completeResult.Messages[0].Tags.find(
        (t: { name: string }) => t.name === 'previous_round'
      )
      expect(prevRoundTag).to.exist
      expect(prevRoundTag.value.Details[ALICE_ADDRESS][BOB_ADDRESS].Score.Share).to.equal(0.3)
    })
  })
})
