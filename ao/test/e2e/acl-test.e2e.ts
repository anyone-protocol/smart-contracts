// E2E: deploy acl-test to a live HyperBEAM node and drive its role lifecycle.
//
//   bun run e2e            # builds, then runs this against HB_URL (default :8734)
//
// Mirrors the unit coverage in test/spec/contracts/common/acl.spec.ts, but
// against a real spawned process. Mutations (Update-Roles) go through messages;
// role STATE is read back from the node's cache over HTTP (not a View message).

import {
  run, step, info, check, checkEqual,
  newActor, deployContract, readState, stateKeys, pollStateKeys
} from './harness'

const OWNER_KEY = process.env.DEPLOYER_PRIVATE_KEY
// A throwaway identity that is NOT the process owner and holds no roles.
const STRANGER_KEY = '0x' + '7'.repeat(64)

run('acl-test e2e (spawn + role lifecycle on hyperbeam)', async () => {
  if (!OWNER_KEY) throw new Error('DEPLOYER_PRIVATE_KEY is required')

  const owner = await newActor(OWNER_KEY)
  const stranger = await newActor(STRANGER_KEY)

  const acl = await deployContract(owner, 'acl-test')
  info('processId', acl.pid)

  step('No roles exist before any grant')
  checkEqual(stateKeys(await readState(acl.pid, 'acl')), [], 'acl state starts empty')

  step('Owner grants 0xAAA the mock-role')
  let r = await acl.send(owner, 'Update-Roles', JSON.stringify({
    Grant: { '0xAAA': ['mock-role'] }
  }))
  check(!r.Error, 'owner Update-Roles did not error')
  check(
    !!r.Messages?.some((m: any) =>
      m.Tags?.some((t: any) => t.name === 'device' && t.value === 'patch@1.0')),
    'emitted a patch@1.0 state update'
  )
  check(!!r.Messages?.some((m: any) => m.Data === 'OK'), 'responded OK to the granter')

  step('Cached state reflects the grant')
  checkEqual(
    await pollStateKeys(acl.pid, 'acl/mock-role', ['0xAAA']),
    ['0xAAA'],
    'mock-role has member 0xAAA'
  )

  step('Stranger (non-owner, no roles) cannot grant roles')
  r = await acl.send(stranger, 'Update-Roles', JSON.stringify({
    Grant: { '0xEVIL': ['admin'] }
  }))
  check(
    typeof r.Error === 'string' && r.Error.includes('Permission Denied'),
    'non-owner grant is rejected with Permission Denied'
  )
  checkEqual(
    stateKeys(await readState(acl.pid, 'acl')),
    ['mock-role'],
    'no admin role was created by the rejected grant'
  )

  step('Owner revokes the mock-role from 0xAAA')
  r = await acl.send(owner, 'Update-Roles', JSON.stringify({
    Revoke: { '0xAAA': ['mock-role'] }
  }))
  check(!r.Error, 'owner revoke did not error')
  checkEqual(
    await pollStateKeys(acl.pid, 'acl/mock-role', []),
    [],
    'mock-role has no members after revoke'
  )

  check(true, 'acl-test deploy + role lifecycle verified end-to-end on hyperbeam')
})
