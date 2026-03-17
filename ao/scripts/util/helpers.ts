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

export async function resolveAuthority (url: string) {
  if (process.env.AUTHORITY) return process.env.AUTHORITY
  const res = await fetch(`${url}/~meta@1.0/info/address`)
  if (!res.ok) throw new Error(`Failed to resolve authority from ${url}: ${res.status}`)
  return res.text()
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
