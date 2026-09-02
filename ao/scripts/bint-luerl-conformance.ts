// D7 substrate conformance — reward-math integer fidelity under HyperBEAM's luerl
// (Lua 5.3 in Erlang), the runtime our ported contracts will run on.
//
// FINDING (2026-07-18): the canonical hyper-aos `bint.lua` is a NO-GO under luerl —
// `newmodule(256)` HANGS (confirmed: parse-only returns in 0.5s, but bint's
// integer-width auto-detection provokes a 64-bit wrap that luerl never produces,
// so its detection loop never terminates). luerl represents Lua integers as
// Erlang integers: ARBITRARY PRECISION, no 64-bit wrap (`math.type(maxint+1) ==
// "integer"`). So bint is not only unusable, it's unnecessary — native integer
// arithmetic is exact for token-scale values with correct Lua floor-div/mod.
//
// CAVEAT baked into the strategy: `tonumber("<big decimal>")` returns a FLOAT
// (precision lost) — big integer *literals* parse exact via the lexer, but runtime
// string→number does not. Contracts parse string amounts (`bint(score.Staked)`),
// so amounts must be parsed with a digit-fold helper (`n = n*10 + byte-48`), which
// is exact. This test uses that helper and diffs a contract-representative battery
// against a JS BigInt reference (arbitrary precision; native luerl ints don't wrap,
// so no fixed-width modeling is needed).
//
// Run:  HB_URL=http://localhost:8734 bun run scripts/bint-luerl-conformance.ts
import { readFileSync } from 'fs'
import { EthereumSigner } from '@dha-team/arbundles'
import { computeAddress } from 'ethers'
import { fetchNodeAddress, spawnLuaProcess, sendMessage, readState } from './util/hb-client'

const HB_URL = process.env.HB_URL || 'http://localhost:8734'
const ETH_KEY = (process.env.DEPLOYER_PRIVATE_KEY
  || '80611882d38e5502d93305c88b64da234fea23037334ecb9a647249076c5fa37').replace(/^0x/, '')
const MODULE_FILE = process.env.MODULE_FILE
  || '/var/home/jim/dev/anyone-protocol/smart-contracts/ao/vendor/hyper-aos.lua'

// luerl-side helpers: digit-fold string→exact-integer parser (contracts get string
// amounts), and its inverse is just tostring (exact for integers).
const PRELUDE = `local function I(s) local n=0 for i=1,#s do n=n*10+(string.byte(s,i)-48) end return n end`

// ---- reference (plain BigInt; Lua floor div/mod) ----
const fdiv = (a: bigint, b: bigint) => { let q = a / b; if ((a % b !== 0n) && ((a < 0n) !== (b < 0n))) q--; return q }
const fmod = (a: bigint, b: bigint) => a - fdiv(a, b) * b

type Case = { name: string; lua: string; expect: string }
const cases: Case[] = []
// operand: string amounts go through the digit-fold parser I("..."). The parser
// is unsigned (contract amounts are non-negative token strings); negatives arise
// from native arithmetic, so encode a negative operand as -(parsed positive).
const I = (x: bigint) => x < 0n ? `(-I("${(-x).toString()}"))` : `I("${x.toString()}")`
const OPS: Record<string, (a: bigint, b: bigint) => bigint> =
  { '+': (a, b) => a + b, '-': (a, b) => a - b, '*': (a, b) => a * b, '//': fdiv, '%': fmod }
function arith(name: string, a: bigint, op: keyof typeof OPS, b: bigint) {
  cases.push({ name, lua: `tostring(${I(a)} ${op} ${I(b)})`, expect: OPS[op](a, b).toString() })
}
function cmp(name: string, a: bigint, op: string, b: bigint, expect: boolean) {
  cases.push({ name, lua: `tostring(${I(a)} ${op} ${I(b)})`, expect: String(expect) })
}
function raw(name: string, lua: string, expect: string) { cases.push({ name, lua, expect }) }

const E18 = 10n ** 18n, P53 = 1n << 53n, P64 = 1n << 64n
const big = 12345678901234567890123456789012345678n // 38 digits
const staked = 1000000000000000000000n              // 21-digit token amount

