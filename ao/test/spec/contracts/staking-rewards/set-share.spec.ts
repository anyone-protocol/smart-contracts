import { expect } from 'chai'

import {
  AOTestHandle,
  ConfigurationPatchTag,
  createLoader,
  OWNER_ADDRESS,
  ALICE_ADDRESS
} from '~/test/util/setup'

describe('Set-Share action of staking rewards', () => {
  let handle: AOTestHandle

  beforeEach(async () => {
    handle = (await createLoader('staking-rewards')).handle
    // Enable shares feature
    await handle({
      From: OWNER_ADDRESS,
      Tags: [{ name: 'Action', value: 'Toggle-Feature-Shares' }],
      Data: JSON.stringify({ Enabled: true })
    })
    // Enable SetSharesEnabled for operators to call Set-Share
    await handle({
      From: OWNER_ADDRESS,
      Tags: [{ name: 'Action', value: 'Update-Shares-Configuration' }],
      Data: JSON.stringify({ SetSharesEnabled: true })
    })
  })

  describe('Input validation', () => {
    it('Rejects empty Share value', async () => {
      const result = await handle({
        From: ALICE_ADDRESS,
        Tags: [{ name: 'Action', value: 'Set-Share' }],
        Data: JSON.stringify({ Share: '' })
      })
      expect(result.Error).to.be.a('string').that.includes('Number value required')
    })

    it('Rejects string Share value', async () => {
      const result = await handle({
        From: ALICE_ADDRESS,
        Tags: [{ name: 'Action', value: 'Set-Share' }],
        Data: JSON.stringify({ Share: '1' })
      })
      expect(result.Error).to.be.a('string').that.includes('Number value required')
    })

    it('Rejects Share > 1', async () => {
      const result = await handle({
        From: ALICE_ADDRESS,
        Tags: [{ name: 'Action', value: 'Set-Share' }],
        Data: JSON.stringify({ Share: 1.1 })
      })
      expect(result.Error).to.be.a('string').that.includes('has to be <= 1')
    })

    it('Rejects Share < 0', async () => {
      const result = await handle({
        From: ALICE_ADDRESS,
        Tags: [{ name: 'Action', value: 'Set-Share' }],
        Data: JSON.stringify({ Share: -0.1 })
      })
      expect(result.Error).to.be.a('string').that.includes('has to be >= 0')
    })

    it('Accepts Share of 0', async () => {
      const result = await handle({
        From: ALICE_ADDRESS,
        Tags: [{ name: 'Action', value: 'Set-Share' }],
        Data: JSON.stringify({ Share: 0 })
      })
      expect(result.Messages).to.have.lengthOf(2)
      expect(result.Messages[1].Data).to.equal('OK')
    })

    it('Accepts Share of 1', async () => {
      const result = await handle({
        From: ALICE_ADDRESS,
        Tags: [{ name: 'Action', value: 'Set-Share' }],
        Data: JSON.stringify({ Share: 1 })
      })
      expect(result.Messages).to.have.lengthOf(2)
      expect(result.Messages[1].Data).to.equal('OK')
    })

    it('Accepts valid Share between 0 and 1', async () => {
      const result = await handle({
        From: ALICE_ADDRESS,
        Tags: [{ name: 'Action', value: 'Set-Share' }],
        Data: JSON.stringify({ Share: 0.5 })
      })
      expect(result.Messages).to.have.lengthOf(2)
      expect(result.Messages[1].Data).to.equal('OK')
    })
  })
})
