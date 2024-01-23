import EthereumSigner from 'arbundles/src/signing/chains/ethereumSigner'
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
import { DeployPlugin } from 'warp-contracts-plugin-deploy'
import { EthersExtension } from 'warp-contracts-plugin-ethers'

import HardhatKeys from '../../scripts/test-keys/hardhat.json'
import {
  AddClaimable,
  AddRegistrationCredit,
  Claim,
  RelayRegistryState
} from '../../src/contracts/relay-registry'

const fingerprintA = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
const fingerprintB = 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB'
const fingerprintC = 'CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC'

describe('Relay Registry Contract (e2e)', () => {
  let warp: Warp,
      contractSrc: string,
      contractTxId: string,
      contract: Contract<RelayRegistryState>,
      owner: { address: string, wallet: EthereumSigner },
      alice: { address: string, wallet: EthereumSigner },
      bob: { address: string, wallet: EthereumSigner }

  before('Set up environment', async () => {
    LoggerFactory.INST.logLevel('error')

    warp = WarpFactory
      .forMainnet()
      .use(new EthersExtension())
      .use(new DeployPlugin())

    owner = {
      address: HardhatKeys.owner.address,
      wallet: new EthereumSigner(HardhatKeys.owner.key)
    }
    alice = {
      address: HardhatKeys.alice.address,
      wallet: new EthereumSigner(HardhatKeys.alice.key)
    }
    bob = {
      address: HardhatKeys.bob.address,
      wallet: new EthereumSigner(HardhatKeys.bob.key)
    }

    contractSrc = fs.readFileSync(
      path.join(__dirname, '../../dist/contracts/relay-registry.js')
    ).toString()

    const initState: RelayRegistryState = {
      owner: owner.address,
      claimable: {},
      verified: {},
      registrationCredits: {}
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

  after('Tear down environment', async () => {
    await warp.close()
  })

  it('Matches initial state after deployment', async () => {
    const { cachedValue: { state } } = await contract.readState()
    
    expect(state.owner).to.equal(owner.address)
    expect(state.claimable).to.be.empty
    expect(state.verified).to.be.empty
  })

  it('Should not affect state on invalid input', async () => {
    await contract
      .connect(alice.wallet)
      .writeInteraction<Claim>({
        function: 'claim',
        fingerprint: 'bad-fingerprint'
      })

    const { cachedValue: { state } } = await contract.readState()

    expect(state.owner).to.equal(owner.address)
    expect(state.claimable).to.be.empty
    expect(state.verified).to.be.empty
  })

  it('Allows Owner to add claimable relays', async () => {
    await contract
      .connect(owner.wallet)
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

  it('Allows Owner to add registration credits', async () => {
    await contract
      .connect(owner.wallet)
      .writeInteraction<AddRegistrationCredit>({
        function: 'addRegistrationCredit',
        address: alice.address,
        fingerprint: fingerprintA
      })

    const { cachedValue: { state } } = await contract.readState()

    expect(state.registrationCredits).to.deep.equal({ [alice.address]: 1 })
  })

  it('Allows users to claim relay fingerprints', async () => {
    await contract
      .connect(alice.wallet)
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

  it('Allows adding multiple claimable relay fingerprints', async () => {
    await contract
      .connect(owner.wallet)
      .writeInteraction<AddClaimable>({
        function: 'addClaimable',
        address: alice.address,
        fingerprint: fingerprintB
      })
    
    await contract
      .connect(owner.wallet)
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
