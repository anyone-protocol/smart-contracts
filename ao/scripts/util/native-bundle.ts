// Build the native operator-registry module bundle: json + common libs + native runtime +
// the contract, each wrapped so `require(...)` resolves against package.loaded, then
// installed and registered. This is the single source of truth for the bundle — the tier3
// scripts and the module-publish flow all import buildBundle() so they stay byte-identical.
import fs from 'fs'
import path from 'path'

const AO = path.resolve(import.meta.dir, '..', '..')
const rd = (rel: string) => fs.readFileSync(path.join(AO, rel), 'utf-8')
const wrap = (src: string) => `(function()\n${src}\nend)()`

const LIB_PRELOADS = (): string[] => [
  `package.loaded['json'] = ${wrap(rd('runtime/vendor/json.lua'))}`,
  `package.loaded['.json'] = package.loaded['json']`,
  `package.loaded['.common.errors'] = ${wrap(rd('src/contracts/common/errors.lua'))}`,
  `package.loaded['.common.utils'] = ${wrap(rd('src/contracts/common/utils.lua'))}`,
  `package.loaded['.common.eip55'] = ${wrap(rd('src/contracts/common/eip55.lua'))}`,
  `native = ${wrap(rd('runtime/native.lua'))}`,
  `native.install()`,
]

/** The full inline Lua bundle for a native operator-registry process. */
export function buildBundle (contractRel = 'src/contracts/native/operator-registry.lua'): string {
  return [
    ...LIB_PRELOADS(),
    `native.register(${wrap(rd(contractRel))})`,
  ].join('\n')
}

/**
 * A SEED bundle: the same contract, but its initial `state` (and ACL `roles`) overridden with
 * migrated legacynet data so the process materializes real state at spawn (migrate-on-spawn).
 * The domain contract source is untouched — we bind its returned table to a local and replace
 * two fields, so the seed stays byte-consistent with a normal deploy everywhere else.
 *
 * `stateJson` / `rolesJson` are embedded as Lua long-bracket strings and json.decode'd on the
 * device at module load (JSON is far more compact in-source than a 12k-entry table literal, and
 * contains no `]==]` sequence, so the bracket is safe). `rolesJson` is the `acl.roles` map
 * ({ [roleName] = { [address] = true } }) — decode(...) yields {} for "{}", which is correct.
 */
export function buildSeedBundle (
  stateJson: string,
  rolesJson: string,
  contractRel = 'src/contracts/native/operator-registry.lua'
): string {
  return [
    ...LIB_PRELOADS(),
    `local __seed = ${wrap(rd(contractRel))}`,
    `__seed.state = package.loaded['json'].decode([==[${stateJson}]==])`,
    `__seed.acl = { roles = package.loaded['json'].decode([==[${rolesJson}]==]) }`,
    `native.register(__seed)`,
  ].join('\n')
}
