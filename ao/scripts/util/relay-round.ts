// Realistic relay-rewards rounds, built FROM the seed — the relay counterpart to
// util/staking-round.ts.
//
// WHY THIS EXISTS. The Tier-3 relay parity vertical (tier3-relay-validate.ts) drives ONE round of
// THREE fingerprints, because its job is byte-identical parity against a luerl oracle and the
// oracle scenario is deliberately small. That is the right test for the reward math and the wrong
// test for everything else: the seed carries 9,750 fingerprints, so a 3-relay round exercises
// ~0.03% of realistic cardinality, in a single slot, with no accumulation across rounds.
//
// This builder produces rounds at realistic width, over REAL seeded fingerprints and addresses, so
// the cumulative bigint adds land on real priors rather than starting from zero. Rounds rotate
// through the fingerprint space so successive rounds touch different relays — except for a small
// TRACKED set that is present in EVERY round, which is what makes strict per-round monotonicity
// assertable (a rotating-only round would leave gaps where a fingerprint is untouched).
//
// Deterministic by construction: no Math.random, no Date.now. Same seed + same round index =>
// same scores, so a run is reproducible and diffable across nodes.

export type RelayScore = {
  Address: string
  Network: number
  IsHardware: boolean
  UptimeStreak: number
  ExitBonus: boolean
  FamilySize: number
  LocationSize: number
}

export type RelayRound = {
  timestamp: number
  scores: Record<string, RelayScore>
  tracked: string[]
  trackedAddress: string
  rotating: number
}

/** Fingerprints present in every round, so their cumulative reward must strictly increase. */
export const TRACKED_COUNT = 3

/**
 * Build round `round` (1-based) of `n` fingerprints.
 * `n` counts the ROTATING fingerprints; the tracked ones are added on top.
 */
export function buildRelayRound (seedState: any, n: number, round: number): RelayRound {
  const fps: string[] = Object.keys(seedState.TotalFingerprintReward)
  const addrs: string[] = Object.keys(seedState.TotalAddressReward)
  if (fps.length < n + TRACKED_COUNT) {
    throw new Error(`seed has ${fps.length} fingerprints, need ${n + TRACKED_COUNT}`)
  }

  // The tracked slice is reserved off the front and never enters the rotating window — a
  // fingerprint appearing twice in one round is rejected by the contract ('Duplicated score').
  const tracked = fps.slice(0, TRACKED_COUNT)
  const pool = fps.slice(TRACKED_COUNT)
  const trackedAddress = addrs[0]

  // Vary the score fields per (round, index) so no two rounds are byte-identical inputs, while
  // staying inside every validation bound the contract asserts (all integers, all >= 0).
  // Network is kept strictly positive so every scored fingerprint earns a non-zero reward —
  // monotonicity assertions downstream depend on that.
  const mk = (i: number, Address: string): RelayScore => ({
    Address,
    Network: 100_000 + ((i * 7919 + round * 101) % 900_000),
    IsHardware: (i + round) % 3 === 0,
    UptimeStreak: (i * 13 + round) % 60,
    ExitBonus: (i + round) % 5 === 0,
    FamilySize: 1 + ((i + round) % 8),
    LocationSize: 1 + ((i * 3 + round) % 12),
  })

  const scores: Record<string, RelayScore> = {}
  for (let i = 0; i < TRACKED_COUNT; i++) scores[tracked[i]] = mk(i, trackedAddress)

  const offset = (round * n) % Math.max(1, pool.length - n)
  for (let i = 0; i < n; i++) {
    scores[pool[offset + i]] = mk(i + TRACKED_COUNT, addrs[(offset + i) % addrs.length])
  }

  return {
    // 13-digit ms, one Period (3600s) on per round — the same realistic magnitude that hung the
    // device VM under A17, so sustained running keeps proving the tostring() keying holds.
    timestamp: seedState.PreviousRound.Timestamp + round * 3600_000,
    scores,
    tracked,
    trackedAddress,
    rotating: n,
  }
}
