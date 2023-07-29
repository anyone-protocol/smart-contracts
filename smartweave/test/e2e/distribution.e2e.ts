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
import MockScores from './data/scores.json'
import {
  AddScores,
  Distribute,
  DistributionState,
  SetTokenDistributionRate
} from '../../src/contracts'

const INITIAL_DISTRIBUTION_AMOUNT = '1000'
const fingerprintA = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
const fingerprintB = 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB'
const fingerprintC = 'CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC'
const now = Date.now()
const firstTimestamp = now.toString()
const later = now + 5432
const secondTimestamp = later.toString()
const aDayLater = later + 86_400_000
const thirdTimestamp = aDayLater.toString()

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
      tokensDistributedPerSecond: INITIAL_DISTRIBUTION_AMOUNT,
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
    expect(state.tokensDistributedPerSecond).to.equal(INITIAL_DISTRIBUTION_AMOUNT)
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
    expect(state.tokensDistributedPerSecond).to.equal(INITIAL_DISTRIBUTION_AMOUNT)
    expect(state.pendingDistributions).to.be.empty
    expect(state.claimable).to.be.empty
    expect(state.previousDistributions).to.be.empty
  })

  it('Prevents non-owners to set distribution amount', async () => {
    const tokensDistributedPerSecond = '1234'
    
    await contract
      .connect({
        signer: buildEvmSignature(alice.signer),
        type: 'ethereum'
      })
      .writeInteraction<SetTokenDistributionRate>({
        function: 'setTokenDistributionRate',
        tokensDistributedPerSecond
      })

    const { cachedValue: { state } } = await contract.readState()

    expect(state.tokensDistributedPerSecond).to.equal(
      INITIAL_DISTRIBUTION_AMOUNT
    )
  })

  it('Allows the owner to set distribution amount', async () => {
    const tokensDistributedPerSecond = '2000'
    
    await contract
      .connect({
        signer: buildEvmSignature(owner.signer),
        type: 'ethereum'
      })
      .writeInteraction<SetTokenDistributionRate>({
        function: 'setTokenDistributionRate',
        tokensDistributedPerSecond
      })

    const { cachedValue: { state } } = await contract.readState()

    expect(state.tokensDistributedPerSecond).to.equal(
      tokensDistributedPerSecond
    )
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
      [firstTimestamp]: {
        timeElapsed: '0',
        tokensDistributedPerSecond: '2000',
        totalDistributed: '0',
        totalScore: '300'
      }
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
      [firstTimestamp]: {
        timeElapsed: '0',
        tokensDistributedPerSecond: '2000',
        totalDistributed: '0',
        totalScore: '300'
      }
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
      [firstTimestamp]: {
        timeElapsed: '0',
        tokensDistributedPerSecond: '2000',
        totalDistributed: '0',
        totalScore: '300'
      }
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
      [firstTimestamp]: {
        timeElapsed: '0',
        tokensDistributedPerSecond: '2000',
        totalDistributed: '0',
        totalScore: '300'
      },
      [secondTimestamp]: {
        timeElapsed: '5432',
        tokensDistributedPerSecond: '2000',
        totalDistributed: '10862',
        totalScore: '2069'
      }
    })
    expect(state.pendingDistributions).to.be.empty
    expect(state.claimable).to.deep.equal({
      [alice.address]: '3842',
      [bob.address]: '7020'
    })
  })

  it('Distributes tokens for realistic rate and scores', async () => {
    const realisticTokensPerSecond = '628000000000000000'

    await contract
      .connect({
        signer: buildEvmSignature(owner.signer),
        type: 'ethereum'
      })
      .writeInteraction<SetTokenDistributionRate>({
        function: 'setTokenDistributionRate',
        tokensDistributedPerSecond: realisticTokensPerSecond
      })

    const BATCH_SIZE = 15

    for (let i = 0; i < MockScores.length; i += BATCH_SIZE) {
      const scores = MockScores.slice(i, i + BATCH_SIZE)
      await contract
        .connect({
          signer: buildEvmSignature(owner.signer),
          type: 'ethereum'
        })
        .writeInteraction<AddScores>({
          function: 'addScores',
          timestamp: thirdTimestamp,
          scores
        })
    }

    await contract
      .connect({
        signer: buildEvmSignature(owner.signer),
        type: 'ethereum'
      })
      .writeInteraction<Distribute>({
        function: 'distribute',
        timestamp: thirdTimestamp
      })

    const { cachedValue: { state } } = await contract.readState()
    
    expect(state.previousDistributions).to.deep.equal({
      [firstTimestamp]: {
        timeElapsed: '0',
        tokensDistributedPerSecond: '2000',
        totalDistributed: '0',
        totalScore: '300'
      },
      [secondTimestamp]: {
        timeElapsed: '5432',
        tokensDistributedPerSecond: '2000',
        totalDistributed: '10862',
        totalScore: '2069'
      },
      [thirdTimestamp]: {
        timeElapsed: '86405432',
        tokensDistributedPerSecond: realisticTokensPerSecond,
        totalDistributed: '5.4262611296000000001004e+22',
        totalScore: '1793643'
      }
    })

    expect(state.pendingDistributions).to.be.empty
    // expect(state.claimable).to.deep.equal({
    //   [alice.address]: '3842',
    //   [bob.address]: '7020'
    // })
  }).timeout(5000)
})
