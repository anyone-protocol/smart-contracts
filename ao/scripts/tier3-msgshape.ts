// Probe: how does the lua device present a message's action/tags/data to compute()?
// Spawns a trivial process that stashes the shape of what it receives, then reads it.
// Run: HB_URL=http://localhost:8734 bun run scripts/tier3-msgshape.ts
import { EthereumSigner } from '@dha-team/arbundles'
import { fetchNodeAddress, spawnLuaProcess, sendMessage } from './util/hb-client'

const HB_URL = process.env.HB_URL || 'http://localhost:8734'
const KEY = process.env.DEPLOYER_PRIVATE_KEY
  || '80611882d38e5502d93305c88b64da234fea23037334ecb9a647249076c5fa37'

// Stash the top-level key set of the message (and of message.body if present), plus a few
// candidate lookups for the tag we send as `fingerprint-certificate`.
const LUA = `
function compute(process, message, opts)
  local dbg = {}
  local ok, err = pcall(function()
    local b = message.body or message
    dbg.has_body   = tostring(message.body ~= nil)
    local ks = {}
    for k in pairs(b) do ks[#ks + 1] = tostring(k) end
    dbg.body_keys  = table.concat(ks, ',')
    dbg.body_committer = tostring(b.committer)
    dbg.body_from  = tostring(b.from)
    dbg.body_owner = tostring(b.owner)
    dbg.body_signers = tostring(b.signers)
    local mks = {}
    for k in pairs(message) do mks[#mks + 1] = tostring(k) end
    dbg.msg_keys   = table.concat(mks, ',')
    dbg.action     = tostring(b.action)
    dbg.fc_lower   = tostring(b['fingerprint-certificate'])
    dbg.fc_title   = tostring(b['Fingerprint-Certificate'])
    dbg.addr_lower = tostring(b['address'])
    local coms = b.commitments
    if type(coms) == 'table' then
      for _, c in pairs(coms) do
        if type(c) == 'table' then
          dbg.com_device    = tostring(c['commitment-device'])
          dbg.com_type      = tostring(c.type)
          dbg.com_committer = tostring(c.committer)
          local ks = {}
          for k in pairs(c) do ks[#ks + 1] = tostring(k) end
          dbg.com_keys = table.concat(ks, ',')
          break
        end
      end
    end
  end)
  dbg.compute_ok = tostring(ok)
  dbg.compute_err = tostring(err)
  process.dbg = dbg
  process.results = { output = { body = 'ok' } }
  return process
end
`

;(async () => {
  const config = { url: HB_URL, signer: new EthereumSigner(KEY.replace(/^0x/, '')) }
  console.log(`node ${HB_URL} (${await fetchNodeAddress(HB_URL)})`)
  const { pid } = await spawnLuaProcess(config, { luaSource: LUA, tags: [{ name: 'name', value: `msgshape-${Date.now()}` }] })
  console.log(`pid = ${pid}`)
  await sendMessage(config, {
    pid,
    tags: [
      { name: 'action', value: 'Test-Action' },
      { name: 'fingerprint-certificate', value: 'FPVALUE123' },
    ],
    data: 'DATAVALUE',
  })
  const P = `${HB_URL}/${pid}~process@1.0`
  const r = await fetch(`${P}/now/dbg/serialize~json@1.0`)
  console.log((await r.text()).trim())
  process.exit(0)
})().catch(e => { console.error('FATAL', String(e?.message || e).slice(0, 300)); process.exit(1) })
