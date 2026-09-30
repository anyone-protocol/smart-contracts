// Validates the EIP-55 address-migration invariant against REAL legacynet state
// (state-dumps/2026-07-09). Closes the D6 "recovered-bytes ≡ legacynet identity"
// tail without needing raw signatures: HyperBEAM recovers operators to an EIP-55
// 0x address (proven live in d6-conformance/), and this shows that EIP-55 form is
// the SAME 20 bytes legacynet already held — regardless of how legacynet cased it
// (the operator-registry contract stored all-caps hex; message senders were
// recorded EIP-55). The migration therefore only re-cases addresses; it never
// changes an operator's identity.
//
// Checks:
//   1. Byte preservation — for every stored address A (any case),
//      getAddress(A) = canonical EIP-55 E with bytes(A) === bytes(E).
//   2. Idempotency/convergence — already-EIP-55 senders normalize unchanged;
//      all-caps registry entries converge to the same canonical form.
//   3. Cross-representation identity — senders (EIP-55) that are also registry
//      operators (all-caps) map to the SAME canonical address: real proof the
//      two legacynet representations are one identity.
//   4. Rejection — getAddress rejects malformed / bad-checksum input, so the
//      normalize-on-input guard also catches typo'd addresses.
//
// Run:  bun run scripts/validate-address-migration.ts
import { getAddress } from 'ethers'
import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'

const DUMPS = join(import.meta.dir, '../state-dumps/2026-07-09')
const isAddr = (x: unknown): x is string => typeof x === 'string' && /^0x[0-9a-fA-F]{40}$/.test(x)
const bytes = (a: string) => a.slice(2).toLowerCase() // the 20-byte hex, case-folded

const REGISTRY_MAPS = [
  'VerifiedFingerprintsToOperatorAddresses',
  'ClaimableFingerprintsToOperatorAddresses',
  'RegistrationCreditsFingerprintsToOperatorAddresses',
  'VerifiedHardwareFingerprints',
]

function registryAddresses(file: string): string[] {
  const d = JSON.parse(readFileSync(join(DUMPS, file), 'utf8'))
  const out: string[] = []
  for (const k of REGISTRY_MAPS) {
    const v = d[k]
    if (v && typeof v === 'object' && !Array.isArray(v)) out.push(...Object.values(v) as string[])
  }
  if (Array.isArray(d.BlockedOperatorAddresses)) out.push(...d.BlockedOperatorAddresses)
  return out.filter(isAddr)
}

function senderAddresses(): string[] {
  const out: string[] = []
  for (const f of readdirSync(DUMPS).filter(f => f.endsWith('.message-tail.json'))) {
    const d = JSON.parse(readFileSync(join(DUMPS, f), 'utf8'))
    for (const m of d.messages ?? []) if (isAddr(m.sender)) out.push(m.sender)
  }
  return out
}

const registry = [
  ...registryAddresses('live-operator-registry.state.json'),
  ...registryAddresses('stage-operator-registry.state.json'),
]
const senders = senderAddresses()
const all = [...new Set([...registry, ...senders])]

// 1 + 2: byte preservation + convergence
let preserved = 0, recased = 0, alreadyCanonical = 0
const failures: string[] = []
for (const a of all) {
  let e: string
  try { e = getAddress(a) } catch (err: any) { failures.push(`REJECTED ${a}: ${err.shortMessage || err.message}`); continue }
  if (bytes(e) !== bytes(a)) { failures.push(`BYTE CHANGE ${a} -> ${e}`); continue }
  preserved++
  if (e === a) alreadyCanonical++; else recased++
}

// how many registry entries are all-caps (the tech debt) that get re-checksummed
const registryAllCaps = [...new Set(registry)].filter(a => !/[a-f]/.test(bytes(a)) ? true : a.slice(2) === a.slice(2).toUpperCase())

// 3: cross-representation identity
const regCanon = new Set([...new Set(registry)].map(getAddress))
const senderCanon = [...new Set(senders.map(getAddress))]
const overlap = senderCanon.filter(s => regCanon.has(s))

// 4: rejection of malformed / bad-checksum (normalize-on-input guard).
// Flip the case of the first LETTER (a-f) in the canonical address — digits have
// no case, so flipping one wouldn't change the (case-sensitive) EIP-55 checksum.
const goodSender = senderCanon[0]
const body = goodSender ? goodSender.slice(2).split('') : []
const li = body.findIndex(c => /[a-fA-F]/.test(c))
if (li >= 0) body[li] = body[li] === body[li].toUpperCase() ? body[li].toLowerCase() : body[li].toUpperCase()
const flippedChecksum = goodSender ? '0x' + body.join('') : ''
const badCases = [
  ['too short', '0x1234'],
  ['non-hex', '0xZZBF053369CE39F518EACD01118191A0801892CF'],
  ['bad EIP-55 checksum (typo)', flippedChecksum || ''],
]
const rejections = badCases.map(([label, v]) => {
  try { getAddress(v); return `${label}: ACCEPTED (!!) ${v}` }
  catch { return `${label}: rejected ✓` }
})

const uniqRegistry = new Set(registry).size
console.log('=== EIP-55 address-migration validation (real legacynet state 2026-07-09) ===')
console.log(`addresses checked          : ${all.length}  (registry ${uniqRegistry} uniq + senders ${new Set(senders).size} uniq)`)
console.log(`registry all-caps entries  : ${registryAllCaps.length}  (legacynet tech debt, re-checksummed)`)
console.log(`byte-preserved             : ${preserved}/${all.length}`)
console.log(`  already canonical EIP-55 : ${alreadyCanonical}`)
console.log(`  re-cased to canonical    : ${recased}`)
console.log(`failures (byte change/reject): ${failures.length}`)
for (const f of failures.slice(0, 10)) console.log('   ', f)
console.log(`cross-rep identity         : ${overlap.length} sender(s) also registry operators, same canonical addr`)
if (overlap.length) console.log('    e.g.', overlap.slice(0, 3).join(', '))
console.log('rejection guard (malformed input must throw):')
for (const r of rejections) console.log('   ', r)

const ok = failures.length === 0 && rejections.every(r => r.endsWith('✓'))
console.log('')
console.log(ok
  ? 'PASS ✓  every legacynet operator address normalizes to a byte-identical EIP-55; malformed rejected.'
  : 'FAIL ✗  see failures above.')
process.exit(ok ? 0 : 1)
