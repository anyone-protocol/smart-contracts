// E2E: deploy operator-registry to a live HyperBEAM node and drive the full
// operator-registration lifecycle across two identities (admin + operator).
//
//   bun run e2e:operator-registry
//
// Mutations go through messages; registry STATE is read from the node cache over
// HTTP. Mirrors the spirit of test/spec/contracts/operator-registry.spec.ts.

import {
  run, step, info, check, checkEqual,
  newActor, deployContract, readState, readLeaf, stateKeys, pollStateKeys,
  evmAddress, normalizeEvmAddress
} from './harness'

const OWNER_KEY = process.env.DEPLOYER_PRIVATE_KEY
// A throwaway identity acting as the relay operator (not owner, not admin).
const OPERATOR_KEY = '0x' + '7'.repeat(64)

const CLAIMABLE = 'claimable_fingerprints_to_operator_addresses'
const VERIFIED = 'verified_fingerprints_to_operator_addresses'
const BLOCKED = 'blocked_operator_addresses'

const FINGERPRINT = 'A'.repeat(40)

run('operator-registry e2e (registration lifecycle on hyperbeam)', async () => {
  if (!OWNER_KEY) throw new Error('DEPLOYER_PRIVATE_KEY is required')

  const owner = await newActor(OWNER_KEY)
  const operator = await newActor(OPERATOR_KEY)
  const opAddr = evmAddress(OPERATOR_KEY)        // checksummed, == operator's msg.From
  const opAddrNorm = normalizeEvmAddress(opAddr) // how the registry stores it
  info('operator address', opAddr)

  const reg = await deployContract(owner, 'operator-registry')
  info('processId', reg.pid)

  step('Registry starts with no claimable certificates')
  checkEqual(stateKeys(await readState(reg.pid, CLAIMABLE)), [], 'no claimable certs at start')

  step('Owner submits an operator certificate (fingerprint -> operator address)')
  let r = await reg.send(
    owner,
    'Admin-Submit-Operator-Certificates',
    JSON.stringify([{ f: FINGERPRINT, a: opAddr }])
  )
  check(!r.Error, 'Admin-Submit-Operator-Certificates did not error')
  check(!!r.Messages?.some((m: any) => m.Data === 'OK'), 'responded OK')
  checkEqual(
    await pollStateKeys(reg.pid, CLAIMABLE, [FINGERPRINT]),
    [FINGERPRINT],
    'the fingerprint is now claimable'
  )
  checkEqual(
    await readLeaf(reg.pid, `${CLAIMABLE}/${FINGERPRINT}`),
    opAddrNorm,
    'claimable by the operator address'
  )

  step('Operator claims their fingerprint certificate')
  r = await reg.send(
    operator,
    'Submit-Fingerprint-Certificate',
    undefined,
    [{ name: 'Fingerprint-Certificate', value: FINGERPRINT }]
  )
  check(!r.Error, 'Submit-Fingerprint-Certificate did not error')
  check(!!r.Messages?.some((m: any) => m.Data === 'OK'), 'responded OK')
  checkEqual(
    await pollStateKeys(reg.pid, CLAIMABLE, []),
    [],
    'fingerprint is no longer claimable after the claim'
  )
  checkEqual(
    await readLeaf(reg.pid, `${VERIFIED}/${FINGERPRINT}`),
    opAddrNorm,
    'fingerprint is now verified to the operator'
  )

  step('Owner blocks the operator address')
  r = await reg.send(owner, 'Block-Operator-Address', undefined, [
    { name: 'Address', value: opAddr }
  ])
  check(!r.Error, 'Block-Operator-Address did not error')
  checkEqual(
    await pollStateKeys(reg.pid, BLOCKED, [opAddr]),
    [opAddr],
    'operator address is now blocked'
  )

  step('Non-admin operator cannot submit operator certificates')
  r = await reg.send(
    operator,
    'Admin-Submit-Operator-Certificates',
    JSON.stringify([{ f: 'B'.repeat(40), a: opAddr }])
  )
  check(
    typeof r.Error === 'string' && r.Error.includes('Permission Denied'),
    'non-admin Admin-Submit is rejected with Permission Denied'
  )
  checkEqual(
    stateKeys(await readState(reg.pid, CLAIMABLE)),
    [],
    'no new claimable cert was created by the rejected admin call'
  )

  check(true, 'operator-registry registration lifecycle verified end-to-end on hyperbeam')
})
