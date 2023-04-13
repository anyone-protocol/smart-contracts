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
    const { registry, owner } = await loadFixture(deploy)

    await registry.connect(owner).registerRelay(fingerprintA)
    const fingerprint = await registry.claims(owner.address)

    expect(fingerprint).to.equal(fingerprintA)
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

  it('Allows user to update claim', async () => {
    const { registry, owner, alice } = await loadFixture(deploy)

    await registry.connect(owner).registerRelay(fingerprintA)
    await registry.connect(alice).registerRelay(fingerprintA)
    await registry.connect(owner).registerRelay(fingerprintB)

    const ownerFingerprintClaim = await registry.claims(owner.address)
    const aliceFingerprintClaim = await registry.claims(alice.address)

    expect(ownerFingerprintClaim).to.equal(fingerprintB)
    expect(aliceFingerprintClaim).to.equal(fingerprintA)
  })

  it('Allows contract owner to verify claims', async () => {
    const { registry, owner, alice } = await loadFixture(deploy)

    await registry.connect(alice).registerRelay(fingerprintA)
    await registry.connect(owner).verifyClaim(alice.address, fingerprintA)

    const aliceVerifiedAddress = await registry.verified(fingerprintA)
    const aliceFingerprintClaim = await registry.claims(alice.address)

    expect(aliceVerifiedAddress).to.equal(alice.address)
    expect(aliceFingerprintClaim).to.equal('')
    await expect(registry.verifyClaim(alice.address, 'badfingerprint'))
      .to.be.revertedWith('Invalid fingerprint')
    await expect(registry.verifyClaim(alice.address, fingerprintB))
      .to.be.revertedWith('Fingerprint not claimed')
  })

  it('Disallows non-owners from verifying claims', async () => {
    const { registry, alice } = await loadFixture(deploy)

    await registry.connect(alice).registerRelay(fingerprintA)

    await expect(
      registry.connect(alice).verifyClaim(alice.address, fingerprintA)
    ).to.be.revertedWith('Ownable: caller is not the owner')
  })

  it('Fires an event on relay verification', async () => {
    const { registry, alice } = await loadFixture(deploy)

    await registry.connect(alice).registerRelay(fingerprintA)

    await expect(registry.verifyClaim(alice.address, fingerprintA))
      .to.emit(registry, 'RelayRegistrationVerified')
      .withArgs(alice.address, fingerprintA)
  })

  // TODO -> restrict to ATOR token holders
  // TODO -> require locking ATOR tokens to make a claim
  // TODO -> release ATOR tokens on de-registration or invalid claim
})
