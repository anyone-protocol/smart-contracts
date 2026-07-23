// Tier-3 VERTICAL VALIDATION — drive the native operator-registry through its FULL surface
// on a live v0.9-FINAL node with real EVM-signed messages, asserting everything Tier-1/2
// structurally cannot: on-node revert + wedge-resistance (the infallible trampoline), ACL /
// identity enforcement against a node-verified committer, and read-path serialization for
// every shape. Spawns BY MODULE_ID (inline spawns wedge at ~slot 3 — see D26 / memory), so a
// published module is required. Two distinct signers exercise the ACL/identity axes.
//
//   MODULE_ID=<id> HB_URL=http://localhost:8734 bun run scripts/tier3-validate.ts
//   (publish first: bun run scripts/publish-native-module.ts  → run the printed bin/hb eval)
import { EthereumSigner } from '@dha-team/arbundles'
import { Wallet, getAddress } from 'ethers'
import { fetchNodeAddress, spawnLuaProcess, sendMessage } from './util/hb-client'

const HB = process.env.HB_URL || 'http://localhost:8734'
const MODULE_ID = process.env.MODULE_ID
if (!MODULE_ID) { console.error('MODULE_ID env required (publish the module first)'); process.exit(2) }

// Two distinct throwaway dev keys. OWNER spawns (→ process Owner); OP is a non-admin operator.
const OWNER_KEY = (process.env.DEPLOYER_PRIVATE_KEY
  || '80611882d38e5502d93305c88b64da234fea23037334ecb9a647249076c5fa37').replace(/^0x/, '')
const OP_KEY = '59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d'
const OWNER = new Wallet('0x' + OWNER_KEY).address
const OP = new Wallet('0x' + OP_KEY).address
// Addresses are stored VERBATIM as EIP-55 (the node hands ctx.from checksummed per D6; tooling
// supplies checksummed). norm() = ethers EIP-55 canonicalization, so expectations equal stored state
// and every comparison is an exact match. Wallet.address is already EIP-55, so norm() is a no-op here
// but keeps intent explicit and would catch a mis-cased literal.
const norm = (a: string) => getAddress(a)
const ownerSigner = new EthereumSigner(OWNER_KEY)
const opSigner = new EthereumSigner(OP_KEY)

// ---- assert framework (order-insensitive deep compare) ----------------------
let pass = 0, fail = 0
const failures: string[] = []
const canon = (v: any): any => Array.isArray(v) ? v.map(canon)
  : (v && typeof v === 'object') ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canon(v[k])])) : v
const check = (name: string, cond: boolean) => {
  if (cond) { pass++ } else { fail++; failures.push(name); console.log(`   ✗ ${name}`) }
}
const eq = (name: string, got: unknown, want: unknown) =>
  check(`${name}  [got ${JSON.stringify(got)} want ${JSON.stringify(want)}]`,
    JSON.stringify(canon(got)) === JSON.stringify(canon(want)))
const section = (s: string) => console.log(`\n=== ${s} ===`)

// ---- read helpers -----------------------------------------------------------
const P = (pid: string) => `${HB}/${pid}~process@1.0`
const raw = async (pid: string, key: string) => (await fetch(`${P(pid)}/now/${key}`)).text()
async function viewGet (pid: string, view: string, qs = '') {
  const r = await fetch(`${P(pid)}/now/~lua@5.3a/${view}${qs}`)
  const body = await r.text()
  let json: any = null; try { json = JSON.parse(body) } catch { /* */ }
  return { status: r.status, ct: r.headers.get('content-type') || '', body, json }
}
const dump = async (pid: string) => (await viewGet(pid, 'dump')).json || {}

async function send (signer: EthereumSigner, pid: string, action: string, tags: Record<string, string> = {}, data = '') {
  const taglist = [{ name: 'action', value: action },
    ...Object.entries(tags).map(([name, value]) => ({ name, value: String(value) }))]
  await sendMessage({ url: HB, signer }, { pid, tags: taglist, data })
  return (await raw(pid, 'results/output/data')).trim()
}
const spawn = (name: string) => spawnLuaProcess({ url: HB, signer: ownerSigner },
  { moduleId: MODULE_ID, tags: [{ name: 'name', value: `${name}-${Date.now()}` }] })

