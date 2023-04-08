import { expect } from 'chai'
import hardhat from 'hardhat'
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'

const AtorAddress = '0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa'
const fingerprintA = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
const fingerprintB = 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB'

describe('RelayRegistry Contract', () => {
  async function deploy() {
    const RelayRegistry = await hardhat
      .ethers
      .getContractFactory('RelayRegistry')
    const [ owner, alice, bob ] = await hardhat.ethers.getSigners()
    
    const registry = await RelayRegistry.deploy(AtorAddress)

    await registry.deployed()

    return { RelayRegistry, registry, owner, alice, bob }
  }

  it('Deploys with reference to ATOR token contract address', async () => {
    const { registry } = await loadFixture(deploy)

    expect(await registry.tokenContract()).to.equal(AtorAddress)
  })

  it('Allows valid relay registration claims', async () => {
    const { registry } = await loadFixture(deploy)

    await registry.registerRelay(fingerprintA)
    await registry.registerRelay(fingerprintB)
    const claims = await registry.claims()

    expect(claims.length).to.equal(2)
    expect(claims[0].fingerprint).to.equal(fingerprintA)
    expect(claims[1].fingerprint).to.equal(fingerprintB)
  })

  it('Fires an event on successful relay registration claims', async () => {
    const { registry, owner } = await loadFixture(deploy)

    await expect(registry.registerRelay(fingerprintA))
      .to.emit(registry, 'RelayRegistrationClaim')
      .withArgs(owner.address, fingerprintA)
  })

  it('Rejects relay registration claims with bad fingerprints', async () => {
    const { registry } = await loadFixture(deploy)

    const tinyFingerprint = 'AAA'
    const largeFingerprint = fingerprintA + fingerprintB
    const badCharsFingerprint = 'VWXYZVWXYZVWXYZVWXYZVWXYZVWXYZVWXYZVWXYZ'

    await expect(registry.registerRelay(tinyFingerprint))
      .to.be.revertedWith('Invalid fingerprint')

    await expect(registry.registerRelay(largeFingerprint))
      .to.be.revertedWith('Invalid fingerprint')

    await expect(registry.registerRelay(badCharsFingerprint))
      .to.be.revertedWith('Invalid fingerprint')
  })

  it('Rejects duplicate registration claims', async () => {
    const { registry, owner, alice } = await loadFixture(deploy)

    await registry.attach(owner.address).registerRelay(fingerprintA)
    await registry.attach(alice.address).registerRelay(fingerprintA)
    await registry.attach(owner.address).registerRelay(fingerprintB)

    await expect(registry.attach(owner.address).registerRelay(fingerprintA))
      .to.be.revertedWith('Duplicate fingerprint')
  })

  // TODO -> restrict to ATOR token holders

  // TODO -> require locking ATOR tokens to make a claim

  // TODO -> release ATOR tokens when claim is verified/pruned
})
