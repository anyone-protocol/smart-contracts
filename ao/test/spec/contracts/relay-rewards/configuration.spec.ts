// ** Configuration Update Handler
import { expect } from 'chai'

import {
  ALICE_ADDRESS,
  AOTestHandle,
  createLoader,
  FINGERPRINT_A,
  OWNER_ADDRESS
} from '~/test/util/setup'

describe('Update-Configuration action of relay rewards', () => {
  let handle: AOTestHandle

  beforeEach(async () => {
    handle = (await createLoader('relay-rewards')).handle
  })

  it('Blocks non-owners from doing updates', async () => {
    const result = await handle({
      From: ALICE_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Update-Configuration' }
      ]
    })
    expect(result.Error).to.be.a('string').that.includes('This method is only available to the Owner')
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

  it('Ensures TokensPerSecond is an integer and >= 0', async () => {
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
      Data: JSON.stringify({ TokensPerSecond: -100 })
    })
    expect(wrongTokensResult.Error).to.be.a('string').that.includes('TokensPerSecond')
    
    const boolTolemsResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
        { name: 'Action', value: 'Update-Configuration' }
      ],
      Data: JSON.stringify({ TokensPerSecond: true })
    })
    expect(boolTolemsResult.Error).to.be.a('string').that.includes('TokensPerSecond')
  })
})
