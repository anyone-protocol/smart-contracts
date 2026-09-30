// D6 conformance — browser entry. Connect any injected EIP-1193 wallet
// (Rabby / MetaMask / …), sign an ans104 data item exactly as the dashboard
// does, and check that the HyperBEAM node recovers the committer to THIS
// wallet's address (EIP-55) and accepts the signature (verify). Also runs a
// malformed-signature case to confirm the node fails closed.
import './polyfills' // MUST be first — defines Buffer/process before arbundles
import { BrowserProvider, getAddress } from 'ethers'
import { makeAoSigner, createEthereumDataItemSigner } from './ao-signer'

const $ = (id: string) => document.getElementById(id)!
const log = (msg: string, cls = '') => {
  const p = document.createElement('div')
  p.className = `line ${cls}`
  p.textContent = msg
  $('out').appendChild(p)
}
const row = (label: string, value: string, ok?: boolean) =>
  log(`${label.padEnd(26)} ${value}`, ok === undefined ? '' : ok ? 'ok' : 'bad')

// Backend recovers over pure HTTP against the node: POST the raw ans104 item to
// /~message@1.0/verify + /committers/1. A valid sig -> verify=true + committer;
// a bad sig 500s at ingest -> verify=false (the node's own fail-closed path).
async function nodeRecover(raw: Uint8Array) {
  const res = await fetch('/recover', {
    method: 'POST',
    headers: { 'content-type': 'application/octet-stream' },
    body: raw,
  })
  if (!res.ok) throw new Error(`/recover -> ${res.status}: ${(await res.text()).slice(0, 200)}`)
  return res.json() as Promise<{ verify: boolean; committer: string; sigType: string }>
}

async function nodeAddress(): Promise<string> {
  return (await (await fetch('/node-address')).text()).trim()
}

// --- Wallet discovery (EIP-6963 + legacy) ---
// With several wallet extensions installed they fight over window.ethereum
// ("Cannot redefine property: ethereum" in the console — an extension-level
// collision, not ours). EIP-6963 enumerates every injected provider so we can
// pick a specific one (Rabby, MetaMask, …) instead of whichever won the race.
type Injected = { name: string; provider: any }
const wallets: Injected[] = []

function addWallet(name: string, provider: any) {
  if (!provider) return
  if (wallets.some(w => w.provider === provider || w.name === name)) return
  wallets.push({ name, provider })
  refreshPicker()
}

function discoverWallets() {
  window.addEventListener('eip6963:announceProvider', (e: any) =>
    addWallet(e.detail?.info?.name || 'Injected', e.detail?.provider))
  window.dispatchEvent(new Event('eip6963:requestProvider'))
  // Legacy fallback: window.ethereum, plus a .providers array if present.
  const eth = (window as any).ethereum
  const legacy = eth ? (Array.isArray(eth.providers) ? eth.providers : [eth]) : []
  for (const p of legacy)
    addWallet(p.isRabby ? 'Rabby' : p.isMetaMask ? 'MetaMask' : 'Injected (EIP-1193)', p)
}

function refreshPicker() {
  const sel = $('wallet') as HTMLSelectElement
  const prev = sel.value
  sel.innerHTML = ''
  wallets.forEach((w, i) => {
    const o = document.createElement('option')
    o.value = String(i)
    o.textContent = w.name
    sel.appendChild(o)
  })
  // Keep prior selection, else default to Rabby (the e2e-dev wallet) if present.
  const rabby = wallets.findIndex(w => /rabby/i.test(w.name))
  sel.value = prev || String(rabby >= 0 ? rabby : 0)
  sel.disabled = wallets.length === 0
}

async function run() {
  $('out').innerHTML = ''
  try {
    const chosen = wallets[Number(($('wallet') as HTMLSelectElement).value)]
    if (!chosen) { log('No injected wallet found. Install/enable one and reload.', 'bad'); return }

    const provider = new BrowserProvider(chosen.provider)
    await provider.send('eth_requestAccounts', [])
    row('wallet', chosen.name)

    log('Building AoSigner (personal_sign auth → recover pubkey)…')
    const signer = await makeAoSigner(provider)
    const walletAddr = getAddress(await signer.getAddress()) // EIP-55 checksummed
    row('wallet address (EIP-55)', walletAddr)
    const sign = createEthereumDataItemSigner(signer)

    // 1) VALID — sign a plain ans104 item (a plain item surfaces the recovered
    // committer; ao process/message shapes hit normalize_unsigned and read back
    // without it). This isolates exactly what D6 tests: the wallet's ans104
    // signature and the address the node recovers it to.
    log('Signing a plain ans104 item (per-item wallet signature)…')
    const { raw } = await sign({
      data: 'anyone d6-conformance ' + walletAddr,
      tags: [{ name: 'app', value: 'anyone-d6-conformance' }],
    })
    const rec = await nodeRecover(raw)
    row('node sig type', rec.sigType ?? '(none)', rec.sigType === 'ethereum')
    row('node verify', String(rec.verify), rec.verify === true)
    row('node recovered committer', rec.committer ?? '(none)')
    const match = !!rec.committer && rec.committer === walletAddr
    row('committer === wallet', match ? 'MATCH ✓' : 'MISMATCH ✗', match)

    // 2) MALFORMED — flip a signature byte; the node fails closed (a bad ans104
    // signature 500s at ingest, so verify comes back false).
    log('Malformed case (tampered signature) — expect verify=false…')
    const bad = raw.slice()
    bad[10] ^= 0xff // corrupt a signature byte (ethereum sig spans offsets 2..66)
    const recBad = await nodeRecover(bad)
    row('malformed verify', String(recBad.verify), recBad.verify === false)

    // 3) DASHBOARD SHAPE — sign the real process-spawn item the dashboard
    // produces and confirm the node accepts it. The committer isn't surfaced for
    // ao shapes, but the signature IS verified at ingest, so verify=true proves
    // the operator's real spawn signs and is accepted.
    log('Signing a process-spawn item (dashboard shape) — expect accepted…')
    const addr = await nodeAddress()
    const spawn = await sign({
      data: 'd6-spawn',
      tags: [
        { name: 'device', value: 'process@1.0' },
        { name: 'type', value: 'Process' },
        { name: 'scheduler-device', value: 'scheduler@1.0' },
        { name: 'execution-device', value: 'lua@5.3a' },
        { name: 'scheduler-location', value: addr },
        { name: 'authority', value: addr },
        { name: 'data-protocol', value: 'ao' },
        { name: 'variant', value: 'ao.N.1' },
        { name: 'name', value: 'd6-' + Date.now() },
      ],
    })
    const recSpawn = await nodeRecover(spawn.raw)
    row('process-spawn accepted', String(recSpawn.verify), recSpawn.verify === true)

    const pass =
      rec.sigType === 'ethereum' && rec.verify && match && !recBad.verify && recSpawn.verify
    log('')
    log(pass
      ? `CONFORMANT ✓  (${chosen.name}: EIP-191 ans104 recovers to ${walletAddr}; ` +
        `malformed rejected; dashboard-shape spawn accepted)`
      : `NON-CONFORMANT ✗  — review the rows above`, pass ? 'ok' : 'bad')
  } catch (e: any) {
    log('ERROR: ' + String(e?.message || e), 'bad')
  }
}

$('run').addEventListener('click', run)
discoverWallets()
