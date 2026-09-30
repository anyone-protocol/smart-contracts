// D6 conformance webapp server (Bun). Bundles the browser app, serves the page,
// and proxies signature recovery to a HyperBEAM node over PURE HTTP.
//
// Run:  HB_URL=http://localhost:8734 bun run d6-conformance/server.ts
// Then open http://localhost:5173 in a browser with an injected wallet (Rabby,
// MetaMask, …), connect, and click "Run conformance check".
//
// Recovery is node-authoritative and pure HTTP — no podman/container exec, so
// HB_URL may be ANY reachable node (a local ephemeral one, or stage/live):
//   podman run -d --name hb-smoke --network=host -e HB_ALLOW_EPHEMERAL_WALLET=true \
//     ghcr.io/memetic-block/hyperbeam-docker:v0.9-FINAL
//
// How the node recovers (verified against v0.9-FINAL @ 466cf489):
//   Every ans104 body is signature-checked at the HTTP door
//   (hb_http:req_to_tabm_singleton -> ar_bundles:verify_item; a bad signature
//   throws {invalid_ans104_signature,...} -> HTTP 500). On success the item is
//   converted to ans104@1.0 structured form, which sets
//   committer = human_id(ar_wallet:to_address(owner, sig_type))
//   (dev_codec_ans104_from.erl:215-228) — the EIP-55 0x address for `ethereum`.
//   - POST /~message@1.0/verify         -> "true" (200) | 500 for a bad sig
//   - POST /~message@1.0/committers/1   -> the recovered committer (200) | 500
// NB: a *plain* signed item surfaces the committer; ao process/message shapes hit
// normalize_unsigned and read back without it (the sig is still checked at
// ingest — verify=true). So the conformance item is a plain ans104 item, which
// isolates exactly what D6 tests: the wallet's ans104 signature + recovery.
import { file } from 'bun'
import { resolve } from 'node:path'

const HB_URL = process.env.HB_URL || 'http://localhost:8734'
const PORT = Number(process.env.PORT || 5173)
const ROOT = new URL('.', import.meta.url).pathname

const ANS104 = { 'content-type': 'application/ans104', 'codec-device': 'ans104@1.0' }

// Browser-bundle shims for Node builtins arbundles needs (the dashboard's Vite
// does the equivalent): force the arbundles *browser* build (same code the
// dashboard runs) and alias its `import … from "crypto"` to our @noble/hashes
// createHash shim. Buffer/process are polyfilled at runtime by polyfills.ts.
// Absolute + normalized (onResolve rejects paths containing `..`).
const ARBUNDLES_WEB = resolve(ROOT, '../node_modules/@dha-team/arbundles/build/web/esm/webIndex.js')
const CRYPTO_SHIM = resolve(ROOT, 'crypto-shim.ts')
const nodeBuiltinShims = [{
  name: 'browser-node-shims',
  setup(b: any) {
    b.onResolve({ filter: /^(node:)?crypto$/ }, () => ({ path: CRYPTO_SHIM }))
    b.onResolve({ filter: /^@dha-team\/arbundles$/ }, () => ({ path: ARBUNDLES_WEB }))
  },
}]

// Bundle the browser entry once at startup.
const build = await Bun.build({
  entrypoints: [ROOT + 'app.ts'],
  target: 'browser',
  minify: false,
  plugins: nodeBuiltinShims,
})
if (!build.success) { console.error(build.logs); process.exit(1) }
const appJs = await build.outputs[0].text()

// Recover verify + committer from a raw ans104 item using the node's OWN
// ingest recovery, over pure HTTP. Returns { verify, committer(EIP-55), sigType }.
// A bad signature 500s at ingest on both calls -> verify:false, committer:null.
async function recover(raw: ArrayBuffer): Promise<Response> {
  const body = Buffer.from(raw)

  const vres = await fetch(`${HB_URL}/~message@1.0/verify`, { method: 'POST', headers: ANS104, body })
  const verify = vres.ok && (await vres.text()).trim() === 'true'

  let committer: string | null = null
  let sigType: string | null = null
  if (verify) {
    const cres = await fetch(`${HB_URL}/~message@1.0/committers/1`, {
      method: 'POST',
      headers: { ...ANS104, accept: 'text/plain' },
      body,
    })
    if (cres.ok) {
      const c = (await cres.text()).trim()
      // ethereum committer = 0x + 40 hex (EIP-55); rsa/arweave = 43-char b64url
      if (/^0x[0-9a-fA-F]{40}$/.test(c)) { committer = c; sigType = 'ethereum' }
      else if (/^[A-Za-z0-9_-]{43}$/.test(c)) { committer = c; sigType = 'arweave' }
    }
  }
  return Response.json({ verify, committer, sigType })
}

Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url)
    if (url.pathname === '/') return new Response(file(ROOT + 'index.html'))
    if (url.pathname === '/app.js') return new Response(appJs, { headers: { 'content-type': 'text/javascript' } })
    if (url.pathname === '/node-address') {
      const r = await fetch(`${HB_URL}/~meta@1.0/info/address`)
      return new Response(await r.text())
    }
    if (url.pathname === '/recover' && req.method === 'POST') {
      try { return await recover(await req.arrayBuffer()) }
      catch (e: any) { return new Response(String(e?.message || e), { status: 502 }) }
    }
    return new Response('not found', { status: 404 })
  },
})
console.log(`D6 conformance webapp: http://localhost:${PORT}  (node: ${HB_URL}, pure HTTP)`)
