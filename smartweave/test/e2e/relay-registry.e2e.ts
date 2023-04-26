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
import { Register, RelayRegistryState, Verify } from '../../src/contracts'

const fingerprintA = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
const fingerprintB = 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB'

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

    const initState = JSON.stringify({
      owner: owner.address,
      claims: {},
      verified: {}
    })
    const deploy = await warp.deploy({
      src: contractSrc,
      wallet: owner.wallet,
      initState
    })
    contractTxId = deploy.contractTxId
    console.log('contract deployed at', contractTxId)
    contract = warp.contract<RelayRegistryState>(contractTxId)
  })

  it('Should match initial state after deployment', async () => {
    const { cachedValue: { state } } = await contract.readState()
    
    expect(state.owner).to.equal(owner.address)
    expect(state.claims).to.be.empty
    expect(state.verified).to.be.empty
  })

  it('Should not affect state on invalid input', async () => {
    await contract
      .connect({
        signer: buildEvmSignature(alice.signer),
        type: 'ethereum'
      })
      .writeInteraction<Register>({
        function: 'register',
        fingerprint: 'bad-fingerprint'
      })

    const { cachedValue: { state } } = await contract.readState()

    expect(state.owner).to.equal(owner.address)
    expect(state.claims).to.be.empty
    expect(state.verified).to.be.empty
  })

  it('Should allow users to register relay fingerprints', async () => {
    await contract
      .connect({
        signer: buildEvmSignature(alice.signer),
        type: 'ethereum'
      })
      .writeInteraction<Register>({
        function: 'register',
        fingerprint: fingerprintA
      })
    await contract
      .connect({
        signer: buildEvmSignature(bob.signer),
        type: 'ethereum'
      })
      .writeInteraction<Register>({
        function: 'register',
        fingerprint: fingerprintA
      })
    await contract
      .connect({
        signer: buildEvmSignature(alice.signer),
        type: 'ethereum'
      })
      .writeInteraction<Register>({
        function: 'register',
        fingerprint: fingerprintB
      })

    const { cachedValue: { state } } = await contract.readState()

    expect(state.claims).to.deep.equal({
      [alice.address]: [ fingerprintA, fingerprintB ],
      [bob.address]: [ fingerprintA ]
    })
    expect(state.verified).to.deep.equal({})
  })

  it('Should allow the contract owner to verify claims', async () => {
    await contract
      .connect({
        signer: buildEvmSignature(bob.signer),
        type: 'ethereum'
      })
      .writeInteraction<Verify>({
        function: 'verify',
        address: alice.address,
        fingerprint: fingerprintB
      })
    await contract
      .connect({
        signer: buildEvmSignature(owner.signer),
        type: 'ethereum'
      })
      .writeInteraction<Verify>({
        function: 'verify',
        address: alice.address,
        fingerprint: fingerprintA
      })

    const { cachedValue: { state } } = await contract.readState()

    expect(state.claims).to.deep.equal({
      [alice.address]: [ fingerprintB ],
      [bob.address]: [ ]
    })
    expect(state.verified).to.deep.equal({
      [fingerprintA]: alice.address
    })
  })
})