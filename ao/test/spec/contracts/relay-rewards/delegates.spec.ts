import { expect } from 'chai'

import {
    ALICE_ADDRESS,
  AOTestHandle,
  BOB_ADDRESS,
  createLoader,
  OWNER_ADDRESS
} from '~/test/util/setup'

describe('Update-Configuration Delegates of relay rewards', () => {
  let handle: AOTestHandle

  beforeEach(async () => {
    handle = (await createLoader('relay-rewards')).handle
  })

  it('Delegate share must be number between 0 and 1 inclusive', async () => {
    const stringShareResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Update-Configuration' }
      ],
      Data: JSON.stringify({
        Delegates: {
            [ALICE_ADDRESS]: {
                Address: BOB_ADDRESS,
                Share: 'abc'
            }
        }
      })
    })
    expect(stringShareResult.Error).to.be.a('string').that.includes('Delegates[' + ALICE_ADDRESS + '].Share')
    const boolShareResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Update-Configuration' }
      ],
      Data: JSON.stringify({
        Delegates: {
            [ALICE_ADDRESS]: {
                Address: BOB_ADDRESS,
                Share: true
            }
        }
      })
    })
    expect(boolShareResult.Error).to.be.a('string').that.includes('Delegates[' + ALICE_ADDRESS + '].Share')
    const maxShareResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Update-Configuration' }
      ],
      Data: JSON.stringify({
        Delegates: {
            [ALICE_ADDRESS]: {
                Address: BOB_ADDRESS,
                Share: 2
            }
        }
      })
    })
    expect(maxShareResult.Error).to.be.a('string').that.includes('Delegates[' + ALICE_ADDRESS + '].Share has to be <= 1')
    const minShareResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Update-Configuration' }
      ],
      Data: JSON.stringify({
        Delegates: {
            [ALICE_ADDRESS]: {
                Address: BOB_ADDRESS,
                Share: -2
            }
        }
      })
    })
    expect(minShareResult.Error).to.be.a('string').that.includes('Delegates[' + ALICE_ADDRESS + '].Share has to be >= 0')
  })

  it('Delegate address is validated', async () => {
    const stringAddressResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Update-Configuration' }
      ],
      Data: JSON.stringify({
        Delegates: {
            [ALICE_ADDRESS]: {
                Address: 'fail-address',
                Share: 0.1
            }
        }
      })
    })
    expect(stringAddressResult.Error).to.be.a('string').that.includes('Invalid delegated address for ' + ALICE_ADDRESS)
  })
  
  it('Operator address is validated', async () => {
    const stringAddressResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Update-Configuration' }
      ],
      Data: JSON.stringify({
        Delegates: {
            ['fail-address']: {
                Address: BOB_ADDRESS,
                Share: 0.1
            }
        }
      })
    })
    expect(stringAddressResult.Error).to.be.a('string').that.includes('Invalid operator address')
  })
})

describe('Set-Delegate of relay rewards', () => {
  let handle: AOTestHandle

  beforeEach(async () => {
    handle = (await createLoader('relay-rewards')).handle
  })

  it('Delegate share must be number between 0 and 1 inclusive', async () => {
    const stringShareResult = await handle({
      From: ALICE_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Set-Delegate' },
          { name: 'Address', value: BOB_ADDRESS },
          { name: 'Share', value: 'asd' },
      ]
    })
    expect(stringShareResult.Error).to.be.a('string').that.includes('Delegate.Share')
    const maxShareResult = await handle({
        From: ALICE_ADDRESS,
        Tags: [
            { name: 'Action', value: 'Set-Delegate' },
            { name: 'Address', value: BOB_ADDRESS },
            { name: 'Share', value: '2' },
        ]
    })
    expect(maxShareResult.Error).to.be.a('string').that.includes('Delegate.Share has to be <= 1')
    const minShareResult = await handle({
        From: ALICE_ADDRESS,
        Tags: [
            { name: 'Action', value: 'Set-Delegate' },
            { name: 'Address', value: BOB_ADDRESS },
            { name: 'Share', value: '-2' },
        ]
    })
    expect(minShareResult.Error).to.be.a('string').that.includes('Delegate.Share has to be >= 0')
  })
  
  it('Delegate address is validated', async () => {
    const stringAddressResult = await handle({
        From: ALICE_ADDRESS,
        Tags: [
            { name: 'Action', value: 'Set-Delegate' },
            { name: 'Address', value: 'fail-address' },
            { name: 'Share', value: '0.2' },
        ]
    })
    expect(stringAddressResult.Error).to.be.a('string').that.includes('Delegate address tag')
  })
  
  it('Operator address is validated', async () => {
    const stringAddressResult = await handle({
        From: 'fail-address',
        Tags: [
            { name: 'Action', value: 'Set-Delegate' },
            { name: 'Address', value: BOB_ADDRESS },
            { name: 'Share', value: '0.2' },
        ]
    })
    expect(stringAddressResult.Error).to.be.a('string').that.includes('Address tag')
  })
  
  it('Allows users to clear the Delegate', async () => {
    const firstResult = await handle({
        From: ALICE_ADDRESS,
        Tags: [
            { name: 'Action', value: 'Set-Delegate' },
            { name: 'Address', value: BOB_ADDRESS },
            { name: 'Share', value: '0.2' },
        ]
    })
    expect(firstResult.Messages).to.have.lengthOf(2)
    expect(firstResult.Messages[0].Tags).to.deep.include({
      name: 'device',
      value: 'patch@1.0'
    })
    const configurationTagValue = firstResult.Messages[0].Tags.find(
      t => t.name === 'configuration'
    )?.value
    expect(configurationTagValue).to.not.be.undefined
    expect(configurationTagValue).to.deep.include({
      Delegates: {
        [ALICE_ADDRESS]: {
          Address: BOB_ADDRESS,
          Share: 0.2
        }
      }
    })
    expect(firstResult.Messages[1].Data).to.equal('OK')

    const aliceResult = await handle({
        From: ALICE_ADDRESS,
        Tags: [
            { name: 'Action', value: 'Get-Delegate' }
        ]
    })
    expect(aliceResult.Messages).to.have.lengthOf(1)
    const aliceData = JSON.parse(aliceResult.Messages[0].Data)
    expect(aliceData.Address).to.equal(BOB_ADDRESS)
    expect(aliceData.Share).to.equal(0.2)

    const secondResult = await handle({
        From: ALICE_ADDRESS,
        Tags: [
            { name: 'Action', value: 'Set-Delegate' }
        ]
    })
    expect(secondResult.Messages).to.have.lengthOf(2)
    expect(secondResult.Messages[0].Tags).to.deep.include({
      name: 'device',
      value: 'patch@1.0'
    })
    const secondConfigurationTagValue = secondResult.Messages[0].Tags.find(
      t => t.name === 'configuration'
    )?.value
    expect(secondConfigurationTagValue).to.not.be.undefined
    expect(secondConfigurationTagValue).to.deep.include({
      Delegates: []
    })
    expect(secondResult.Messages[1].Data).to.equal('RESET')

    const resetResult = await handle({
        From: ALICE_ADDRESS,
        Tags: [
            { name: 'Action', value: 'Get-Delegate' }
        ]
    })
    expect(resetResult.Messages).to.have.lengthOf(1)
    const resetData = JSON.parse(resetResult.Messages[0].Data)
    expect(resetData.Address).to.equal('')
    expect(resetData.Share).to.equal(0)
  })
})
