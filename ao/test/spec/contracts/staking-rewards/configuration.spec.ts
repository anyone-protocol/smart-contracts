// ** Configuration Update Handler
import { expect } from 'chai'

import {
  ALICE_ADDRESS,
  AOTestHandle,
  createLoader,
  FINGERPRINT_A,
  OWNER_ADDRESS
} from '~/test/util/setup'

describe('Update-Configuration action of staking rewards', () => {
  let handle: AOTestHandle

  beforeEach(async () => {
    handle = (await createLoader('staking-rewards')).handle
  })

  it('Blocks non-owners from doing updates', async () => {
    const result = await handle({
      From: ALICE_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Update-Configuration' }
      ]
    })
    expect(result.Error).to.be.a('string').that.includes('Permission Denied')
  })

  it('Requires message data to be JSON', async () => {
    const result = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Update-Configuration' }
      ]
    })
    expect(result.Error).to.be.a('string').that.includes('Message data is required to process request')

    const resultWithData = await handle({
        From: OWNER_ADDRESS,
        Tags: [
            { name: 'Action', value: 'Update-Configuration' }
        ],
        Data: "Some data"
    })
    expect(resultWithData.Error).to.be.a('string').that.includes('Data must be valid JSON')
  })

  it('Ensures TokensPerSecond is a string integer and >= 0', async () => {
    const emptyTokensResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Update-Configuration' }
      ],
      Data: JSON.stringify({ TokensPerSecond: '' })
    })
    expect(emptyTokensResult.Error).to.be.a('string').that.includes('TokensPerSecond')

    const wrongTokensResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
        { name: 'Action', value: 'Update-Configuration' }
      ],
      Data: JSON.stringify({ TokensPerSecond: '-100' })
    })
    expect(wrongTokensResult.Error).to.be.a('string').that.includes('TokensPerSecond')
    
    const numberTokensResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
        { name: 'Action', value: 'Update-Configuration' }
      ],
      Data: JSON.stringify({ TokensPerSecond: 100 })
    })
    expect(numberTokensResult.Error).to.be.a('string').that.includes('TokensPerSecond')
  })

  it('Ensures Requirements - Running is a float 0..1', async () => {
    const emptyTokensResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Update-Configuration' }
      ],
      Data: JSON.stringify({ Requirements: { Running: '' } })
    })
    expect(emptyTokensResult.Error).to.be.a('string').that.includes('Running')

    const wrongTokensResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
        { name: 'Action', value: 'Update-Configuration' }
      ],
      Data: JSON.stringify({ Requirements: { Running: 1.1 } })
    })
    expect(wrongTokensResult.Error).to.be.a('string').that.includes('Running')
    
    const smallTokensResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
        { name: 'Action', value: 'Update-Configuration' }
      ],
      Data: JSON.stringify({ Requirements: { Running: -1.1 } })
    })
    expect(smallTokensResult.Error).to.be.a('string').that.includes('Running')

    const numberTokensResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
        { name: 'Action', value: 'Update-Configuration' }
      ],
      Data: JSON.stringify({ Requirements: { Running: '10' } })
    })
    expect(numberTokensResult.Error).to.be.a('string').that.includes('Running')
  })
})
