// The ONE definition of the Tier-3 staking round, shared by the luerl oracle
// (build-staking-oracle.ts) and the on-node driver (tier3-staking-validate.ts) so both provably
// run the identical input. If the two ever drifted, a parity "pass" would mean nothing.
//
// The round is built FROM the seed rather than from synthetic addresses: most pairs are real
// (hodler, operator) pairs carrying migrated Rewarded/Claimed balances, so `restaked` is computed
// against real priors and the cumulative bigint add lands on real balances. A minority are fresh
// pairs, which exercise the no-prior branch.
//
// Timestamps are REALISTIC 13-digit milliseconds (the seeded PreviousRound.Timestamp plus one
// hour, matching the live Period of 3600). That is deliberate: a large integer round timestamp is
// exactly what hung the device VM under A17, so the Tier-3 round must use one to prove the
// tostring() keying holds on the real VM.
import { getAddress } from 'ethers'

export type Score = { Staked: string; Running: number }
export type Round = {
  prev: number
  timestamp: number
  scores: Record<string, Record<string, Score>>
  realPairs: number
  freshPairs: number
  hodlers: number
  belowGate: number
  atGate: number
  withClaimedPrior: number
  selfPairs: number
  sampleHodler: string
}

const freshAddr = (i: number) => getAddress('0x' + 'feed' + i.toString(16).padStart(36, '0'))

export function buildRound(seedState: any, n = 250): Round {
  const rewarded: Record<string, Record<string, string>> = seedState.Rewarded
  const claimed: Record<string, Record<string, string>> = seedState.Claimed

  const all: { h: string; o: string }[] = []
  for (const h of Object.keys(rewarded)) for (const o of Object.keys(rewarded[h])) all.push({ h, o })
  if (all.length < n) throw new Error(`seed has ${all.length} pairs, need ${n}`)

  const running = (i: number) => (i % 9 === 0 ? 0.25 : i % 9 === 1 ? 0.5 : 1)
  const staked = (i: number) => String(BigInt(100 + (i * 137) % 9900) * 10n ** 18n)

  const scores: Record<string, Record<string, Score>> = {}
  let realPairs = 0, freshPairs = 0
  for (let i = 0; i < n; i++) {
    const p = all[i]
    ;(scores[p.h] ||= {})[p.o] = { Staked: staked(i), Running: running(i) }
    realPairs++
    // every 10th hodler also stakes to a brand-new operator → restaked = 0
    if (i % 10 === 0) {
      const fresh = freshAddr(i)
      if (!rewarded[p.h]?.[fresh]) { scores[p.h][fresh] = { Staked: staked(i + 3), Running: 1 }; freshPairs++ }
    }
  }

  let belowGate = 0, atGate = 0, withClaimedPrior = 0, selfPairs = 0
  for (const [h, ops] of Object.entries(scores)) for (const [o, s] of Object.entries(ops)) {
    if (s.Running < 0.5) belowGate++
    if (s.Running === 0.5) atGate++
    if (claimed[h]?.[o] != null && rewarded[h]?.[o] != null) withClaimedPrior++
    if (h === o) selfPairs++
  }

  const prev = seedState.PreviousRound.Timestamp
  return {
    prev,
    timestamp: prev + 3600_000,            // one hour on, matching the live Period of 3600
    scores,
    realPairs, freshPairs,
    hodlers: Object.keys(scores).length,
    belowGate, atGate, withClaimedPrior, selfPairs,
    sampleHodler: Object.keys(scores)[0],
  }
}
