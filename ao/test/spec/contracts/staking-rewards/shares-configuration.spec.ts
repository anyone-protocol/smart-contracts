// ** Shares Configuration Update Handler Tests
import { expect } from 'chai'

import {
  ALICE_ADDRESS,
  BOB_ADDRESS,
  CHARLS_ADDRESS,
  AOTestHandle,
  SharesPatchTag,
  createLoader,
  OWNER_ADDRESS
} from '~/test/util/setup'

describe('Update-Shares-Configuration action of staking rewards', () => {
  let handle: AOTestHandle

  beforeEach(async () => {
    handle = (await createLoader('staking-rewards')).handle
  })

  describe('Permission checks', () => {
    it('Blocks non-owners from doing updates', async () => {
      const result = await handle({
        From: ALICE_ADDRESS,
        Tags: [{ name: 'Action', value: 'Update-Shares-Configuration' }],
        Data: JSON.stringify({ Min: 0.1 })
      })
      expect(result.Error).to.be.a('string').that.includes('Permission Denied')
    })

    it('Allows owner to update shares configuration', async () => {
      const result = await handle({
        From: OWNER_ADDRESS,
        Tags: [{ name: 'Action', value: 'Update-Shares-Configuration' }],
        Data: JSON.stringify({ Default: 0.1 })
      })
      expect(result.Messages).to.have.lengthOf(2)
      expect(result.Messages[0].Tags).to.deep.include({ name: 'device', value: 'patch@1.0' })
      expect(result.Messages[1].Data).to.equal('OK')
    })

    it('Allows admin role to update shares configuration', async () => {
      // First grant admin role
      await handle({
        From: OWNER_ADDRESS,
        Tags: [{ name: 'Action', value: 'Update-Roles' }],
        Data: JSON.stringify({ Grant: { [ALICE_ADDRESS]: ['admin'] } })
      })

      const result = await handle({
        From: ALICE_ADDRESS,
        Tags: [{ name: 'Action', value: 'Update-Shares-Configuration' }],
        Data: JSON.stringify({ Default: 0.2 })
      })
      expect(result.Messages).to.have.lengthOf(2)
      expect(result.Messages[1].Data).to.equal('OK')
    })

    it('Allows Update-Shares-Configuration specific role', async () => {
      // Grant specific action role
      const grantResult = await handle({
        From: OWNER_ADDRESS,
        Tags: [{ name: 'Action', value: 'Update-Roles' }],
        Data: JSON.stringify({ Grant: { [BOB_ADDRESS]: ['Update-Shares-Configuration'] } })
      })
      // Update-Roles emits both a patch and OK response
      expect(grantResult.Messages.length).to.be.greaterThanOrEqual(1)

      // Set Min with a compatible Default value
      const result = await handle({
        From: BOB_ADDRESS,
        Tags: [{ name: 'Action', value: 'Update-Shares-Configuration' }],
        Data: JSON.stringify({ Min: 0.05, Default: 0.05 })
      })
      expect(result.Error).to.be.undefined
      expect(result.Messages).to.have.lengthOf(2)
      expect(result.Messages[1].Data).to.equal('OK')
    })

    it('Denies users with other roles but not Update-Shares-Configuration', async () => {
      // Grant a different role
      await handle({
        From: OWNER_ADDRESS,
        Tags: [{ name: 'Action', value: 'Update-Roles' }],
        Data: JSON.stringify({ Grant: { [CHARLS_ADDRESS]: ['Add-Scores'] } })
      })

      const result = await handle({
        From: CHARLS_ADDRESS,
        Tags: [{ name: 'Action', value: 'Update-Shares-Configuration' }],
        Data: JSON.stringify({ Default: 0.1 })
      })
      expect(result.Error).to.be.a('string').that.includes('Permission Denied')
    })
  })

  describe('Input validation', () => {
    it('Requires message data to be JSON', async () => {
      const noDataResult = await handle({
        From: OWNER_ADDRESS,
        Tags: [{ name: 'Action', value: 'Update-Shares-Configuration' }]
      })
      expect(noDataResult.Error).to.be.a('string').that.includes('Message data is required')

      const invalidJsonResult = await handle({
        From: OWNER_ADDRESS,
        Tags: [{ name: 'Action', value: 'Update-Shares-Configuration' }],
        Data: 'not-json'
      })
      expect(invalidJsonResult.Error).to.be.a('string').that.includes('Data must be valid JSON')
    })

    it('Ensures Min is a number between 0 and 1', async () => {
      const stringResult = await handle({
        From: OWNER_ADDRESS,
        Tags: [{ name: 'Action', value: 'Update-Shares-Configuration' }],
        Data: JSON.stringify({ Min: 'string' })
      })
      expect(stringResult.Error).to.be.a('string').that.includes('Min')

      const belowZeroResult = await handle({
        From: OWNER_ADDRESS,
        Tags: [{ name: 'Action', value: 'Update-Shares-Configuration' }],
        Data: JSON.stringify({ Min: -0.1 })
      })
      expect(belowZeroResult.Error).to.be.a('string').that.includes('Min has to be >= 0')

      const aboveOneResult = await handle({
        From: OWNER_ADDRESS,
        Tags: [{ name: 'Action', value: 'Update-Shares-Configuration' }],
        Data: JSON.stringify({ Min: 1.1 })
      })
      expect(aboveOneResult.Error).to.be.a('string').that.includes('Min has to be <= 1')
    })

    it('Ensures Max is a number between 0 and 1', async () => {
      const stringResult = await handle({
        From: OWNER_ADDRESS,
        Tags: [{ name: 'Action', value: 'Update-Shares-Configuration' }],
        Data: JSON.stringify({ Max: 'string' })
      })
      expect(stringResult.Error).to.be.a('string').that.includes('Max')

      const belowZeroResult = await handle({
        From: OWNER_ADDRESS,
        Tags: [{ name: 'Action', value: 'Update-Shares-Configuration' }],
        Data: JSON.stringify({ Max: -0.1 })
      })
      expect(belowZeroResult.Error).to.be.a('string').that.includes('Max has to be >= 0')

      const aboveOneResult = await handle({
        From: OWNER_ADDRESS,
        Tags: [{ name: 'Action', value: 'Update-Shares-Configuration' }],
        Data: JSON.stringify({ Max: 1.5 })
      })
      expect(aboveOneResult.Error).to.be.a('string').that.includes('Max has to be <= 1')
    })

    it('Ensures Default is a number between 0 and 1', async () => {
      const stringResult = await handle({
        From: OWNER_ADDRESS,
        Tags: [{ name: 'Action', value: 'Update-Shares-Configuration' }],
        Data: JSON.stringify({ Default: 'string' })
      })
      expect(stringResult.Error).to.be.a('string').that.includes('Default')

      const belowZeroResult = await handle({
        From: OWNER_ADDRESS,
        Tags: [{ name: 'Action', value: 'Update-Shares-Configuration' }],
        Data: JSON.stringify({ Default: -0.5 })
      })
      expect(belowZeroResult.Error).to.be.a('string').that.includes('Default has to be >= 0')

      const aboveOneResult = await handle({
        From: OWNER_ADDRESS,
        Tags: [{ name: 'Action', value: 'Update-Shares-Configuration' }],
        Data: JSON.stringify({ Default: 2.0 })
      })
      expect(aboveOneResult.Error).to.be.a('string').that.includes('Default has to be <= 1')
    })

    it('Accepts edge case values 0.0 and 1.0', async () => {
      const zeroResult = await handle({
        From: OWNER_ADDRESS,
        Tags: [{ name: 'Action', value: 'Update-Shares-Configuration' }],
        Data: JSON.stringify({ Min: 0.0, Max: 1.0, Default: 0.0 })
      })
      expect(zeroResult.Messages).to.have.lengthOf(2)
      expect(zeroResult.Messages[1].Data).to.equal('OK')

      const oneResult = await handle({
        From: OWNER_ADDRESS,
        Tags: [{ name: 'Action', value: 'Update-Shares-Configuration' }],
        Data: JSON.stringify({ Min: 1.0, Max: 1.0, Default: 1.0 })
      })
      expect(oneResult.Messages).to.have.lengthOf(2)
      expect(oneResult.Messages[1].Data).to.equal('OK')
    })
  })

  describe('Optional field handling', () => {
    it('Allows omitting all fields (no-op update)', async () => {
      const result = await handle({
        From: OWNER_ADDRESS,
        Tags: [{ name: 'Action', value: 'Update-Shares-Configuration' }],
        Data: JSON.stringify({})
      })
      expect(result.Messages).to.have.lengthOf(2)
      expect(result.Messages[1].Data).to.equal('OK')
    })

    it('Updates only Min when only Min is provided', async () => {
      // First set all values
      await handle({
        From: OWNER_ADDRESS,
        Tags: [{ name: 'Action', value: 'Update-Shares-Configuration' }],
        Data: JSON.stringify({ Min: 0.1, Max: 0.9, Default: 0.5 })
      })

      // Update only Min
      const result = await handle({
        From: OWNER_ADDRESS,
        Tags: [{ name: 'Action', value: 'Update-Shares-Configuration' }],
        Data: JSON.stringify({ Min: 0.2 })
      })
      expect(result.Messages).to.have.lengthOf(2)
      expect(result.Messages[1].Data).to.equal('OK')

      // Verify state - Max and Default should be unchanged
      const stateResult = await handle({
        From: OWNER_ADDRESS,
        Tags: [{ name: 'Action', value: 'View-State' }]
      })
      const state = JSON.parse(stateResult.Messages[0].Data)
      expect(state.Configuration.Shares.Min).to.equal(0.2)
      expect(state.Configuration.Shares.Max).to.equal(0.9)
      expect(state.Configuration.Shares.Default).to.equal(0.5)
    })

    it('Updates only Max when only Max is provided', async () => {
      await handle({
        From: OWNER_ADDRESS,
        Tags: [{ name: 'Action', value: 'Update-Shares-Configuration' }],
        Data: JSON.stringify({ Min: 0.1, Max: 0.9, Default: 0.5 })
      })

      const result = await handle({
        From: OWNER_ADDRESS,
        Tags: [{ name: 'Action', value: 'Update-Shares-Configuration' }],
        Data: JSON.stringify({ Max: 0.8 })
      })
      expect(result.Messages).to.have.lengthOf(2)
      expect(result.Messages[1].Data).to.equal('OK')

      const stateResult = await handle({
        From: OWNER_ADDRESS,
        Tags: [{ name: 'Action', value: 'View-State' }]
      })
      const state = JSON.parse(stateResult.Messages[0].Data)
      expect(state.Configuration.Shares.Min).to.equal(0.1)
      expect(state.Configuration.Shares.Max).to.equal(0.8)
      expect(state.Configuration.Shares.Default).to.equal(0.5)
    })

    it('Updates only Default when only Default is provided', async () => {
      await handle({
        From: OWNER_ADDRESS,
        Tags: [{ name: 'Action', value: 'Update-Shares-Configuration' }],
        Data: JSON.stringify({ Min: 0.1, Max: 0.9, Default: 0.5 })
      })

      const result = await handle({
        From: OWNER_ADDRESS,
        Tags: [{ name: 'Action', value: 'Update-Shares-Configuration' }],
        Data: JSON.stringify({ Default: 0.3 })
      })
      expect(result.Messages).to.have.lengthOf(2)
      expect(result.Messages[1].Data).to.equal('OK')

      const stateResult = await handle({
        From: OWNER_ADDRESS,
        Tags: [{ name: 'Action', value: 'View-State' }]
      })
      const state = JSON.parse(stateResult.Messages[0].Data)
      expect(state.Configuration.Shares.Min).to.equal(0.1)
      expect(state.Configuration.Shares.Max).to.equal(0.9)
      expect(state.Configuration.Shares.Default).to.equal(0.3)
    })
  })

  describe('Cross-validation constraints', () => {
    it('Rejects Min > Max', async () => {
      const result = await handle({
        From: OWNER_ADDRESS,
        Tags: [{ name: 'Action', value: 'Update-Shares-Configuration' }],
        Data: JSON.stringify({ Min: 0.8, Max: 0.2 })
      })
      expect(result.Error).to.be.a('string').that.includes('Min must be <= Max')
    })

    it('Rejects Default < Min', async () => {
      const result = await handle({
        From: OWNER_ADDRESS,
        Tags: [{ name: 'Action', value: 'Update-Shares-Configuration' }],
        Data: JSON.stringify({ Min: 0.3, Max: 0.9, Default: 0.1 })
      })
      expect(result.Error).to.be.a('string').that.includes('Default must be >= Min')
    })

    it('Rejects Default > Max', async () => {
      const result = await handle({
        From: OWNER_ADDRESS,
        Tags: [{ name: 'Action', value: 'Update-Shares-Configuration' }],
        Data: JSON.stringify({ Min: 0.1, Max: 0.5, Default: 0.8 })
      })
      expect(result.Error).to.be.a('string').that.includes('Default must be <= Max')
    })

    it('Rejects updating Min above existing Default', async () => {
      // Set initial state with Default = 0.3
      await handle({
        From: OWNER_ADDRESS,
        Tags: [{ name: 'Action', value: 'Update-Shares-Configuration' }],
        Data: JSON.stringify({ Min: 0.1, Max: 0.9, Default: 0.3 })
      })

      // Try to set Min = 0.5 which is > Default
      const result = await handle({
        From: OWNER_ADDRESS,
        Tags: [{ name: 'Action', value: 'Update-Shares-Configuration' }],
        Data: JSON.stringify({ Min: 0.5 })
      })
      expect(result.Error).to.be.a('string').that.includes('Default must be >= Min')
    })

    it('Rejects updating Max below existing Default', async () => {
      await handle({
        From: OWNER_ADDRESS,
        Tags: [{ name: 'Action', value: 'Update-Shares-Configuration' }],
        Data: JSON.stringify({ Min: 0.1, Max: 0.9, Default: 0.7 })
      })

      const result = await handle({
        From: OWNER_ADDRESS,
        Tags: [{ name: 'Action', value: 'Update-Shares-Configuration' }],
        Data: JSON.stringify({ Max: 0.5 })
      })
      expect(result.Error).to.be.a('string').that.includes('Default must be <= Max')
    })

    it('Allows Min == Max == Default', async () => {
      const result = await handle({
        From: OWNER_ADDRESS,
        Tags: [{ name: 'Action', value: 'Update-Shares-Configuration' }],
        Data: JSON.stringify({ Min: 0.5, Max: 0.5, Default: 0.5 })
      })
      expect(result.Messages).to.have.lengthOf(2)
      expect(result.Messages[1].Data).to.equal('OK')
    })
  })

  describe('Retroactive clamping of existing operator shares', () => {
    it('Clamps existing shares when Min is raised', async () => {
      // Enable shares and SetSharesEnabled
      await handle({
        From: OWNER_ADDRESS,
        Tags: [{ name: 'Action', value: 'Toggle-Feature-Shares' }],
        Data: JSON.stringify({ Enabled: true })
      })
      await handle({
        From: OWNER_ADDRESS,
        Tags: [{ name: 'Action', value: 'Update-Shares-Configuration' }],
        Data: JSON.stringify({ SetSharesEnabled: true, ChangeDelaySeconds: 0 })
      })

      await handle({
        From: ALICE_ADDRESS,
        Tags: [{ name: 'Action', value: 'Set-Share' }],
        Data: JSON.stringify({ Share: 0.1 })
      })

      // Raise Min to 0.3
      const result = await handle({
        From: OWNER_ADDRESS,
        Tags: [{ name: 'Action', value: 'Update-Shares-Configuration' }],
        Data: JSON.stringify({ Min: 0.3, Default: 0.3 })
      })

      // Should have 2 messages: single patch (config+shares), OK response
      expect(result.Messages).to.have.lengthOf(2)
      expect(result.Messages[0].Tags).to.deep.include({ name: 'device', value: 'patch@1.0' })
      expect(result.Messages[1].Data).to.equal('OK')

      // Verify share was clamped
      const stateResult = await handle({
        From: OWNER_ADDRESS,
        Tags: [{ name: 'Action', value: 'View-State' }]
      })
      const state = JSON.parse(stateResult.Messages[0].Data)
      expect(state.Shares[ALICE_ADDRESS]).to.equal(0.3)
    })

    it('Clamps existing shares when Max is lowered', async () => {
      await handle({
        From: OWNER_ADDRESS,
        Tags: [{ name: 'Action', value: 'Toggle-Feature-Shares' }],
        Data: JSON.stringify({ Enabled: true })
      })
      await handle({
        From: OWNER_ADDRESS,
        Tags: [{ name: 'Action', value: 'Update-Shares-Configuration' }],
        Data: JSON.stringify({ SetSharesEnabled: true, ChangeDelaySeconds: 0 })
      })

      await handle({
        From: ALICE_ADDRESS,
        Tags: [{ name: 'Action', value: 'Set-Share' }],
        Data: JSON.stringify({ Share: 0.8 })
      })

      // Lower Max to 0.5
      const result = await handle({
        From: OWNER_ADDRESS,
        Tags: [{ name: 'Action', value: 'Update-Shares-Configuration' }],
        Data: JSON.stringify({ Max: 0.5 })
      })

      expect(result.Messages).to.have.lengthOf(2)

      const stateResult = await handle({
        From: OWNER_ADDRESS,
        Tags: [{ name: 'Action', value: 'View-State' }]
      })
      const state = JSON.parse(stateResult.Messages[0].Data)
      expect(state.Shares[ALICE_ADDRESS]).to.equal(0.5)
    })

    it('Does not emit shares patch when no clamping is needed', async () => {
      await handle({
        From: OWNER_ADDRESS,
        Tags: [{ name: 'Action', value: 'Toggle-Feature-Shares' }],
        Data: JSON.stringify({ Enabled: true })
      })
      await handle({
        From: OWNER_ADDRESS,
        Tags: [{ name: 'Action', value: 'Update-Shares-Configuration' }],
        Data: JSON.stringify({ SetSharesEnabled: true, ChangeDelaySeconds: 0 })
      })

      await handle({
        From: ALICE_ADDRESS,
        Tags: [{ name: 'Action', value: 'Set-Share' }],
        Data: JSON.stringify({ Share: 0.5 })
      })

      // Update Min and Max that don't affect the 0.5 share
      const result = await handle({
        From: OWNER_ADDRESS,
        Tags: [{ name: 'Action', value: 'Update-Shares-Configuration' }],
        Data: JSON.stringify({ Min: 0.1, Max: 0.9, Default: 0.5 })
      })

      // Only 2 messages: config patch, OK response (no shares patch)
      expect(result.Messages).to.have.lengthOf(2)
      expect(result.Messages[0].Tags).to.deep.include({ name: 'device', value: 'patch@1.0' })
      expect(result.Messages[1].Data).to.equal('OK')

      // Verify share is unchanged
      const stateResult = await handle({
        From: OWNER_ADDRESS,
        Tags: [{ name: 'Action', value: 'View-State' }]
      })
      const state = JSON.parse(stateResult.Messages[0].Data)
      expect(state.Shares[ALICE_ADDRESS]).to.equal(0.5)
    })

    it('Clamps multiple operator shares simultaneously', async () => {
      await handle({
        From: OWNER_ADDRESS,
        Tags: [{ name: 'Action', value: 'Toggle-Feature-Shares' }],
        Data: JSON.stringify({ Enabled: true })
      })
      await handle({
        From: OWNER_ADDRESS,
        Tags: [{ name: 'Action', value: 'Update-Shares-Configuration' }],
        Data: JSON.stringify({ SetSharesEnabled: true, ChangeDelaySeconds: 0 })
      })

      await handle({
        From: ALICE_ADDRESS,
        Tags: [{ name: 'Action', value: 'Set-Share' }],
        Data: JSON.stringify({ Share: 0.1 })
      })

      await handle({
        From: BOB_ADDRESS,
        Tags: [{ name: 'Action', value: 'Set-Share' }],
        Data: JSON.stringify({ Share: 0.9 })
      })

      // Set bounds that clamp both
      const result = await handle({
        From: OWNER_ADDRESS,
        Tags: [{ name: 'Action', value: 'Update-Shares-Configuration' }],
        Data: JSON.stringify({ Min: 0.3, Max: 0.7, Default: 0.5 })
      })

      expect(result.Messages).to.have.lengthOf(2)

      const stateResult = await handle({
        From: OWNER_ADDRESS,
        Tags: [{ name: 'Action', value: 'View-State' }]
      })
      const state = JSON.parse(stateResult.Messages[0].Data)
      expect(state.Shares[ALICE_ADDRESS]).to.equal(0.3)
      expect(state.Shares[BOB_ADDRESS]).to.equal(0.7)
    })

    it('Includes all shares in patch when any are modified', async () => {
      await handle({
        From: OWNER_ADDRESS,
        Tags: [{ name: 'Action', value: 'Toggle-Feature-Shares' }],
        Data: JSON.stringify({ Enabled: true })
      })
      await handle({
        From: OWNER_ADDRESS,
        Tags: [{ name: 'Action', value: 'Update-Shares-Configuration' }],
        Data: JSON.stringify({ SetSharesEnabled: true, ChangeDelaySeconds: 0 })
      })

      // Set shares for multiple operators
      await handle({
        From: ALICE_ADDRESS,
        Tags: [{ name: 'Action', value: 'Set-Share' }],
        Data: JSON.stringify({ Share: 0.1 })
      })

      await handle({
        From: BOB_ADDRESS,
        Tags: [{ name: 'Action', value: 'Set-Share' }],
        Data: JSON.stringify({ Share: 0.5 })
      })

      // Lower Max to 0.6 - only Alice's share needs clamping (to Min 0.3)
      const result = await handle({
        From: OWNER_ADDRESS,
        Tags: [{ name: 'Action', value: 'Update-Shares-Configuration' }],
        Data: JSON.stringify({ Min: 0.3, Default: 0.3 })
      })

      expect(result.Messages).to.have.lengthOf(2)
      // The single patch contains configuration AND all shares
      const sharesPatch = result.Messages[0].Tags.find(
        (t: { name: string }) => t.name === 'shares'
      ) as SharesPatchTag | undefined
      expect(sharesPatch).to.exist
      expect(sharesPatch!.value[ALICE_ADDRESS]).to.equal(0.3)  // clamped
      expect(sharesPatch!.value[BOB_ADDRESS]).to.equal(0.5)    // unchanged
    })

    it('Handles empty Shares state gracefully', async () => {
      const result = await handle({
        From: OWNER_ADDRESS,
        Tags: [{ name: 'Action', value: 'Update-Shares-Configuration' }],
        Data: JSON.stringify({ Min: 0.2, Max: 0.8, Default: 0.5 })
      })

      expect(result.Messages).to.have.lengthOf(2)
      expect(result.Messages[1].Data).to.equal('OK')
    })
  })
})

