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
  `package.loaded['.common.bigint'] = ${wrap(rd('src/contracts/common/bigint.lua'))}`,
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
 * The migration seed as a SPAWN-DATA envelope — the deploy path.
 *
 * The published module stays PURE SOURCE (buildBundle, ~68KB) and the seed rides the spawn
 * message. The runtime consumes it at slot 0 (runtime/native.lua, `base.state == nil`) and
 * never again.
 *
 * This replaces buildSeedBundle for anything that SPAWNS. Embedding the dump in the module
 * cost a json.decode of the whole thing on EVERY READ, because the module is reloaded into a
 * fresh luerl VM per read while the declared `state` is consumed only once. Measured on the
 * real operator-registry (~1MB dump): 2.60s/read embedded vs 0.43s seeded at spawn, with
 * byte-identical resulting state. It also makes the module reusable — one published module
 * per contract serves dev/stage/live and every reseed, instead of one artifact per migration.
 *
 * The `ao-migration-seed` marker is what the runtime gates on, so ordinary spawn data is
 * never mistaken for a seed.
 */
export function buildSeedEnvelope (stateJson: string, rolesJson: string): string {
  return `{"ao-migration-seed":1,"state":${stateJson},"acl":{"roles":${rolesJson}}}`
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
 *
 * ⚠️ NOT for anything that SPAWNS — use buildSeedEnvelope above. This exists for the
 * luerl-only fixtures (the Tier-2/Tier-3 oracles and cross-checks), which load a .lua file
 * directly under the runner and so have no spawn message to carry a seed. There the per-read
 * decode cost does not apply: the bundle is loaded once per runner invocation.
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

/**
 * The built seed envelope for a contract, or `undefined` when none has been built.
 *
 * Spawn sites pass this as the spawn-message data so the process migrates at slot 0.
 * Returning `undefined` (rather than throwing) is deliberate: a spawn with no seed is a
 * legitimate fresh deploy, and the runtime then falls back to the contract's declared
 * empty state.
 */
export function seedEnvelopeFor (contract: string): string | undefined {
  const p = path.join(AO, 'dist', `${contract}-seed.envelope.json`)
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf-8') : undefined
}
