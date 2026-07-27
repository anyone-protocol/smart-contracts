// Generate a ladder of valid-but-inert lua modules at known sizes, to locate the bundler's
// free-tier boundary.
//
// Why a ladder rather than a binary search: settlement takes hours, so a serial search would
// take days per step. Publishing every size at once and rechecking later gets the whole curve
// from one wait. The answer we need is narrow — our largest real migration seed is
// operator-registry-seed at ~1052KB — but headroom above it tells us whether we are near an
// edge or comfortably inside.
//
// These are published to Arweave PERMANENTLY, so they are deliberately self-describing: each
// carries a header saying what it is and that it is inert, and a `purpose` tag. Anyone who finds
// one later should be able to tell immediately that it is a capacity probe and not a contract.
//
// Run: bun run scripts/build-size-ladder.ts [outdir]
import fs from 'node:fs'
import path from 'node:path'

const OUT = path.resolve(process.argv[2] || path.join(import.meta.dir, '..', 'dist', 'size-ladder'))

// Brackets the real need (~1052KB) with headroom on both sides.
const SIZES_KB = [100, 500, 1024, 2048, 5120, 10240]

fs.mkdirSync(OUT, { recursive: true })
let total = 0

for (const kb of SIZES_KB) {
  const target = kb * 1024
  const header =
    `-- Anyone Protocol — bundler free-tier capacity probe (${kb}KB).\n` +
    `-- INERT: defines nothing, exports nothing, and is not a contract. Published only to\n` +
    `-- measure whether items of this size settle on Arweave via the configured bundler.\n` +
    `-- See docs/hyperbeam-migration (D21 publishing).\n`
  // Pad with comment lines so the file stays syntactically valid lua at any size.
  const padLine = '-- ' + 'x'.repeat(96) + '\n'
  let body = header
  while (body.length + padLine.length <= target) body += padLine
  body += '-- ' + 'x'.repeat(Math.max(0, target - body.length - 4)) + '\n'

  const f = path.join(OUT, `probe-${String(kb).padStart(5, '0')}kb.lua`)
  fs.writeFileSync(f, body)
  total += body.length
  console.log(`  ${path.basename(f).padEnd(22)} ${String(body.length).padStart(9)} B  (target ${target})`)
}

console.log(`\n${SIZES_KB.length} files, ${(total / 1024 / 1024).toFixed(1)}MB total in ${OUT}`)
console.log('These will be PERMANENT if they settle. Publish with:')
console.log(`  BUNDLER=… PUBLISH_KEY=… bun run scripts/publish-module.ts ${path.relative(process.cwd(), OUT)}/*.lua \\`)
console.log(`    --manifest dist/size-ladder.json --wait 0`)