describe('Set-Share respects configuration bounds', () => {
  let handle: AOTestHandle

  beforeEach(async () => {
    handle = (await createLoader('staking-rewards')).handle
    // Enable shares feature and SetSharesEnabled
    await handle({
      From: OWNER_ADDRESS,
      Tags: [{ name: 'Action', value: 'Toggle-Feature-Shares' }],
      Data: JSON.stringify({ Enabled: true })
    })
    await handle({
      From: OWNER_ADDRESS,
      Tags: [{ name: 'Action', value: 'Update-Shares-Configuration' }],
      Data: JSON.stringify({ SetSharesEnabled: true })
    })
  })

  it('Rejects share below configured Min', async () => {
    await handle({
      From: OWNER_ADDRESS,
      Tags: [{ name: 'Action', value: 'Update-Shares-Configuration' }],
      Data: JSON.stringify({ Min: 0.2, Max: 0.8, Default: 0.5 })
    })

    const result = await handle({
      From: ALICE_ADDRESS,
      Tags: [{ name: 'Action', value: 'Set-Share' }],
      Data: JSON.stringify({ Share: 0.1 })
    })
    expect(result.Error).to.be.a('string').that.includes('Share has to be >= 0.2')
  })

  it('Rejects share above configured Max', async () => {
    await handle({
      From: OWNER_ADDRESS,
      Tags: [{ name: 'Action', value: 'Update-Shares-Configuration' }],
      Data: JSON.stringify({ Min: 0.2, Max: 0.8, Default: 0.5 })
    })

    const result = await handle({
      From: ALICE_ADDRESS,
      Tags: [{ name: 'Action', value: 'Set-Share' }],
      Data: JSON.stringify({ Share: 0.9 })
    })
    expect(result.Error).to.be.a('string').that.includes('Share has to be <= 0.8')
  })

  it('Allows share exactly at Min boundary', async () => {
    await handle({
      From: OWNER_ADDRESS,
      Tags: [{ name: 'Action', value: 'Update-Shares-Configuration' }],
      Data: JSON.stringify({ Min: 0.2, Max: 0.8, Default: 0.5 })
    })

    const result = await handle({
      From: ALICE_ADDRESS,
      Tags: [{ name: 'Action', value: 'Set-Share' }],
      Data: JSON.stringify({ Share: 0.2 })
    })
    expect(result.Messages).to.have.lengthOf(2)
    expect(result.Messages[1].Data).to.equal('OK')
  })

  it('Allows share exactly at Max boundary', async () => {
    await handle({
      From: OWNER_ADDRESS,
      Tags: [{ name: 'Action', value: 'Update-Shares-Configuration' }],
      Data: JSON.stringify({ Min: 0.2, Max: 0.8, Default: 0.5 })
    })

    const result = await handle({
      From: ALICE_ADDRESS,
      Tags: [{ name: 'Action', value: 'Set-Share' }],
      Data: JSON.stringify({ Share: 0.8 })
    })
    expect(result.Messages).to.have.lengthOf(2)
    expect(result.Messages[1].Data).to.equal('OK')
  })

  it('Uses default 0-1 bounds when configuration not updated', async () => {
    // Without updating config, Min=0 and Max=1 (defaults)
    const zeroResult = await handle({
      From: ALICE_ADDRESS,
      Tags: [{ name: 'Action', value: 'Set-Share' }],
      Data: JSON.stringify({ Share: 0.0 })
    })
    expect(zeroResult.Messages).to.have.lengthOf(2)
    expect(zeroResult.Messages[1].Data).to.equal('OK')

    const oneResult = await handle({
      From: BOB_ADDRESS,
      Tags: [{ name: 'Action', value: 'Set-Share' }],
      Data: JSON.stringify({ Share: 1.0 })
    })
    expect(oneResult.Messages).to.have.lengthOf(2)
    expect(oneResult.Messages[1].Data).to.equal('OK')
  })
})

