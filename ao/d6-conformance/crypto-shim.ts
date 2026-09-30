// Minimal browser `crypto` shim for the parts @dha-team/arbundles needs:
// createHash('sha256'|'sha384'|'sha512').update(…).digest(). Backed by
// @noble/hashes — verified byte-identical to Node's crypto (sha256 + sha384).
// The arbundles browser build still does `import { createHash } from "crypto"`
// and relies on the bundler to alias it (the dashboard's Vite uses
// crypto-browserify); our Bun build aliases `crypto` to this file (see
// server.ts). Only the createHash surface is implemented — that's all the
// ans104 signing path (sha256 DataItem id + sha384 deephash) uses.
import { sha256 } from '@noble/hashes/sha256'
import { sha384, sha512 } from '@noble/hashes/sha512'

const ALGOS: Record<string, { create: () => any }> = { sha256, sha384, sha512 }

class Hash {
  private h: any
  constructor(algo: string) {
    const a = ALGOS[algo.toLowerCase()]
    if (!a) throw new Error(`crypto-shim: unsupported hash '${algo}'`)
    this.h = a.create()
  }
  update(data: Uint8Array | string): Hash {
    // Node's createHash defaults strings to utf8; Buffer is a Uint8Array subclass.
    this.h.update(typeof data === 'string' ? new TextEncoder().encode(data) : data)
    return this
  }
  digest(encoding?: 'hex' | 'base64' | 'base64url'): Buffer | string {
    const out = Buffer.from(this.h.digest() as Uint8Array)
    return encoding ? out.toString(encoding) : out
  }
}

export function createHash(algo: string): Hash {
  return new Hash(algo)
}

// Referenced only by arbundles' RSA signer (Rsa4096Pss.sign) — dead code for the
// EVM/injected path, but the barrel import pulls the names in. constants is only
// dereferenced inside that sign(), which never runs here; createSign throws if it
// somehow does (an RSA/Arweave local sign was attempted in the browser bundle).
export const constants = { RSA_PKCS1_PSS_PADDING: 6 }
export function createSign(_algo?: string): never {
  throw new Error('crypto-shim: createSign (RSA local signing) is not supported in the browser bundle')
}

export default { createHash, constants, createSign }
