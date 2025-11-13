local ACLUtils = {
  State = {
    Roles = {
      -- admin   = { 'address1' = true, 'address2' = true }
      -- [role1] = { 'address3' = true, 'address4' = true }
      -- [role2] = { 'address5' = true, 'address6' = true }
    }
  }
}

function ACLUtils.assertHasOneOfRole(address, roles)
  for _, role in pairs(roles) do
    if role == 'owner' and address == ao.env.Process.Owner then
      return true
    elseif ACLUtils.State.Roles[role]
      and ACLUtils.State.Roles[role][address] ~= nil
    then
      return true
    end
  end

  assert(false, 'Permission Denied')
end

function ACLUtils.updateRoles(updateRolesDto)
  local shouldPatchState = false

  if updateRolesDto.Grant ~= nil then
    shouldPatchState = true
    for address, roles in pairs(updateRolesDto.Grant) do
      for _, role in pairs(roles) do
        if ACLUtils.State.Roles[role] == nil then
          ACLUtils.State.Roles[role] = {}
        end
        ACLUtils.State.Roles[role][address] = true
      end
    end
  end

  if updateRolesDto.Revoke ~= nil then
    shouldPatchState = true
    for address, roles in pairs(updateRolesDto.Revoke) do
      for _, role in pairs(roles) do
        if ACLUtils.State.Roles[role] == nil then
          ACLUtils.State.Roles[role] = {}
        end
        ACLUtils.State.Roles[role][address] = nil
      end
    end
  end

  if shouldPatchState then
    ao.send({
      device = 'patch@1.0',
      acl = ACLUtils.State.Roles
    })
  end
end

return ACLUtils