describe('Toggle-Feature-Shares with Configuration.Shares.Enabled', () => {
  let handle: AOTestHandle

  beforeEach(async () => {
    handle = (await createLoader('staking-rewards')).handle
  })

  it('Enables shares feature via Configuration.Shares.Enabled', async () => {
    const result = await handle({
      From: OWNER_ADDRESS,
      Tags: [{ name: 'Action', value: 'Toggle-Feature-Shares' }],
      Data: JSON.stringify({ Enabled: true })
    })

    expect(result.Messages).to.have.lengthOf(2)
    expect(result.Messages[0].Tags).to.deep.include({ name: 'device', value: 'patch@1.0' })
    expect(result.Messages[1].Data).to.equal('OK')

    // Verify via View-State
    const stateResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [{ name: 'Action', value: 'View-State' }]
    })
    const state = JSON.parse(stateResult.Messages[0].Data)
    expect(state.Configuration.Shares.Enabled).to.equal(true)
  })

  it('Disables shares feature via Configuration.Shares.Enabled', async () => {
    // First enable
    await handle({
      From: OWNER_ADDRESS,
      Tags: [{ name: 'Action', value: 'Toggle-Feature-Shares' }],
      Data: JSON.stringify({ Enabled: true })
    })

    // Then disable
    const result = await handle({
      From: OWNER_ADDRESS,
      Tags: [{ name: 'Action', value: 'Toggle-Feature-Shares' }],
      Data: JSON.stringify({ Enabled: false })
    })

    expect(result.Messages).to.have.lengthOf(2)
    expect(result.Messages[1].Data).to.equal('OK')

    const stateResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [{ name: 'Action', value: 'View-State' }]
    })
    const state = JSON.parse(stateResult.Messages[0].Data)
    expect(state.Configuration.Shares.Enabled).to.equal(false)
  })

  it('Set-Share is blocked when shares are disabled', async () => {
    const result = await handle({
      From: ALICE_ADDRESS,
      Tags: [{ name: 'Action', value: 'Set-Share' }],
      Data: JSON.stringify({ Share: 0.5 })
    })
    expect(result.Error).to.be.a('string').that.includes('Shares feature is disabled')
  })
})
