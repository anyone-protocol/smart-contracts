local process = { _version = '0.0.1' }
AO = require('.ao')

PingCount = 0
InitialSync = InitialSync or 'INCOMPLETE'
if InitialSync == 'INCOMPLETE' then
   AO.send({
    device = 'patch@1.0',
    cache = { PingCount = PingCount }
  })
  InitialSync = 'COMPLETE'
end

function process.handle(msg, env)
  if (msg.Data == 'ping') then
    PingCount = PingCount + 1
    AO.send({
      device = 'patch@1.0',
      cache = { PingCount = PingCount }
    })
    AO.send({ Target = msg.From, Data = 'pong' })
  end

  return AO.result({
    Output = 'sent pong reply'
  })

end

return process
