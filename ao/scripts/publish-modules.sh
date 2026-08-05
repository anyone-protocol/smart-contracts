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
set -euo pipefail

NS=dev-services
JOB=hyperbeam-dev
TASK=hyperbeam-dev-task

ALLOC=$(nomad job allocs -namespace "$NS" -t '{{range .}}{{if eq .ClientStatus "running"}}{{.ID}}{{"\n"}}{{end}}{{end}}' "$JOB" | head -1)
[ -n "$ALLOC" ] || { echo "no running alloc for $JOB in $NS"; exit 1; }
echo "alloc: $ALLOC"
x () { nomad alloc exec -namespace "$NS" -task "$TASK" "$ALLOC" "$@"; }

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

echo "== write-gate (p4 pricing device)"
x sh -c 'cat > /tmp/write-gate.lua' < runtime/write-gate.lua
x ./bin/hb eval '{ok, Script} = file:read_file("/tmp/write-gate.lua"), Msg = hb_message:commit(  #{ <<"data-protocol">> => <<"ao">>, <<"variant">> => <<"ao.N.1">>,     <<"type">> => <<"module">>, <<"content-type">> => <<"application/lua">>,     <<"name">> => <<"write-gate">>, <<"body">> => Script },  #{ <<"priv-wallet">> => hb:wallet() }, <<"ans104@1.0">>), {ok, _} = hb_cache:write(Msg, #{}), ok = file:write_file("/tmp/write-gate.id", hb_util:id(Msg)).'
MODULE_ID_WRITE_GATE=$(x cat /tmp/write-gate.id | tr -d "\r\n")
echo "  MODULE_ID_WRITE_GATE=$MODULE_ID_WRITE_GATE"

echo
echo "# consul key for the jobspec:"
echo "consul kv put smart-contracts/stage/write-gate-module-id $MODULE_ID_WRITE_GATE"
echo
echo "# paste this back:"
echo "export MODULE_ID_NATIVE=$MODULE_ID_NATIVE MODULE_ID_OPREG=$MODULE_ID_OPREG MODULE_ID_RELAY=$MODULE_ID_RELAY MODULE_ID_STAKING=$MODULE_ID_STAKING"
