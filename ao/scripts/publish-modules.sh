#!/usr/bin/env bash
# Publish the native contract modules AND the write gate into a node's own cache, then print the
# ids. Run from smart-contracts/ao/ on a host with nomad access (this workstation has none).
#
# Idempotent: republishing the same bytes yields the same id (content-addressed), so re-running
# is safe. NOTE the id is the SIGNED item id, so it depends on the signing wallet — a module
# published by a different node gets a different id.
#
# Build dist/ first:  for c in operator-registry relay-rewards staking-rewards; do
#                       bun run scripts/build-native-bundle.ts $c; done
#
# The WRITE GATE id goes into Consul as smart-contracts/<env>/write-gate-module-id, which the
# jobspec renders into the p4 hook's "module" key. It must exist in the node's cache BEFORE the
# gated config is applied: the gate fails CLOSED, so a missing module means every write to every
# gated contract is refused.
#
# Usage:
#   scripts/publish-modules.sh [dev|stage|live] [--gate-only]
#
# `--gate-only` skips the three contract modules and publishes just the write gate. Use it when
# only runtime/write-gate.lua changed — republishing unchanged contract bytes is harmless but slow,
# and it needs dist/ built, which the gate does not.
#
# 🚨 PUBLISH ON THE NODE THAT WILL USE IT. The id is the SIGNED item id, so the same bytes signed
# by a different node's wallet mint a DIFFERENT id. Publishing per environment writes the module
# into that node's own cache, so it resolves LOCALLY and needs no Arweave round trip — which
# matters, because module resolution otherwise goes through Arweave GraphQL and is gated on
# INDEXING, a lead time measured in hours during which a by-id spawn is accepted and only fails at
# compute. Expect a different id per environment and set each jobspec to its own.
#
# ORDER, because the gate fails closed:
#   1. publish here and note the id
#   2. put the id in that environment's jobspec `module` key
#   3. deploy
# Never step 2 before step 1.
set -euo pipefail

ENV=dev
GATE_ONLY=0
for a in "$@"; do
  case "$a" in
    dev|stage|live) ENV=$a ;;
    --gate-only)    GATE_ONLY=1 ;;
    *) echo "usage: $0 [dev|stage|live] [--gate-only]" >&2; exit 2 ;;
  esac
done

case "$ENV" in
  dev)   NS=dev-services   ;;
  stage) NS=stage-services ;;
  # The live node moved to the protocol pool; its namespace is not `live-services`.
  live)  NS=live-protocol  ;;
esac
JOB=hyperbeam-$ENV
TASK=hyperbeam-$ENV-task
echo "env: $ENV  (namespace $NS, job $JOB)"

ALLOC=$(nomad job allocs -namespace "$NS" -t '{{range .}}{{if eq .ClientStatus "running"}}{{.ID}}{{"\n"}}{{end}}{{end}}' "$JOB" | head -1)
[ -n "$ALLOC" ] || { echo "no running alloc for $JOB in $NS"; exit 1; }
echo "alloc: $ALLOC"
x () { nomad alloc exec -namespace "$NS" -task "$TASK" "$ALLOC" "$@"; }

if [ "$GATE_ONLY" = "0" ]; then
echo "== native-opreg"
x sh -c 'cat > /tmp/native-opreg.lua' < dist/operator-registry-native.lua
x ./bin/hb eval '{ok, Script} = file:read_file("/tmp/native-opreg.lua"), Msg = hb_message:commit(  #{ <<"data-protocol">> => <<"ao">>, <<"variant">> => <<"ao.N.1">>,     <<"type">> => <<"module">>, <<"content-type">> => <<"application/lua">>,     <<"name">> => <<"native-opreg">>, <<"body">> => Script },  #{ <<"priv-wallet">> => hb:wallet() }, <<"ans104@1.0">>), {ok, _} = hb_cache:write(Msg, #{}), ok = file:write_file("/tmp/native-opreg.id", hb_util:id(Msg)).'
MODULE_ID_NATIVE=$(x cat /tmp/native-opreg.id | tr -d "\r\n")
echo "  MODULE_ID_NATIVE=$MODULE_ID_NATIVE"

