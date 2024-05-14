import path from 'path';
import dotenv from 'dotenv'
import { LoggerFactory, WarpFactory } from 'warp-contracts'
import EthereumSigner from 'arbundles/src/signing/chains/ethereumSigner'
import { EthersExtension } from 'warp-contracts-plugin-ethers'

import { Wallet } from 'ethers'
import BigNumber from 'bignumber.js'
import claims from '../relay-states/add-claims.json'

import {
  AddClaimable,
  RelayRegistryHandle,
  RelayRegistryState
} from '../../src/contracts'

const envPath = path.resolve(__dirname, '..', '.env');
dotenv.config({ path: envPath })

let contractTxId = process.env.CONTRACT_ID
const contractOwnerPrivateKey = process.env.OWNER_KEY

LoggerFactory.INST.logLevel('error')
BigNumber.config({ EXPONENTIAL_AT: 50 })

const warp = WarpFactory
  .forMainnet()
  .use(new EthersExtension())

async function main() {
  if (!contractTxId) {
    throw new Error('CONTRACT_ID is not set!')
  }

  if (!contractOwnerPrivateKey) {
    throw new Error('OWNER_KEY is not set!')
  }

  const contract = warp.contract<RelayRegistryState>(contractTxId)

  // let claims: {address: string, fingerprint: string}[] = [
  //   { address: "0x75766f4d4609a41DFFaeb207BD33dEa58d0d8474", fingerprint: "7F54724CB9E0567BC4A538556DF25A4FD6DC7F5D" },
  //   { address: "0x75766f4d4609a41DFFaeb207BD33dEa58d0d8474", fingerprint: "60CCE755BD6B7410C70A16B4204D13A986437FDB" }
  // ]

  try {
    for (let i = 0; i < claims.length; i += 1) {
      const input: AddClaimable = {
        function: 'addClaimable',
        fingerprint: claims[i].fingerprint,
        address: claims[i].address,
      }
    
      // NB: Sanity check by getting current state and "dry-running" thru
      //     contract source handle directly.  If it doesn't throw, we're good.
      const { cachedValue: { state } } = await contract.readState()
      RelayRegistryHandle(state, {
        input,
        caller: new Wallet(contractOwnerPrivateKey).address,
        interactionType: 'write'
      })
    
      // NB: Send off the interaction for real
      await contract
        .connect(new EthereumSigner(contractOwnerPrivateKey))
        .writeInteraction<AddClaimable>(input)
    }
  } catch(e) {
    console.error(e)
    console.log("Continuing execution")
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; })
