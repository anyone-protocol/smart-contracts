// The one place that knows how to invoke the Tier-2 luerl runner image.
//
// Every caller used to hardcode `podman` and the podman-only `:Z` mount flag. That is correct on a
// Fedora-family dev host and broken everywhere else. GitHub's runners have docker and no podman, so
// a hardcoded `podman run … anyone-luerl:1.3.0` there did not fail with "podman: not found" — the
// runner images ship podman too, and it tried to PULL the image from docker.io/quay.io and got
// `requested access to the resource is denied`. The image is local-only (the workflow builds it),
// so that pull can never succeed, and the error names a registry rather than the engine mismatch.
//
// spec/run-tier2.sh already honoured CONTAINER_ENGINE; the TypeScript callers did not, and
// run-e2e.ts was passing CONTAINER_ENGINE to scripts that ignored it. This makes them agree.
//
// Env: CONTAINER_ENGINE (podman|docker, default podman), LUERL_IMAGE (default anyone-luerl:1.3.0).
import { execFileSync } from 'node:child_process'
import path from 'node:path'

const AO_ROOT = path.resolve(import.meta.dir, '../..')

export const ENGINE = process.env.CONTAINER_ENGINE || 'podman'
export const IMAGE = process.env.LUERL_IMAGE || 'anyone-luerl:1.3.0'
// SELinux relabelling is needed on Fedora-family hosts under podman; docker rejects :Z outright.
export const MOUNT = `${AO_ROOT}:/work${ENGINE.includes('podman') ? ':Z' : ''}`

/**
 * Run the luerl image with `ao/` mounted at /work. `args` are the runner's own arguments —
 * e.g. ['bundle', '/work/dist/seed.lua', '/work/dist/scen.lua'] or ['native', '/work', ...].
 * Throws execFileSync's error unchanged so callers keep their existing catch behaviour.
 */
export function luerl (
  args: string[],
  opts: { timeoutMs?: number, maxBuffer?: number } = {}
): string {
  return execFileSync(ENGINE, ['run', '--rm', '-v', MOUNT, '-w', '/work', IMAGE, ...args], {
    encoding: 'utf8',
    timeout: opts.timeoutMs ?? 900_000,
    maxBuffer: opts.maxBuffer ?? 512 * 1024 * 1024,
  })
}