// basic + word-boundary integer arithmetic
arith('add.small', 2n, '+', 3n)
arith('mul.small', 6n, '*', 7n)
arith('idiv.small', 20n, '//', 3n)
arith('mod.small', 20n, '%', 3n)
arith('mul.over2^53', P53 + 1n, '*', 2n)
arith('add.over2^64', P64, '+', 1n)
arith('mul.over2^64', P64 + 7n, '*', 3n)
arith('mul.big38', big, '*', 98765n)
arith('idiv.big38', big, '//', 1000000n)
// negative floor semantics (Lua // floors; % takes divisor sign)
arith('idiv.negA', -7n, '//', 2n) // -4
arith('mod.negA', -7n, '%', 2n)   //  1
arith('idiv.negB', 7n, '//', -2n) // -4
arith('mod.negB', 7n, '%', -2n)   // -1
// token reward pattern: (amount * roundLength * rating) // ratings
raw('reward.pattern',
  `${I(staked)} local v = (${I(staked)} * 3600 * ${I(4127n)}) // ${I(10000n)} return tostring(v)`,
  fdiv(staked * 3600n * 4127n, 10000n).toString())
// comparisons (contracts use >=, <=, ==)
cmp('cmp.lt', 5n, '<', 10n, true)
cmp('cmp.ge.eq', 10n, '>=', 10n, true)
cmp('cmp.eq.big', big, '==', big, true)
cmp('cmp.le.false', 11n, '<=', 10n, false)
// exact string round-trip (parse -> tostring) of token amounts
raw('roundtrip.staked', `tostring(${I(staked)})`, staked.toString())
raw('roundtrip.e18', `tostring(${I(E18)})`, E18.toString())
raw('roundtrip.big38', `tostring(${I(big)})`, big.toString())
// integer-ness preserved through arithmetic (no float promotion)
raw('type.after.mul', `math.type(${I(big)} * 98765)`, 'integer')
raw('type.after.idiv', `math.type(${I(big)} // 7)`, 'integer')

const chunk = `${PRELUDE}
local r = {}
${cases.map((c, i) => `  r[${i + 1}] = (function() local ok,v = pcall(function() ${c.lua.includes('return') ? c.lua : 'return ' + c.lua} end) return ok and tostring(v) or ("ERR:"..tostring(v)) end)()`).join('\n')}
return table.concat(r, "|")`

;(async () => {
  const signer = new EthereumSigner(ETH_KEY)
  const config = { url: HB_URL, signer }
  console.log(`node:   ${HB_URL} (${await fetchNodeAddress(HB_URL)})`)
  console.log(`module: ${MODULE_FILE}`)
  console.log(`cases:  ${cases.length}  (native luerl integers + digit-fold string parse; bint dropped — it hangs)\n`)

  const { pid } = await spawnLuaProcess(config, {
    luaSource: readFileSync(MODULE_FILE, 'utf-8'),
    authority: computeAddress('0x' + ETH_KEY),
    tags: [{ name: 'name', value: `bint-conf-${Date.now()}` }],
  })
  await sendMessage(config, { pid, tags: [{ name: 'action', value: 'Eval' }], data: chunk })
  const out = await readState(config, pid, 'results/output/data')
  if (out === 'Message is not trusted.') throw new Error('owner/trust rejected — cannot Eval')

  const got = out.split('|')
  let fail = 0
  for (let i = 0; i < cases.length; i++) {
    const c = cases[i], g = got[i] ?? '<missing>'
    const ok = g === c.expect
    if (!ok) fail++
    if (!ok || process.env.VERBOSE) console.log(`  [${ok ? 'ok ' : 'FAIL'}] ${c.name.padEnd(20)} expect=${c.expect}  got=${g}`)
  }
  console.log(`\n${cases.length - fail}/${cases.length} exact  |  ${fail} FAIL`)
  console.log(fail === 0
    ? 'SUBSTRATE PASS ✓ — native luerl integers do reward math bit-exact; port off bint (parse strings via digit-fold).'
    : 'SUBSTRATE FAIL ✗ — see FAIL rows.')
  process.exit(fail === 0 ? 0 : 1)
})().catch(e => { console.error('\nHARNESS ERROR:', String(e?.message || e).slice(0, 500)); process.exit(2) })