const FP = (c: string) => c.repeat(40)
const FP_A = FP('A'), FP_B = FP('B'), FP_C = FP('C'), FP_D = FP('D'), FP_E = FP('E')
// Pristine fingerprints reserved for error/atomicity cases: never seeded in section B, so
// "unknown" / "did not persist" assertions read a genuinely-absent key (not section-B state).
const FP_U = FP('9')   // never added to hardware — the true "unknown hardware" case
const FP_G = FP('7')   // never seeded in claimable — the atomic-batch good-half
const FP_BAD = 'nothex' + 'X'.repeat(34)

;(async () => {
  console.log(`node ${await fetchNodeAddress(HB)}  moduleId=${MODULE_ID}`)
  console.log(`OWNER ${OWNER}\nOP    ${OP}`)
  check('two distinct signers', OWNER.toLowerCase() !== OP.toLowerCase())

  // == A. spawn / materialization =============================================
  section('A. spawn (by module-id) + seed materialization')
  const { pid } = await spawn('validate')
  console.log(`pid = ${pid}`)
  eq('fresh state seeded empty', await dump(pid), {
    claimable: [], verified: [], blocked: [], verifiedHardware: [],
    registrationCredits: [], registrationCreditsRequired: false,
  })
  eq('Owner is the spawner (status.owner)', (await viewGet(pid, 'status')).json?.owner, OWNER)

  // == B. writes — happy path, each verified by read-back =====================
  section('B. every write action (authorized) persists')
  eq('Admin-Submit → OK', await send(ownerSigner, pid, 'Admin-Submit-Operator-Certificates', {},
    JSON.stringify([{ f: FP_A, a: OP, hw: true }, { f: FP_B, a: OP }, { f: FP_C, a: OWNER }])), 'OK')
  eq('  claimable[FP_A] = norm(OP)', await raw(pid, `state/claimable/${FP_A}`), norm(OP))
  eq('  verifiedHardware[FP_A] = true', await raw(pid, `state/verifiedHardware/${FP_A}`), 'true')

  eq('Submit-Fingerprint-Certificate (OP claims FP_A) → OK',
    await send(opSigner, pid, 'Submit-Fingerprint-Certificate', { 'fingerprint-certificate': FP_A }), 'OK')
  eq('  verified[FP_A] = norm(OP)', await raw(pid, `state/verified/${FP_A}`), norm(OP))
  eq('  claimable[FP_A] cleared', (await dump(pid)).claimable[FP_A] ?? null, null)

  eq('Add-Registration-Credit → OK',
    await send(ownerSigner, pid, 'Add-Registration-Credit', { address: OP, fingerprint: FP_B }), 'OK')
  eq('  registrationCredits[FP_B] = norm(OP)', (await dump(pid)).registrationCredits[FP_B], norm(OP))

  // Block/Unblock: pass norm() so the maps + views agree (address-form is legacy tech debt).
  eq('Block-Operator-Address → OK', await send(ownerSigner, pid, 'Block-Operator-Address', { address: norm(OP) }), 'OK')
  eq('  blocked[norm(OP)] = true', await raw(pid, `state/blocked/${norm(OP)}`), 'true')
  eq('Unblock-Operator-Address → OK', await send(ownerSigner, pid, 'Unblock-Operator-Address', { address: norm(OP) }), 'OK')
  eq('  blocked[norm(OP)] cleared', (await dump(pid)).blocked[norm(OP)] ?? null, null)

  eq('Add-Verified-Hardware (csv) → OK', await send(ownerSigner, pid, 'Add-Verified-Hardware', {}, `${FP_D},${FP_E}`), 'OK')
  eq('  hardware has FP_D & FP_E', [(await dump(pid)).verifiedHardware[FP_D], (await dump(pid)).verifiedHardware[FP_E]], [true, true])
  eq('Remove-Verified-Hardware (csv) → OK', await send(ownerSigner, pid, 'Remove-Verified-Hardware', {}, `${FP_D},${FP_E}`), 'OK')
  eq('  hardware FP_D removed', (await dump(pid)).verifiedHardware[FP_D] ?? null, null)

  eq('Remove-Registration-Credit → OK', await send(ownerSigner, pid, 'Remove-Registration-Credit', { address: norm(OP), fingerprint: FP_B }), 'OK')
  eq('  registrationCredits[FP_B] cleared', (await dump(pid)).registrationCredits[FP_B] ?? null, null)

  eq('Renounce-Fingerprint-Certificate (OP renounces FP_A) → OK',
    await send(opSigner, pid, 'Renounce-Fingerprint-Certificate', { fingerprint: FP_A }), 'OK')
  eq('  verified[FP_A] cleared', (await dump(pid)).verified[FP_A] ?? null, null)

  eq('Remove-Fingerprint-Certificate (admin, no-op on unverified) → OK',
    await send(ownerSigner, pid, 'Remove-Fingerprint-Certificate', { fingerprint: FP_C }), 'OK')

  // == C. error / revert + WEDGE-RESISTANCE (the infallible trampoline) ========
  section('C. error paths revert on-node & never wedge the process')
  const before = await dump(pid)
  const errCases: [string, string, Record<string, string>, string][] = [
    ['invalid fingerprint', 'Admin-Submit-Operator-Certificates', {}, JSON.stringify([{ f: FP_BAD, a: OWNER }])],
    ['invalid address', 'Admin-Submit-Operator-Certificates', {}, JSON.stringify([{ f: FP_A, a: '0xnotanaddress' }])],
    // mixed-case address with a wrong EIP-55 checksum → rejected on-chain (keccak validate-and-reject)
    ['bad EIP-55 checksum', 'Admin-Submit-Operator-Certificates', {}, JSON.stringify([{ f: FP('6'), a: '0x70997970c51812dc3A010C7d01b50e0d17dc79C8' }])],
    ['unblock non-blocked', 'Unblock-Operator-Address', { address: norm(OWNER) }, ''],
    ['remove non-existent credit', 'Remove-Registration-Credit', { address: norm(OWNER), fingerprint: FP_A }, ''],
    ['remove unknown hardware', 'Remove-Verified-Hardware', {}, FP_U],
    ['unknown action', 'No-Such-Action', {}, ''],
  ]
  for (const [label, action, tags, data] of errCases) {
    const out = await send(ownerSigner, pid, action, tags, data)
    check(`  "${label}" → error (not OK): ${out.slice(0, 50)}`, out !== 'OK' && /error|required|invalid|not|unknown|denied/i.test(out))
  }
  eq('  state unchanged after all error cases (revert)', await dump(pid), before)
  eq('  process NOT wedged — valid write after errors → OK',
    await send(ownerSigner, pid, 'Admin-Submit-Operator-Certificates', {}, JSON.stringify([{ f: FP_A, a: OWNER }])), 'OK')
  eq('  and it persisted', await raw(pid, `state/claimable/${FP_A}`), norm(OWNER))

  // atomicity: a batch that fails midway reverts the WHOLE batch
  section('C2. atomic batch revert')
  const preBatch = await dump(pid)
  const batchOut = await send(ownerSigner, pid, 'Admin-Submit-Operator-Certificates', {},
    JSON.stringify([{ f: FP_G, a: OWNER }, { f: FP_BAD, a: OWNER }]))
  check(`  partial batch → error: ${batchOut.slice(0, 40)}`, batchOut !== 'OK')
  eq('  good half (FP_G) did NOT persist', (await dump(pid)).claimable[FP_G] ?? null, null)
  eq('  whole state unchanged by failed batch', await dump(pid), preBatch)

  // == D. ACL enforcement with a real committer ================================
  section('D. ACL — non-admin denied, grant enables, revoke disables')
  const dOut = await send(opSigner, pid, 'Block-Operator-Address', { address: norm(OWNER) })
  check(`  OP (non-admin) Block → Permission Denied`, /denied/i.test(dOut))
  eq('  OWNER not blocked (denied write did not mutate)', (await dump(pid)).blocked[norm(OWNER)] ?? null, null)

  eq('  grant OP admin → OK',
    await send(ownerSigner, pid, 'Update-Roles', {}, JSON.stringify({ Grant: { [OP]: ['admin'] } })), 'OK')
  eq('  roles.admin[OP] = true', (await viewGet(pid, 'roles')).json?.admin?.[OP], true)
  eq('  OP (now admin) Block → OK', await send(opSigner, pid, 'Block-Operator-Address', { address: norm(OWNER) }), 'OK')
  eq('  OWNER now blocked', await raw(pid, `state/blocked/${norm(OWNER)}`), 'true')
  eq('  revoke OP admin → OK',
    await send(ownerSigner, pid, 'Update-Roles', {}, JSON.stringify({ Revoke: { [OP]: ['admin'] } })), 'OK')
  check(`  OP Block after revoke → Denied`, /denied/i.test(await send(opSigner, pid, 'Block-Operator-Address', { address: norm(OP) })))
  await send(ownerSigner, pid, 'Unblock-Operator-Address', { address: norm(OWNER) })

  // == E. identity / Eval gate =================================================
  section('E. identity — Eval is Owner-only')
  eq('  Owner Eval computes', await send(ownerSigner, pid, 'Eval', {}, 'return 40 + 2'), '42')
  check(`  non-Owner Eval denied`, /only available to the owner|denied/i.test(await send(opSigner, pid, 'Eval', {}, 'return 1')))

  // == F. read path — every view shape + content-type ==========================
  section('F. read-path shapes (fresh process, known state)')
  const { pid: vpid } = await spawn('views')
  await send(ownerSigner, vpid, 'Admin-Submit-Operator-Certificates', {}, JSON.stringify([
    { f: FP_A, a: OP, hw: true }, { f: FP_B, a: OWNER }, { f: FP_C, a: OP }]))
  await send(opSigner, vpid, 'Submit-Fingerprint-Certificate', { 'fingerprint-certificate': FP_A })
  await send(ownerSigner, vpid, 'Block-Operator-Address', { address: norm(OWNER) })

  for (const v of ['status', 'operators', 'scoring', 'roles', 'version', 'dump']) {
    const r = await viewGet(vpid, v)
    check(`  ${v}: 200 + application/json`, r.status === 200 && r.ct.includes('application/json'))
    check(`  ${v}: no commitments/+link leak`, !/commitments|\+link/.test(r.body))
  }
  eq('  status counts exact', (await viewGet(vpid, 'status')).json?.counts,
    { claimable: 2, verified: 1, blocked: 1, hardware: 1, credits: 0 })
  eq('  operators = verified − blocked (OP only)', (await viewGet(vpid, 'operators')).json, { [norm(OP)]: true })
  eq('  operator?address=OP footprint', (await viewGet(vpid, 'operator', `?address=${OP}`)).json, {
    address: norm(OP), blocked: false, verified: { [FP_A]: true }, claimable: { [FP_C]: true }, hardware: { [FP_A]: true } })
  const fps = (await viewGet(vpid, 'fingerprints', `?ids=${FP_A},${FP_B},${FP_D}`)).json
  eq('  fingerprints?ids: FP_A verified', fps?.[FP_A]?.verified, norm(OP))
  eq('  fingerprints?ids: FP_B claimable', fps?.[FP_B]?.claimable, norm(OWNER))
  eq('  fingerprints?ids: FP_D unknown', fps?.[FP_D]?.verified ?? null, null)
  const collide = await fetch(`${P(vpid)}/now/~lua@5.3a/fingerprints?fingerprints=${FP_A}`)
  check('  fingerprints?fingerprints= still shadows (documented footgun)',
    !(collide.headers.get('content-type') || '').includes('application/json'))

  // == summary =================================================================
  console.log(`\n${'='.repeat(60)}\nVERTICAL VALIDATION: ${pass} passed / ${fail} failed`)
  if (fail) { console.log('FAILURES:'); failures.forEach(f => console.log(`  - ${f}`)) }
  console.log(`pids: main=${pid} views=${vpid}`)
  process.exit(fail ? 1 : 0)
})().catch(e => { console.error('FATAL', String(e?.stack || e?.message || e).slice(0, 600)); process.exit(2) })
