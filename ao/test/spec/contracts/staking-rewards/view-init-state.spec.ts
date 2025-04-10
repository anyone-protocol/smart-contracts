import { expect } from 'chai'

import {
  ALICE_ADDRESS,
  AOTestHandle,
  CHARLS_ADDRESS,
  createLoader,
  OWNER_ADDRESS
} from '~/test/util/setup'

describe('staking-rewards-view-init-state', () => {
  let handle: AOTestHandle

  let config = {
    TokensPerSecond: '1000000000000',
    Requirements: { Running: 0.6 },
  }

  let scores = { Scores: { 
    [CHARLS_ADDRESS]: {
      [ALICE_ADDRESS]: {
        Staked: '1000', Running: 0.7, Share: 0
      },
      [CHARLS_ADDRESS]: {
        Staked: '3000', Running: 0.8, Share: 0
      }
    }
  }}

  beforeEach(async () => {
    handle = (await createLoader('staking-rewards')).handle
  })


  it('allows for reimport of the state during init', async () => {
    const firstScoresResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Add-Scores' },
          { name: 'Timestamp', value: '1741829169954' }
      ],
      Data: JSON.stringify(scores)
    })
    expect(firstScoresResult.Messages).to.have.lengthOf(1)
    expect(firstScoresResult.Messages[0].Data).to.equal('OK')
    
    const firstCompleteResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Complete-Round' },
          { name: 'Timestamp', value: '1741829169954' }
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
          { name: 'Timestamp', value: '1741829269954' }
      ],
      Data: JSON.stringify(scores)
    })
    expect(secondScoresResult.Messages).to.have.lengthOf(1)
    expect(secondScoresResult.Messages[0].Data).to.equal('OK')
    
    const secondCompleteResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Complete-Round' },
          { name: 'Timestamp', value: '1741829269954' }
      ]
    })
    expect(secondCompleteResult.Messages).to.have.lengthOf(1)
    expect(secondCompleteResult.Messages[0].Data).to.equal('OK')

    const viewStateResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'View-State' }
      ]
    })
    expect(viewStateResult.Messages).to.have.lengthOf(1)
    const state = viewStateResult.Messages[0].Data
    
    const newHandle = (await createLoader('staking-rewards')).handle
    const initStateResult = await newHandle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Init' }
      ],
      Data: state
    })
    
    expect(initStateResult.Messages).to.have.lengthOf(1)
    expect(initStateResult.Messages[0].Data).to.equal('OK')

    const viewState2Result = await newHandle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'View-State' }
      ]
    })
    expect(viewState2Result.Messages).to.have.lengthOf(1)
    const state2 = viewState2Result.Messages[0].Data
    const s = JSON.parse(state)
    const s2 = JSON.parse(state2)
    expect(s.PreviousRound.Period).to.be.equal(s2.PreviousRound.Period)
    expect(s.PreviousRound.Timestamp).to.be.equal(s2.PreviousRound.Timestamp)
    expect(s.Configuration.TokensPerSecond).to.be.equal(s2.Configuration.TokensPerSecond)
  })
})