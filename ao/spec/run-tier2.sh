#!/usr/bin/env bash
# Tier-2: run every luerl scenario through the real device VM and aggregate the results.
#
# This exists because the invocations are NOT uniform and cannot be inferred from the
# filenames. The runner has several modes with different arities, and the scenario
# directory also contains a file that is not a test at all:
#
#   native <root> <contract> <scenario>                 D26 contracts ({state,actions,views})
#   run    <root> <contract> <StateGlobal> <scenario>   legacy-shim contracts (global state)
#   bundle <bundle> <scenario>                          seeded bundle; used by Tier-3 oracles
#
# Getting this wrong is not a harmless error. `relay-round-probe.lua` is a Tier-3 parity
# ORACLE (bundle mode, prints PROBE=<json> for scripts/tier3-relay-validate.ts to compare
# against) and it keys a table by a 13-digit ms timestamp. Run it in the wrong mode and it
# hits A17 — luerl's `pairs`/`next` scans a table's array part up to the largest integer
# key — which is a ~3.5 hour single-core spin, not a crash. It is excluded below by name.
#
# Usage:
#   spec/run-tier2.sh                 # every scenario
#   spec/run-tier2.sh native-relay-rewards.lua …   # only the named ones
#
# Env:
#   CONTAINER_ENGINE  podman (default) or docker
#   LUERL_IMAGE       default anyone-luerl:1.3.0 — the exact luerl HyperBEAM v0.9-FINAL
#                     pins in its rebar.lock. Do not "upgrade" this casually: the whole
#                     point of the tier is to run what the node runs.
#   TIMEOUT           per-scenario seconds (default 300)
#   MOUNT_SUFFIX      volume-mount options; defaults to ':Z' under podman (SELinux
#                     relabelling, needed on Fedora-family hosts) and empty under docker.
set -uo pipefail

cd "$(dirname "$0")/.." || exit 2          # smart-contracts/ao
ENGINE="${CONTAINER_ENGINE:-podman}"
IMAGE="${LUERL_IMAGE:-anyone-luerl:1.3.0}"
TIMEOUT="${TIMEOUT:-300}"
if [ -z "${MOUNT_SUFFIX+x}" ]; then
  case "$ENGINE" in *podman*) MOUNT_SUFFIX=":Z" ;; *) MOUNT_SUFFIX="" ;; esac
fi

# scenario | mode | contract | state-global (run mode only)
SCENARIOS=(
  "native-operator-registry.lua|native|src/contracts/native/operator-registry.lua|"
  "native-relay-rewards.lua|native|src/contracts/native/relay-rewards.lua|"
  "native-staking-rewards.lua|native|src/contracts/native/staking-rewards.lua|"
  "operator-registry.lua|run|src/contracts/operator-registry.lua|OperatorRegistry"
  "relay-rewards.lua|run|src/contracts/relay-rewards.lua|RelayRewards"
  "staking-rewards.lua|run|src/contracts/staking-rewards.lua|StakingRewards"
)
# Present in scenarios/ but deliberately NOT run here — see the header.
NOT_A_TEST=("relay-round-probe.lua")

want=("$@")
selected() {
  [ ${#want[@]} -eq 0 ] && return 0
  for w in "${want[@]}"; do [ "$w" = "$1" ] && return 0; done
  return 1
}

total_pass=0 total_fail=0 errors=0 ran=0

for entry in "${SCENARIOS[@]}"; do
  IFS='|' read -r scen mode contract global <<< "$entry"
  selected "$scen" || continue
  ran=$((ran + 1))

  case "$mode" in
    native) args=(native /work "$contract" "/work/spec/luerl/scenarios/$scen") ;;
    run)    args=(run    /work "$contract" "$global" "/work/spec/luerl/scenarios/$scen") ;;
    *)      echo "  ?? $scen: unknown mode '$mode'"; errors=$((errors + 1)); continue ;;
  esac

  printf '  %-32s ' "$scen"
  out=$(timeout "$TIMEOUT" "$ENGINE" run --rm -v "$PWD:/work$MOUNT_SUFFIX" -w /work "$IMAGE" "${args[@]}" 2>&1)
  rc=$?

  if [ $rc -eq 124 ]; then
    echo "TIMEOUT after ${TIMEOUT}s"
    errors=$((errors + 1))
    continue
  fi

  # The runner reports `=== N passed, M failed ===`. A scenario that produced no such line
  # is an ERROR, never a pass — otherwise a crashed or mis-invoked run reads as success.
  line=$(printf '%s\n' "$out" | grep -oE '=== [0-9]+ passed, [0-9]+ failed ===' | tail -1)
  if [ -z "$line" ]; then
    echo "NO RESULT (rc=$rc)"
    printf '%s\n' "$out" | tail -5 | sed 's/^/      /'
    errors=$((errors + 1))
    continue
  fi

  p=$(sed -E 's/=== ([0-9]+) passed.*/\1/' <<< "$line")
  f=$(sed -E 's/.*, ([0-9]+) failed ===/\1/' <<< "$line")
  total_pass=$((total_pass + p)); total_fail=$((total_fail + f))
  if [ "$f" -gt 0 ]; then
    echo "$p passed, $f FAILED"
    printf '%s\n' "$out" | grep -iE 'fail' | head -8 | sed 's/^/      /'
  else
    echo "$p passed"
  fi
done

echo
if [ ${#want[@]} -eq 0 ] && [ "$ran" -ne "${#SCENARIOS[@]}" ]; then
  echo "ERROR: ran $ran of ${#SCENARIOS[@]} scenarios"
  exit 1
fi
for n in "${NOT_A_TEST[@]}"; do echo "  (skipped $n — Tier-3 oracle, not a test)"; done
echo "Tier-2: $total_pass passed, $total_fail failed, $errors errored across $ran scenarios"
[ "$total_fail" -eq 0 ] && [ "$errors" -eq 0 ] && [ "$ran" -gt 0 ]
