// Browser polyfills for Node globals that @dha-team/arbundles (and ao-signer.ts)
// reference — the dashboard gets these from Nuxt/Vite; a raw Bun browser bundle
// does not. MUST be imported before arbundles/ethers so the globals exist before
// any library code runs. Imported first in app.ts.
import { Buffer } from 'buffer'

const g = globalThis as any
if (!g.Buffer) g.Buffer = Buffer
if (!g.process) {
  g.process = {
    env: {},
    browser: true,
    version: 'v20.0.0', // some libs parse this; a real-looking value is safest
    nextTick: (fn: (...a: any[]) => void, ...args: any[]) => setTimeout(() => fn(...args), 0),
  }
}
if (typeof g.global === 'undefined') g.global = g
