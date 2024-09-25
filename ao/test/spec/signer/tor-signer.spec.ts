import { expect } from 'chai'
import { createData } from 'arbundles'

import {
  EXAMPLE_MASTER_ID_PUBLIC_KEY,
  EXAMPLE_MASTER_ID_SECRET_KEY,
  EXAMPLE_SIGNING_CERT,
  EXAMPLE_SIGNING_SECRET_KEY
} from '~/test/util/setup'

import {
  TorSigner,
  onion_public_key_from_expanded_key
} from '~/src/signer/tor-signer'

describe('TorSigner', () => {
  it('signs & verifies stuff', async () => {
    const certified_key = EXAMPLE_SIGNING_CERT.subarray(39, 71)
    const extData = EXAMPLE_SIGNING_CERT.subarray(76, 108)
    const signature = EXAMPLE_SIGNING_CERT.subarray(108, 172)
    const digest = EXAMPLE_SIGNING_CERT.subarray(
      32,
      EXAMPLE_SIGNING_CERT.length - 64
    )
    const master_id_pk = EXAMPLE_MASTER_ID_PUBLIC_KEY.subarray(32)
    const master_id_sk = EXAMPLE_MASTER_ID_SECRET_KEY.subarray(32)
    const signing_sk = EXAMPLE_SIGNING_SECRET_KEY.subarray(32)
    const signing_pk = onion_public_key_from_expanded_key(
      signing_sk.subarray(0, 32)
    )

    const cert_verified = await TorSigner.verify(extData, digest, signature)
    const signer = new TorSigner(master_id_sk, master_id_pk)
    const tor_signer_signature = await signer.sign(digest)
    const tor_signer_verify = await TorSigner.verify(
      master_id_pk,
      digest,
      signature
    )

    expect(cert_verified).to.be.true
    expect(Buffer.from(signing_pk).toString('hex'))
      .to.equal(certified_key.toString('hex'))
    expect(Buffer.from(tor_signer_signature).toString('hex'))
      .to.equal(signature.toString('hex'))
    expect(tor_signer_verify).to.be.true
  })

  it('creates data items', async () => {
    const certified_key = EXAMPLE_SIGNING_CERT.subarray(39, 71)
    const signing_sk = EXAMPLE_SIGNING_SECRET_KEY.subarray(32)
    const signing_pk = Buffer.from(
      onion_public_key_from_expanded_key(signing_sk.subarray(0, 32))
    )
    const signer = new TorSigner(signing_sk, signing_pk)
    const obj = { hello: 'world' }
    const dataItem = createData(JSON.stringify(obj), signer)

    await dataItem.sign(signer)

    expect(
      Buffer.from(dataItem.owner, 'base64').toString('hex')
    ).to.equal(certified_key.toString('hex'))

    const isValid = await dataItem.isValid()
    expect(isValid).to.be.true
  })
})
