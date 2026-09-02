// The write gate's subject rule must NOT be usable off the bundler route.
//
// WHY THIS EXISTS. `runtime/write-gate.lua` recovers a signer from the item named by
// `bundler-subject` when the envelope itself is unsigned, because the node's own uploads arrive
// that way (`hb_http:post` never commits what it sends). `committersOf` reads the `committer`
// FIELD -- it does not check a signature -- and whether that field can be trusted at p4 time is
// codec-dependent (`hb_http:req_to_tabm_singleton`):
//
//   ans104@1.0  verified unconditionally by ar_bundles:verify_item
//   tx@1.0      verified unconditionally by ar_tx:verify
//   other       verified by hb_message:verify
//   httpsig@1.0 verified ONLY when `force_signed_requests` is set -- and it is NOT set on any of
//               our nodes (checked on stage and live: the key is absent, so upstream's `false`)
//
// The bundler envelope is unsigned httpsig. So without a path restriction, ANY unsigned httpsig
// request carrying `bundler-subject` gets its signer from an UNVERIFIED nested field -- and a
// request aimed at `/<pid>~process@1.0/push` would be admitted on it, consuming the scheduler slot
// the gate exists to protect.
//
// HOW IT IS TESTED, and why nothing weaker will do. An earlier version of this check hand-rolled a
// JSON body with a fake `commitments` map. It was refused 400 -- and refused identically by the
// UNCONFINED gate, because it never decoded and never reached p4 at all. A test that passes
// against the vulnerable build proves nothing.
//
// So this captures a REAL envelope: point `bundler-ans104` at a local listener, drive one write,
// and keep the bytes the node actually sent (unsigned httpsig, multipart, `bundler-subject: body`,
// a properly signed subject inside). Then replay those exact bytes at a push path and read the
// gate's own answer.
//
// The discriminator is the REFUSAL STRING, not the status code. Both builds answer 400: the
// confined gate refuses at p4 ("Node will not service this request under any circumstances."),
// the unconfined one ADMITS and the request dies further downstream in the push machinery with a
// bare 400. Asserting on the status alone would pass on the vulnerable build.
//
// Usage:  bun run scripts/probe/gate-subject-replay.ts
//         GATE_SRC=<lua> bun run scripts/probe/gate-subject-replay.ts   # e.g. the pre-fix gate
import fs from 'fs'
import net from 'node:net'
import path from 'path'
import { execFileSync } from 'node:child_process'
import { EthereumSigner } from '@dha-team/arbundles'
import { computeAddress, hexlify } from 'ethers'
import { fetchNodeAddress, spawnLuaProcess, sendMessage } from '../util/hb-client'
import { requireDeployerKey } from '../util/helpers'

const IMAGE = process.env.IMAGE ||
  'ghcr.io/memetic-block/hyperbeam-docker@sha256:ace515580b495c56ccdc61daa716a21614439897c0dcf2ff84563c04277d0826'
const NAME = 'hb-subject-replay'
const HB = 'http://localhost:8734'
const CAPTURE_PORT = 9099
const RELDIR = '/app/_build/default/rel/hb'
const AO = path.resolve(import.meta.dir, '../..')
const WORK = fs.mkdtempSync('/tmp/subject-replay-')
const CFG = path.join(WORK, 'config.json')

const sleep = (n: number) => new Promise(r => setTimeout(r, n))
const podman = (a: string[], t = 180_000) => execFileSync('podman', a, { encoding: 'utf8', timeout: t })

