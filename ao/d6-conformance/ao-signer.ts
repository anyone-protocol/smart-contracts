// D6 conformance — vendored copy of the dashboard's browser signing path so the
// conformance test exercises the REAL surface, not a generic one. Mirrors
// ator-relay-dashboard/composables/ao-signer.ts (AoSigner) and
// utils/create-ethereum-data-item-signer.ts, verbatim in behavior.
//
// The whole point: the ans104 data item is built identically to our proven
// Node path (createData + sign); the ONLY variable under test is the injected
// wallet's signature (Rabby / MetaMask / any EIP-1193 provider). NB: the
// dashboard pins @dha-team/arbundles 1.0.1; this project has 1.0.4 — a
// behavioural diff between versions would itself be a conformance finding.
import {
  BrowserProvider,
  getBytes,
  hashMessage,
  JsonRpcSigner,
  SigningKey,
} from 'ethers'
import { createData, InjectedEthereumSigner, Signer } from '@dha-team/arbundles'

export class AoSigner extends InjectedEthereumSigner {
  public declare signer: JsonRpcSigner

  async setSigner(signer: JsonRpcSigner) {
    this.signer = signer
  }

  async getAddress() {
    return await this.signer.getAddress()
  }

  // Verbatim from the dashboard: derive the ans104 owner pubkey by having the
  // wallet personal_sign a fixed auth message, then recovering the pubkey.
  override async setPublicKey() {
    const message =
      'Please sign this message to authenticate with the Anyone dashboard.  ' +
      'You will only need to do this once per session when interacting with ' +
      'the Operator Registry.'
    const signed = await this.signer.signMessage(message)
    const hash = hashMessage(message)
    const recoveredPublicKey = SigningKey.recoverPublicKey(getBytes(hash), signed)
    this.publicKey = Buffer.from(getBytes(recoveredPublicKey))
  }
}

export async function makeAoSigner(provider: BrowserProvider): Promise<AoSigner> {
  // @ts-expect-error arbundles InjectedEthereumSigner constructor types
  const s = new AoSigner(provider)
  await s.setSigner(await provider.getSigner())
  await s.setPublicKey()
  return s
}

// Mirror of the dashboard's createEthereumDataItemSigner: createData + sign.
export function createEthereumDataItemSigner(signer: Signer) {
  return async (
    { data, tags, target, anchor }: {
      data: string | Uint8Array
      tags: { name: string; value: string }[]
      target?: string
      anchor?: string
    }
  ) => {
    const dataItem = createData(data, signer, { tags, target, anchor })
    await dataItem.sign(signer)
    return { id: dataItem.id, raw: dataItem.getRaw() as Uint8Array }
  }
}
