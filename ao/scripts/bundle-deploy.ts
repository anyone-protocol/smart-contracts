// Bundle a deployable lua-device module = lean runtime + contract + deps, as ONE
// self-contained file exposing global `compute(base, assignment)`. Uses the existing
// aos lua-bundler (inline-preload). Stages files so require() paths resolve, and names
// the contract with underscores (the bundler can't wrap hyphenated module names).
//
// Usage: STAGE_DIR=<scratch> bun run scripts/bundle-deploy.ts <contract> <StateGlobal>
//   e.g. bun run scripts/bundle-deploy.ts operator-registry OperatorRegistry
import fs from 'fs'
import path from 'path'
import { bundle } from './lua-bundler'

const contract = process.argv[2]
const stateGlobal = process.argv[3]
if (!contract || !stateGlobal) {
  console.error('usage: bundle-deploy <contract> <StateGlobal>')
  process.exit(1)
}

const AO = path.resolve(import.meta.dir, '..')
const under = contract.replace(/-/g, '_')
const stageBase = process.env.STAGE_DIR || '/tmp'
const stage = fs.mkdtempSync(path.join(stageBase, 'aobundle-'))
fs.mkdirSync(path.join(stage, 'common'), { recursive: true })

const cp = (from: string, to: string) => fs.copyFileSync(from, path.join(stage, to))
// The contract is a script (sets a global + self-inits) with no `return`. As a bundled
// *module* it must return a truthy value or the bundler's package.loaded[...] = module()
// is nil and require() falls through to a (failing) filesystem search. Append `return
// true` to the STAGED copy only — repo source stays byte-for-byte.
fs.writeFileSync(
  path.join(stage, `${under}.lua`),
  fs.readFileSync(`${AO}/src/contracts/${contract}.lua`, 'utf-8') + '\nreturn true\n'
)
for (const m of ['errors', 'utils', 'acl', 'bigint']) {
  const f = `${AO}/src/contracts/common/${m}.lua`
  if (fs.existsSync(f)) cp(f, `common/${m}.lua`)
}
cp(`${AO}/runtime/runtime.lua`, 'runtime.lua')
cp(`${AO}/runtime/vendor/json.lua`, 'json.lua')

// Entry: require the runtime FIRST (it self-installs on load), then the contract (its
// module-level init() registers handlers), then register the state roots. `compute` is
// a global defined by the runtime — the lua device's entrypoint.
const entry = [
  `local runtime = require('.runtime')`,
  `require('.${under}')`,
  `runtime.manage(${stateGlobal})`,
  `runtime.manage(require('.common.acl').State)`,
  ``,
].join('\n')
const entryPath = path.join(stage, `${under}_deploy.lua`)
fs.writeFileSync(entryPath, entry)

const out = bundle(entryPath)
fs.mkdirSync(`${AO}/dist`, { recursive: true })
const outPath = `${AO}/dist/${contract}-deploy.lua`
fs.writeFileSync(outPath, out)
console.log(`bundled ${contract} -> ${outPath} (${out.length} bytes)`)
