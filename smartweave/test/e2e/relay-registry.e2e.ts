import 'mocha'
import { expect } from 'chai'
import { Wallet } from 'ethers'
import fs from 'fs'
import path from 'path'
import {
  Contract,
  LoggerFactory,
  Warp,
  WarpFactory
} from 'warp-contracts'
import { DeployPlugin, EthereumSigner } from 'warp-contracts-plugin-deploy'
import { EthersExtension } from 'warp-contracts-plugin-ethers'
import {
  buildEvmSignature,
  EvmSignatureVerificationServerPlugin
  // @ts-ignore
} from 'warp-contracts-plugin-signature/server'

import HardhatKeys from '../../scripts/test-keys/hardhat.json'
import { AddClaimable, Claim, RelayRegistryState } from '../../src/contracts'

const fingerprintA = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
const fingerprintB = 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB'
const fingerprintC = 'CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC'

describe('Relay Registry Contract (e2e)', () => {
  let warp: Warp,
      contractSrc: string,
      contractTxId: string,
      contract: Contract<RelayRegistryState>,
      owner: { address: string, wallet: EthereumSigner, signer: Wallet },
      alice: { address: string, wallet: EthereumSigner, signer: Wallet },
      bob: { address: string, wallet: EthereumSigner, signer: Wallet }

  before('Set up environment', async () => {
    LoggerFactory.INST.logLevel('error')

    warp = WarpFactory
      .forMainnet()
      .use(new EthersExtension())
      .use(new DeployPlugin())
      .use(new EvmSignatureVerificationServerPlugin())

    owner = {
      address: HardhatKeys.owner.address,
      wallet: new EthereumSigner(HardhatKeys.owner.key),
      signer: new Wallet(HardhatKeys.owner.key)
    }
    alice = {
      address: HardhatKeys.alice.address,
      wallet: new EthereumSigner(HardhatKeys.alice.key),
      signer: new Wallet(HardhatKeys.alice.key)
    }
    bob = {
      address: HardhatKeys.bob.address,
      wallet: new EthereumSigner(HardhatKeys.bob.key),
      signer: new Wallet(HardhatKeys.bob.key)
    }

    contractSrc = fs.readFileSync(
      path.join(__dirname, '../../dist/contracts/relay-registry.js')
    ).toString()

    const initState: RelayRegistryState = {
      owner: owner.address,
      claimable: {},
      verified: {}
    }
    const deploy = await warp.deploy({
      src: contractSrc,
      wallet: owner.wallet,
      initState: JSON.stringify(initState)
    })
    contractTxId = deploy.contractTxId
    console.log('contract deployed at', contractTxId)
    contract = warp.contract<RelayRegistryState>(contractTxId)
  })

  it('Should match initial state after deployment', async () => {
    const { cachedValue: { state } } = await contract.readState()
    
    expect(state.owner).to.equal(owner.address)
    expect(state.claimable).to.be.empty
    expect(state.verified).to.be.empty
  })

  it('Should not affect state on invalid input', async () => {
    await contract
      .connect({
        signer: buildEvmSignature(alice.signer),
        type: 'ethereum'
      })
      .writeInteraction<Claim>({
        function: 'claim',
        fingerprint: 'bad-fingerprint'
      })

    const { cachedValue: { state } } = await contract.readState()

    expect(state.owner).to.equal(owner.address)
    expect(state.claimable).to.be.empty
    expect(state.verified).to.be.empty
  })

  it('Should allow the contract owner to add claimable relays', async () => {
    await contract
      .connect({
        signer: buildEvmSignature(owner.signer),
        type: 'ethereum'
      })
      .writeInteraction<AddClaimable>({
        function: 'addClaimable',
        address: alice.address,
        fingerprint: fingerprintA
      })

    const { cachedValue: { state } } = await contract.readState()

    expect(state.claimable).to.deep.equal({
      [fingerprintA]: alice.address
    })
    expect(state.verified).to.deep.equal({})
  })

  it('Should allow users to claim relay fingerprints', async () => {
    await contract
      .connect({
        signer: buildEvmSignature(alice.signer),
        type: 'ethereum'
      })
      .writeInteraction<Claim>({
        function: 'claim',
        fingerprint: fingerprintA
      })

    const { cachedValue: { state } } = await contract.readState()

    expect(state.claimable).to.deep.equal({})
    expect(state.verified).to.deep.equal({
      [fingerprintA]: alice.address
    })
  })

  it('Should add some more claimable relays for testing', async () => {
    await contract
      .connect({
        signer: buildEvmSignature(owner.signer),
        type: 'ethereum'
      })
      .writeInteraction<AddClaimable>({
        function: 'addClaimable',
        address: alice.address,
        fingerprint: fingerprintB
      })
    
    await contract
      .connect({
        signer: buildEvmSignature(owner.signer),
        type: 'ethereum'
      })
      .writeInteraction<AddClaimable>({
        function: 'addClaimable',
        address: alice.address,
        fingerprint: fingerprintC
      })

    const { cachedValue: { state } } = await contract.readState()

    expect(state.claimable).to.deep.equal({
      [fingerprintB]: alice.address,
      [fingerprintC]: alice.address
    })
    expect(state.verified).to.deep.equal({
      [fingerprintA]: alice.address
    })
  })
})