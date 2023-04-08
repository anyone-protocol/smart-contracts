import { expect } from 'chai'
import { Contract } from 'ethers'
import hardhat from 'hardhat'

const AtorAddress = '0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa'
const fingerprintA = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
const fingerprintB = 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB'

describe('RelayRegistry Contract', () => {
  let registry: Contract

  beforeEach(async () => {
    const RelayRegistry = await hardhat
      .ethers
      .getContractFactory('RelayRegistry')

    registry = await RelayRegistry.deploy(AtorAddress)
  })

  it('Deploys with reference to ATOR token contract address', async () => {
    expect(await registry.tokenContract()).to.equal(AtorAddress)
  })

  it('Allows anyone to register a relay with valid fingerprint', async () => {
    await registry.registerRelay(fingerprintA)
    await registry.registerRelay(fingerprintB)
    const claims = await registry.claims()

    expect(claims.length).to.equal(2)
    expect(claims[0].fingerprint).to.equal(fingerprintA)
    expect(claims[1].fingerprint).to.equal(fingerprintB)
  })

  it('Fires an event on successful relay registration', async () => {
    expect.fail('Test Not Implemented!')
  })

  it('Rejects relay registration of invalid fingerprints', async () => {
    // TODO -> fingerprint length
    // TODO -> allowed chars (HEX)
    expect.fail('Test Not Implemented!')
  })

  // TODO -> double claim per address

  // TODO -> restrict to ATOR token holders

  // TODO -> require locking ATOR tokens to make a claim

  // TODO -> release ATOR tokens when claim is verified/pruned
})
