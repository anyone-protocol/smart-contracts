import { expect } from 'chai'
import { scores } from './staging1-scores.js'
import { config } from './staging1-config.js'

import {
  AOTestHandle,
  createLoader,
  OWNER_ADDRESS
} from '~/test/util/setup'

describe('Staging tests of relay rewards', () => {
  let handle: AOTestHandle

  beforeEach(async () => {
    handle = (await createLoader('relay-rewards')).handle
  })

  it('passes vs staging1 data', async () => {
    const firstScoresResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Add-Scores' },
          { name: 'Timestamp', value: '100' }
      ],
      Data: JSON.stringify(scores)
    })
    expect(firstScoresResult.Messages).to.have.lengthOf(1)
    expect(firstScoresResult.Messages[0].Data).to.equal('OK')
    
    const firstCompleteResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Complete-Round' },
          { name: 'Timestamp', value: '100' }
      ]
    })
    expect(firstCompleteResult.Messages).to.have.lengthOf(1)
    expect(firstCompleteResult.Messages[0].Data).to.equal('OK')

    const configResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
        { name: 'Action', value: 'Update-Configuration' }
      ],
      Data: JSON.stringify(config)
    })
    expect(configResult.Messages).to.have.lengthOf(1)
    expect(configResult.Messages[0].Data).to.equal('OK')
    
    const secondScoresResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Add-Scores' },
          { name: 'Timestamp', value: '12345' }
      ],
      Data: JSON.stringify(scores)
    })
    expect(secondScoresResult.Messages).to.have.lengthOf(1)
    expect(secondScoresResult.Messages[0].Data).to.equal('OK')
    
    const secondCompleteResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Complete-Round' },
          { name: 'Timestamp', value: '12345' }
      ]
    })
    console.log(secondCompleteResult.Error)
    expect(secondCompleteResult.Messages).to.have.lengthOf(1)
    expect(secondCompleteResult.Messages[0].Data).to.equal('OK')
  })
})