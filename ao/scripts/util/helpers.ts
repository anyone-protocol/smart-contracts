import { readFileSync } from 'fs'
import { resolve } from 'path'
import { createData, Signer, EthereumSigner } from '@dha-team/arbundles'

export function loadWallet (path: string) {
  try {
    return JSON.parse(readFileSync(resolve(path), 'utf-8'))
  } catch (err) {
    console.error(`Error: Could not read wallet from ${path}: ${err.message}`)
    process.exit(1)
  }
}

/**
 * Resolve the node's own operator address (used as the default `scheduler`).
 */
export async function resolveAuthority (url: string) {
  const res = await fetch(`${url}/~meta@1.0/info/address`)
  if (!res.ok) throw new Error(`Failed to resolve authority from ${url}: ${res.status}`)
  return (await res.text()).trim()
}

/**
 * Resolve the authority a process should declare in its `Authority` tag so the
 * node's genesis-wasm executor will import/compute its messages.
 *
 * HyperBEAM nodes only compute messages for processes whose `Authority` is in
 * the node's `genesis-wasm-import-authorities` list — which is typically a
 * SEPARATE address from the node's own operator address. Using the node's own
 * address spawns fine but then silently 504s on the eval push, so we read the
 * configured import authority and use that.
 *
 * Precedence: AUTHORITY env > genesis-wasm-import-authorities > node address.
 */
export async function resolveImportAuthority (url: string): Promise<string> {
  if (process.env.AUTHORITY) return process.env.AUTHORITY
  try {
    const res = await fetch(
      `${url}/~meta@1.0/info/genesis-wasm-import-authorities/serialize~json@1.0`
    )
    if (res.ok) {
      const list = await res.json()
      const authorities = Object.entries(list)
        .filter(([k]) => k !== 'device')
        .map(([, v]) => v)
        .filter((v): v is string => typeof v === 'string')
      if (authorities.length > 0) {
        if (authorities.length > 1) {
          console.warn(
            `node lists ${authorities.length} import authorities; using the first`
          )
        }
        return authorities[0]
      }
    }
  } catch {
    // fall through to node address
  }
  return resolveAuthority(url)
}

export async function createEthereumDataItemSigner(signer: Signer) {
  return (
    { data, tags, target, anchor }: {
      data: string | Uint8Array,
      tags: any[],
      target?: string,
      anchor?: string
    }
  ) => {
    const dataItem = createData(data || 'AnyoneProtocol', signer, { tags, target, anchor })

    return dataItem.sign(signer).then(async () => ({
      id: await dataItem.id,
      raw: await dataItem.getRaw()
    }))
  }
}

export async function createEthSigner(ethSigner: EthereumSigner) {
  try {
    const publicKey = Buffer.from(ethSigner.publicKey);
    const signerAddress = publicKey.toString('base64url');
    return async (create: (...args: any[]) => Promise<Uint8Array>, kind: 'ans104' | 'httpsig') => {
      if (kind === 'ans104') {
        // For ANS-104 signing, we need to call create and then sign
        const deepHash = await create({
          type: ethSigner.signatureType,
          publicKey,
          alg: 'ethereum',
        });

        const signature = await ethSigner.sign(deepHash);

        return {
          signature: Buffer.from(signature),
          address: signerAddress,
        };
      } else if (kind === 'httpsig') {
        // For HTTP signature signing
        const signatureBase = await create({
          type: ethSigner.signatureType,
          publicKey,
          alg: 'ethereum',
        });

        const signature = await ethSigner.sign(signatureBase);

        return {
          signature: Buffer.from(signature),
          address: signerAddress,
        };
      }
      throw new Error(`Unknown signer kind: ${kind}`);
    };
  } catch (e) {
    console.error('Failed to create Ethereum signer: ' + e.message);
    return null;
  }
}
