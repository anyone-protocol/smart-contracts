import { expect } from 'chai'
import AoLoader from '@permaweb/ao-loader'

import {
  AO_ENV,
  createLoader,
  DEFAULT_HANDLE_OPTIONS,
  OWNER_ADDRESS
} from '../../util/setup'

describe('Relay Registry', () => {
  let originalHandle: AoLoader.handleFunction,
      memory: ArrayBuffer

  beforeEach(async () => {
    const loader = await createLoader()
    originalHandle = loader.handle
    memory = loader.memory
  })

  async function handle(
    options: Partial<AoLoader.Message> = {},
    mem = memory
  ) {
    return originalHandle(
      mem,
      {
        ...DEFAULT_HANDLE_OPTIONS,
        ...options,
      },
      AO_ENV
    )
  }

  it('Should respond "pong" to "ping" messages', async () => {
    const result = await handle({
      Tags: [{ name: 'Action', value: 'Ping' }]
    })

    expect(result.Messages).to.have.lengthOf(1)
    expect(result.Messages[0].Data).to.equal('pong')
  })
})
