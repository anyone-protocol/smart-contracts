local json = require('json')

ACL = require('.common.acl')

StakingSnapshots = StakingSnapshots or {
  Name = 'StakingSnapshots',
  HistorySize = 10,
  Snapshots = {}
}

Handlers.add('Update-Roles', 'Update-Roles', function (msg)
  ACL.assertHasOneOfRole(msg.From, { 'owner', 'admin', 'Update-Roles' })
  ACL.updateRoles(json.decode(msg.Data))
  ao.send({
    Target = msg.From,
    Action = 'Update-Roles-Response',
    Data = 'OK'
  })
  ao.send({
    device = 'patch@1.0',
    acl = ACL.State.Roles
  })
end)

Handlers.add('View-Roles', 'View-Roles', function (msg)
  ao.send({
    Target = msg.From,
    Action = 'View-Roles-Response',
    Data = json.encode(ACL.State)
  })
end)

Handlers.add('Set-History-Size', 'Set-History-Size', function (msg)
  ACL.assertHasOneOfRole(msg.From, { 'owner', 'admin', 'Set-History-Size' })
  local size = tonumber(msg.Data)
  assert(size and size > 0, 'History size must be a positive integer')
  StakingSnapshots.HistorySize = size
  ao.send({
    Target = msg.From,
    Action = 'Set-History-Size-Response',
    Data = 'OK'
  })
end)

Handlers.add('Add-Staking-Snapshot', 'Add-Staking-Snapshot', function (msg)
  ACL.assertHasOneOfRole(msg.From, { 'owner', 'admin', 'Add-Staking-Snapshot' })
  local snapshot = json.decode(msg.Data)
  assert(snapshot, 'Staking Snapshot is required as message data')

  table.insert(StakingSnapshots.Snapshots, snapshot)

  if #StakingSnapshots.Snapshots > StakingSnapshots.HistorySize then
    local toRemove = #StakingSnapshots.Snapshots - StakingSnapshots.HistorySize
    for _ = 1, toRemove, 1 do table.remove(StakingSnapshots.Snapshots, 1) end
  end

  ao.send({
    Target = msg.From,
    Action = 'Set-Snapshot-Response',
    Data = 'OK'
  })
  ao.send({
    device = 'patch@1.0',
    staking_snapshots = StakingSnapshots
  })
end)

Handlers.add('Info', 'Info', function (message)
  ao.send({
    Target = message.From,
    Action = 'Info-Response',
    Data = json.encode({
      Name = StakingSnapshots.Name,
      HistorySize = StakingSnapshots.HistorySize,
      SnapshotsCount = #StakingSnapshots.Snapshots
    })
  })
end)