echo "== opreg-src"
x sh -c 'cat > /tmp/opreg-src.lua' < dist/operator-registry-native.lua
x ./bin/hb eval '{ok, Script} = file:read_file("/tmp/opreg-src.lua"), Msg = hb_message:commit(  #{ <<"data-protocol">> => <<"ao">>, <<"variant">> => <<"ao.N.1">>,     <<"type">> => <<"module">>, <<"content-type">> => <<"application/lua">>,     <<"name">> => <<"opreg-src">>, <<"body">> => Script },  #{ <<"priv-wallet">> => hb:wallet() }, <<"ans104@1.0">>), {ok, _} = hb_cache:write(Msg, #{}), ok = file:write_file("/tmp/opreg-src.id", hb_util:id(Msg)).'
MODULE_ID_OPREG=$(x cat /tmp/opreg-src.id | tr -d "\r\n")
echo "  MODULE_ID_OPREG=$MODULE_ID_OPREG"

echo "== relay-src"
x sh -c 'cat > /tmp/relay-src.lua' < dist/relay-rewards-native.lua
x ./bin/hb eval '{ok, Script} = file:read_file("/tmp/relay-src.lua"), Msg = hb_message:commit(  #{ <<"data-protocol">> => <<"ao">>, <<"variant">> => <<"ao.N.1">>,     <<"type">> => <<"module">>, <<"content-type">> => <<"application/lua">>,     <<"name">> => <<"relay-src">>, <<"body">> => Script },  #{ <<"priv-wallet">> => hb:wallet() }, <<"ans104@1.0">>), {ok, _} = hb_cache:write(Msg, #{}), ok = file:write_file("/tmp/relay-src.id", hb_util:id(Msg)).'
MODULE_ID_RELAY=$(x cat /tmp/relay-src.id | tr -d "\r\n")
echo "  MODULE_ID_RELAY=$MODULE_ID_RELAY"

echo "== staking-src"
x sh -c 'cat > /tmp/staking-src.lua' < dist/staking-rewards-native.lua
x ./bin/hb eval '{ok, Script} = file:read_file("/tmp/staking-src.lua"), Msg = hb_message:commit(  #{ <<"data-protocol">> => <<"ao">>, <<"variant">> => <<"ao.N.1">>,     <<"type">> => <<"module">>, <<"content-type">> => <<"application/lua">>,     <<"name">> => <<"staking-src">>, <<"body">> => Script },  #{ <<"priv-wallet">> => hb:wallet() }, <<"ans104@1.0">>), {ok, _} = hb_cache:write(Msg, #{}), ok = file:write_file("/tmp/staking-src.id", hb_util:id(Msg)).'
MODULE_ID_STAKING=$(x cat /tmp/staking-src.id | tr -d "\r\n")
echo "  MODULE_ID_STAKING=$MODULE_ID_STAKING"
fi

echo "== write-gate (p4 pricing device)"
x sh -c 'cat > /tmp/write-gate.lua' < runtime/write-gate.lua
x ./bin/hb eval '{ok, Script} = file:read_file("/tmp/write-gate.lua"), Msg = hb_message:commit(  #{ <<"data-protocol">> => <<"ao">>, <<"variant">> => <<"ao.N.1">>,     <<"type">> => <<"module">>, <<"content-type">> => <<"application/lua">>,     <<"name">> => <<"write-gate">>, <<"body">> => Script },  #{ <<"priv-wallet">> => hb:wallet() }, <<"ans104@1.0">>), {ok, _} = hb_cache:write(Msg, #{}), ok = file:write_file("/tmp/write-gate.id", hb_util:id(Msg)).'
MODULE_ID_WRITE_GATE=$(x cat /tmp/write-gate.id | tr -d "\r\n")
echo "  MODULE_ID_WRITE_GATE=$MODULE_ID_WRITE_GATE"

echo
echo "# consul key for the jobspec:"
echo "consul kv put smart-contracts/$ENV/write-gate-module-id $MODULE_ID_WRITE_GATE"
echo
echo "# the jobspec currently hard-codes the id, so set it there too:"
echo "#   hyperbeam/operations/hyperbeam-$ENV.hcl  ->  \"module\": \"$MODULE_ID_WRITE_GATE\""
if [ "$GATE_ONLY" = "0" ]; then
  echo
  echo "# paste this back:"
  echo "export MODULE_ID_NATIVE=$MODULE_ID_NATIVE MODULE_ID_OPREG=$MODULE_ID_OPREG MODULE_ID_RELAY=$MODULE_ID_RELAY MODULE_ID_STAKING=$MODULE_ID_STAKING"
fi
