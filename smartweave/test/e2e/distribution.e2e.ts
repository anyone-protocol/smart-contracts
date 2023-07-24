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
import { AddScores, Distribute, DistributionState, SetDistributionAmount } from '../../src/contracts'

const INITIAL_DISTRIBUTION_AMOUNT = '1000'
const fingerprintA = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
const fingerprintB = 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB'
const fingerprintC = 'CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC'
const now = Date.now()
const firstTimestamp = now.toString()
const later = now + 5432
const secondTimestamp = later.toString()

describe('Distribution Contract (e2e)', () => {
  let warp: Warp,
  contractSrc: string,
  contractTxId: string,
  contract: Contract<DistributionState>,
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
      path.join(__dirname, '../../dist/contracts/distribution.js')
    ).toString()

    const initState: DistributionState = {
      owner: owner.address,
      distributionAmount: INITIAL_DISTRIBUTION_AMOUNT,
      pendingDistributions: {},
      claimable: {},
      previousDistributions: {}
    }

    const deploy = await warp.deploy({
      src: contractSrc,
      wallet: owner.wallet,
      initState: JSON.stringify(initState)
    })

    contractTxId = deploy.contractTxId
    console.log('contract deployed at', contractTxId)
    contract = warp.contract<DistributionState>(contractTxId)
  })

  it('Should match initial state after deployment', async () => {
    const { cachedValue: { state } } = await contract.readState()

    expect(state.owner).to.equal(owner.address)
    expect(state.distributionAmount).to.equal(INITIAL_DISTRIBUTION_AMOUNT)
    expect(state.pendingDistributions).to.be.empty
    expect(state.claimable).to.be.empty
    expect(state.previousDistributions).to.be.empty
  })

  it('Should not affect state on invalid input', async () => {
    await contract
      .connect({
        signer: buildEvmSignature(owner.signer),
        type: 'ethereum'
      })
      .writeInteraction<AddScores>({
        function: 'addScores',
        timestamp: 'bad-timestamp',
        scores: []
      })

    const { cachedValue: { state } } = await contract.readState()

    expect(state.owner).to.equal(owner.address)
    expect(state.distributionAmount).to.equal(INITIAL_DISTRIBUTION_AMOUNT)
    expect(state.pendingDistributions).to.be.empty
    expect(state.claimable).to.be.empty
    expect(state.previousDistributions).to.be.empty
  })

  it('Prevents non-owners to set distribution amount', async () => {
    const distributionAmount = '1234'
    
    await contract
      .connect({
        signer: buildEvmSignature(alice.signer),
        type: 'ethereum'
      })
      .writeInteraction<SetDistributionAmount>({
        function: 'setDistributionAmount',
        distributionAmount
      })

    const { cachedValue: { state } } = await contract.readState()

    expect(state.distributionAmount).to.equal(INITIAL_DISTRIBUTION_AMOUNT)
  })

  it('Allows the owner to set distribution amount', async () => {
    const distributionAmount = '2000'
    
    await contract
      .connect({
        signer: buildEvmSignature(owner.signer),
        type: 'ethereum'
      })
      .writeInteraction<SetDistributionAmount>({
        function: 'setDistributionAmount',
        distributionAmount
      })

    const { cachedValue: { state } } = await contract.readState()

    expect(state.distributionAmount).to.equal(distributionAmount)
  })

  it('Allows owner to add scores', async () => {
    const scores = [
      { score: '100', address: alice.address, fingerprint: fingerprintA },
      { score: '100', address: bob.address, fingerprint: fingerprintB },
      { score: '100', address: alice.address, fingerprint: fingerprintC }
    ]

    await contract
      .connect({
        signer: buildEvmSignature(owner.signer),
        type: 'ethereum'
      })
      .writeInteraction<AddScores>({
        function: 'addScores',
        timestamp: firstTimestamp,
        scores
      })
    
    const { cachedValue: { state } } = await contract.readState()

    expect(state.claimable).to.be.empty
    expect(state.previousDistributions).to.be.empty
    expect(state.pendingDistributions).to.deep.equal({
      [firstTimestamp]: scores
    })
  })

  it('Should not award claimable tokens on initial distribution', async () => {
    await contract
      .connect({
        signer: buildEvmSignature(owner.signer),
        type: 'ethereum'
      })
      .writeInteraction<Distribute>({
        function: 'distribute',
        timestamp: firstTimestamp
      })

    const { cachedValue: { state } } = await contract.readState()

    expect(state.claimable).to.be.empty
    expect(state.previousDistributions).to.deep.equal({
      [firstTimestamp]: { distributionAmount: '0' }
    })
    expect(state.pendingDistributions).to.be.empty
  })

  it('Allows multiple addScore calls for a distribution', async () => {
    const scoreA = {
      score: '75',
      address: alice.address,
      fingerprint: fingerprintA
    }
    const scoreB = {
      score: '1337',
      address: bob.address,
      fingerprint: fingerprintB
    }
    const scoreC = {
      score: '657',
      address: alice.address,
      fingerprint: fingerprintC
    }

    await contract
      .connect({
        signer: buildEvmSignature(owner.signer),
        type: 'ethereum'
      })
      .writeInteraction<AddScores>({
        function: 'addScores',
        timestamp: secondTimestamp,
        scores: [ scoreA, scoreB ]
      })
    
    const { cachedValue } = await contract.readState()

    expect(cachedValue.state.claimable).to.be.empty
    expect(cachedValue.state.previousDistributions).to.deep.equal({
      [firstTimestamp]: { distributionAmount: '0' }
    })
    expect(cachedValue.state.pendingDistributions).to.deep.equal({
      [secondTimestamp]: [ scoreA, scoreB ]
    })

    await contract
      .connect({
        signer: buildEvmSignature(owner.signer),
        type: 'ethereum'
      })
      .writeInteraction<AddScores>({
        function: 'addScores',
        timestamp: secondTimestamp,
        scores: [ scoreC ]
      })

    const { cachedValue: { state } } = await contract.readState()

    expect(state.claimable).to.be.empty
    expect(state.previousDistributions).to.deep.equal({
      [firstTimestamp]: { distributionAmount: '0' }
    })
    expect(state.pendingDistributions).to.deep.equal({
      [secondTimestamp]: [ scoreA, scoreB, scoreC ]
    })
  })

  it('Distributes claimable tokens on subsequent distributions', async () => {
    await contract
      .connect({
        signer: buildEvmSignature(owner.signer),
        type: 'ethereum'
      })
      .writeInteraction<Distribute>({
        function: 'distribute',
        timestamp: secondTimestamp
      })

    const { cachedValue: { state } } = await contract.readState()

    expect(state.previousDistributions).to.deep.equal({
      [firstTimestamp]: { distributionAmount: '0' },
      [secondTimestamp]: { distributionAmount: '10864' }
    })
    expect(state.pendingDistributions).to.be.empty
    expect(state.claimable).to.deep.equal({
      [alice.address]: '3842',
      [bob.address]: '7020'
    })
  })
})
