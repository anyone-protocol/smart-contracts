// ** ACL Handlers
import { expect } from 'chai'

import {
  ALICE_ADDRESS,
  AOTestHandle,
  createLoader,
  FINGERPRINT_A,
  OWNER_ADDRESS
} from '~/test/util/setup'

describe('ACL enforcement of relay rewards', () => {
  let handle: AOTestHandle

  beforeEach(async () => {
    handle = (await createLoader('relay-rewards')).handle
  })

  describe('Update-Configuration', () => {
    it('Allows Admin Role')

    it('Allows Update-Configuration Role')
  })

  describe('Add-Scores', () => {
    it('Allows Admin Role')

    it('Allows Add-Scores Role')
  })

  describe('Complete-Round', () => {
    it('Allows Admin Role')

    it('Allows Complete-Round Role')
  })

  describe('Cancel-Round', () => {
    it('Allows Admin Role')

    it('Allows Cancel-Round Role')
  })
})