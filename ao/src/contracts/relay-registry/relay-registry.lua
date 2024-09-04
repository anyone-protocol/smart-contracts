Handlers.add(
  "ping",
  Handlers.utils.hasMatchingTag("Action", "Ping"),
  function(msg)
    ao.send({ Target = msg.From, Data = "pong" })
  end
)
