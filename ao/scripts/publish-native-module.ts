// Publish the native module the HyperBEAM-native way (NO Turbo): write the bundle to a file,
// hand it to the node's own `bin/hb eval` which commits it (ans104, node wallet), writes it to
// the LOCAL cache (so by-id spawn resolves instantly), and uploads it to the configured
// bundler (up.arweave.net) for persistence. Prints MODULE_ID = hb_util:id(committed).
//
// This script just emits the bundle file + the exact `bin/hb eval` command to run in the
// container (this host drives podman directly; in prod the same eval runs on the node host).
// Run: bun run scripts/publish-native-module.ts [outfile]
import fs from 'fs'
import path from 'path'
import { buildBundle } from './util/native-bundle'

const out = process.argv[2]
  || path.join(path.resolve(import.meta.dir, '..'), 'dist', 'operator-registry-native.lua')
const bundle = buildBundle()
fs.mkdirSync(path.dirname(out), { recursive: true })
fs.writeFileSync(out, bundle)
console.log(`wrote ${out}  (${(bundle.length / 1024).toFixed(1)}KB)`)

// The node-side eval (commit → local cache write → bundler upload → print id).
const ERL = `
{ok, Script} = file:read_file("/tmp/native-module.lua"),
Msg = hb_message:commit(
  #{
    <<"data-protocol">> => <<"ao">>,
    <<"variant">> => <<"ao.N.1">>,
    <<"type">> => <<"module">>,
    <<"content-type">> => <<"application/lua">>,
    <<"name">> => <<"operator-registry-native">>,
    <<"body">> => Script
  },
  #{ <<"priv-wallet">> => hb:wallet() },
  <<"ans104@1.0">>
),
{ok, _} = hb_cache:write(Msg, #{}),
UploadStatus = (catch hb_client:upload(Msg, #{}, <<"ans104@1.0">>)),
io:format("MODULE_ID=~s UPLOAD=~p~n", [hb_util:id(Msg), UploadStatus]).
`.trim().replace(/\n/g, ' ')

console.log(`\n# 1) copy the bundle into the node container:`)
console.log(`podman cp ${out} hb-tier3:/tmp/native-module.lua`)
console.log(`\n# 2) commit + cache + upload it, capture MODULE_ID:`)
console.log(`podman exec hb-tier3 ./bin/hb eval '${ERL}'`)