let fails = 0, checks = 0
const check = (ok: boolean, label: string, detail = '') => {
  checks++; if (!ok) fails++
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? '  — ' + detail : ''}`)
}

const deployer = new EthereumSigner(requireDeployerKey())
const deployerAddr = computeAddress(hexlify(deployer.publicKey))

const writeConfig = (o: { pid?: string, gateModuleId?: string, nodeAddr?: string, bundler: string }) => {
  const wallets = [deployerAddr, ...(o.nodeAddr ? [o.nodeAddr] : [])]
  const cfg: Record<string, unknown> = {
    'scheduler-default-commitment-spec': 'ans104@1.0',
    'bundler-ans104': o.bundler,
    on: {
      request: [
        { device: 'rate-limit@1.0' },
        { device: 'auth-hook@1.0', path: 'request', when: { keys: ['authorization', '!'] },
          'secret-provider': { device: 'http-auth@1.0', 'access-control': { device: 'http-auth@1.0' } } },
        { device: 'name@1.0' },
        { device: 'manifest@1.0' },
        { device: 'blacklist@1.0' },
        ...(o.gateModuleId ? [{
          device: 'p4@1.0', 'pricing-device': 'lua@5.3a', 'ledger-device': 'faff@1.0',
          module: o.gateModuleId,
          'gated-processes': o.pid ? [o.pid] : [],
          'operator-registry': o.pid ?? '',
          'deploy-wallets': wallets,
        }] : []),
      ],
    },
    'faff-allow-list': wallets,
    'p4-non-chargable-routes': [
      ...(o.pid ? [{ template: `^/${o.pid}~process@1.0/(now|compute|slot|as)` }] : []),
      { template: '^/$' }, { template: '^/~meta@1.0' },
      { template: '^/~hyperbuddy@1.0' }, { template: '^/~query@1.0' },
    ],
    'rate-limit-requests': 100000, 'rate-limit-max': 100000, 'rate-limit-period': 60,
  }
  const fd = fs.openSync(CFG, 'w'); fs.writeSync(fd, JSON.stringify(cfg, null, 2)); fs.closeSync(fd)
}

const waitUp = async (n = 90) => {
  for (let i = 0; i < n; i++) {
    if ((await fetch(`${HB}/~meta@1.0/info/address`).catch(() => null))?.ok) return true
    await sleep(2000)
  }
  return false
}

/** One-shot HTTP sink that keeps the raw bytes and answers 200 so the node moves on. */
function captureOnce (timeoutMs: number): Promise<Buffer | null> {
  return new Promise(resolve => {
    let done = false
    const finish = (b: Buffer | null) => { if (!done) { done = true; try { srv.close() } catch {} ; resolve(b) } }
    const srv = net.createServer(sock => {
      const chunks: Buffer[] = []
      sock.on('data', d => {
        chunks.push(d)
        const buf = Buffer.concat(chunks)
        const i = buf.indexOf('\r\n\r\n')
        if (i < 0) return
        const m = /content-length:\s*(\d+)/i.exec(buf.subarray(0, i).toString())
        if (m && buf.length - (i + 4) >= Number(m[1])) {
          sock.end('HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\n{}')
          finish(buf)
        }
      })
      sock.on('error', () => {})
    })
    srv.on('error', () => finish(null))
    srv.listen(CAPTURE_PORT, '127.0.0.1')
    setTimeout(() => finish(null), timeoutMs)
  })
}

/** Replay captured bytes at another path, over a raw socket so nothing is re-encoded. */
function replayAt (raw: Buffer, targetPath: string): Promise<string> {
  const i = raw.indexOf('\r\n\r\n')
  const head = raw.subarray(0, i).toString().split('\r\n')
  const body = raw.subarray(i + 4)
  const out = [`POST ${targetPath} HTTP/1.1`]
  for (const l of head.slice(1)) {
    const k = l.split(':')[0].toLowerCase()
    if (k === 'path') { out.push(`path: ${targetPath}`); continue }   // the gate reads request.path
    if (k === 'host') { out.push('Host: 127.0.0.1:8734'); continue }
    out.push(l)
  }
  const req = Buffer.concat([Buffer.from(out.join('\r\n') + '\r\n\r\n'), body])
  return new Promise(resolve => {
    const chunks: Buffer[] = []
    const sock = net.createConnection(8734, '127.0.0.1', () => sock.write(req))
    sock.setTimeout(45_000)
    sock.on('data', d => chunks.push(d))
    sock.on('timeout', () => sock.destroy())
    sock.on('error', () => resolve(''))
    sock.on('close', () => resolve(Buffer.concat(chunks).toString('utf8')))
  })
}

;(async () => {
  console.log(`\n=== the subject rule must not be usable off the bundler route ===`)
  console.log(`  image ${IMAGE}`)

  podman(['rm', '-f', NAME], 60_000)
  writeConfig({ bundler: `http://127.0.0.1:${CAPTURE_PORT}` })
  podman(['run', '-d', '--name', NAME, '--network', 'host',
    '-v', `${CFG}:${RELDIR}/config.json:ro,Z`,
    '-e', 'HB_CONFIG=config.json', '-e', 'HB_ALLOW_EPHEMERAL_WALLET=true',
    IMAGE])
  if (!await waitUp()) { console.log(podman(['logs', '--tail', '40', NAME])); process.exit(2) }
  const nodeAddr = await fetchNodeAddress(HB)

  const gateSrc = process.env.GATE_SRC || path.join(AO, 'runtime/write-gate.lua')
  console.log(`  gate  ${gateSrc}`)
  podman(['cp', gateSrc, `${NAME}:/tmp/wg.lua`], 300_000)
  podman(['exec', NAME, './bin/hb', 'eval',
    `{ok,S}=file:read_file("/tmp/wg.lua"), M=hb_message:commit(#{ <<"data-protocol">> => <<"ao">>, <<"variant">> => <<"ao.N.1">>, <<"type">> => <<"module">>, <<"content-type">> => <<"application/lua">>, <<"name">> => <<"write-gate">>, <<"body">> => S }, #{ <<"priv-wallet">> => hb:wallet() }, <<"ans104@1.0">>), {ok,_}=hb_cache:write(M,#{}), ok=file:write_file("/tmp/wg.id", hb_util:id(M)).`],
    600_000)
  const gateModuleId = podman(['exec', NAME, 'cat', '/tmp/wg.id'], 60_000).trim()

  const { pid } = await spawnLuaProcess({ url: HB, signer: deployer }, {
    luaSource: `function compute(p,m,o) p.results={output={data='ok'}}; return p end`,
    schedulerLocation: nodeAddr, tags: [{ name: 'name', value: 'subject-replay' }] })

  // Gate on, bundler still pointed at the capture sink.
  writeConfig({ pid, gateModuleId, nodeAddr, bundler: `http://127.0.0.1:${CAPTURE_PORT}` })
  podman(['restart', NAME], 240_000)
  if (!await waitUp()) { console.log(podman(['logs', '--tail', '40', NAME])); process.exit(2) }

  console.log(`\n  [1] capture one real upload envelope`)
  const capturing = captureOnce(60_000)
  await sleep(1000)
  await sendMessage({ url: HB, signer: deployer }, { pid, tags: [{ name: 'action', value: 'Capture' }] })
    .catch(e => console.log(`      push: ${String(e).slice(0, 70)}`))
  const raw = await capturing
  check(raw !== null, 'captured the node\'s own bundler POST', raw ? `${raw.length} B` : 'nothing arrived')
  if (!raw) { podman(['rm', '-f', NAME], 60_000); process.exit(2) }
  const headText = raw.subarray(0, raw.indexOf('\r\n\r\n')).toString()
  check(/bundler-subject:\s*body/i.test(headText), 'it carries bundler-subject: body')
  check(!/signature/i.test(headText.split('\n')[0]) && !/^signature:/im.test(headText),
    'the ENVELOPE is unsigned (no signature header)')

  console.log(`\n  [2] replay those exact bytes at a PUSH path`)
  const slotOf = async () => {
    const t = await fetch(`${HB}/${pid}~process@1.0/slot/current`).then(r => r.text()).catch(() => '')
    return /^\d+$/.test(t.trim()) ? parseInt(t.trim(), 10) : NaN
  }
  const before = await slotOf()
  const resp = await replayAt(raw, `/${pid}~process@1.0/push`)
  await sleep(2000)
  const after = await slotOf()
  const status = resp.split('\r\n')[0] || '(no response)'
  const refusedByGate = resp.includes('will not service this request')
  console.log(`      ${status}`)
  console.log(`      gate refusal message: ${refusedByGate ? 'YES' : 'NO'}   slot ${before} -> ${after}`)

  // THE assertion. A bare 400 is NOT enough: the unconfined gate ADMITS this replay and it dies
  // downstream with a bare 400, which is indistinguishable from a refusal by status alone.
  check(refusedByGate,
    'the GATE ITSELF refuses a bundler envelope replayed at a push path',
    refusedByGate ? 'answered with its own refusal' : 'admitted by p4 — the subject rule is not confined')
  check(after === before, 'no slot was consumed', `slot ${before} -> ${after}`)

  console.log(`\n${fails === 0 ? 'PASS' : 'FAILED'} — ${checks - fails}/${checks} checks`)
  if (process.env.KEEP === '1') console.log(`  KEEP=1 — ${NAME} left up, config ${CFG}`)
  else { podman(['rm', '-f', NAME], 60_000); fs.rmSync(WORK, { recursive: true, force: true }) }
  process.exit(fails === 0 ? 0 : 1)
})().catch(e => {
  console.error(e)
  try { console.log(podman(['logs', '--tail', '40', NAME])) } catch {}
  if (process.env.KEEP !== '1') podman(['rm', '-f', NAME], 60_000)
  process.exit(2)
})
