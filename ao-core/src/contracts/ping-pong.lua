local process = { _version = '0.0.1' }
AO = require('.ao')

function process.handle(msg, env)

  if (msg.Data == 'ping') then
    AO.send({ Target = msg.From, Data = 'pong' })
  end

  return AO.result({
    Output = 'sent pong reply'
  })

end

return process
