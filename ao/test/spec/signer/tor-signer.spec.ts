import { expect } from 'chai'

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
  it('signs stuff', async () => {
    for (let i = 0; i * 32 < EXAMPLE_SIGNING_CERT.length; i++) {
      const lineStart = i * 32
      const lineEnd = (i + 1) * 32
      console.log(
        EXAMPLE_SIGNING_CERT.subarray(lineStart, lineEnd).toString('hex')
      )
    }

    const header = EXAMPLE_SIGNING_CERT.subarray(0, 32)
    console.log('header', header.toString())

    const version = EXAMPLE_SIGNING_CERT.subarray(32, 33)
    console.log('version', version)

    const cert_type = EXAMPLE_SIGNING_CERT.subarray(33, 34)
    console.log('cert_type', cert_type)

    const expiration_date = EXAMPLE_SIGNING_CERT.readUintBE(34, 4)
    console.log('expiration_date', expiration_date)

    const expiration_date_as_Date = new Date(expiration_date * 60 * 60 * 1000)
    console.log('expiration_date_as_Date', expiration_date_as_Date)

    const cert_key_type = EXAMPLE_SIGNING_CERT.subarray(38, 39)
    console.log('cert_key_type', cert_key_type)

    const certified_key = EXAMPLE_SIGNING_CERT.subarray(39, 71)
    console.log(
      'certified_key (ed25519_signing_public_key)',
      certified_key.toString('hex')
    )

    const n_extensions = EXAMPLE_SIGNING_CERT.subarray(71, 72)
    console.log('n_extensions', n_extensions)

    const extLength = EXAMPLE_SIGNING_CERT.readUintBE(72, 2)
    console.log('extLength', extLength)

    const extType = EXAMPLE_SIGNING_CERT.subarray(74, 75)
    console.log('extType', extType)

    const extFlags = EXAMPLE_SIGNING_CERT.subarray(75, 76)
    console.log('extFlags', extFlags)

    const extData = EXAMPLE_SIGNING_CERT.subarray(76, 108)
    console.log(
      'extData (ed25519_master_id_public_key)',
      extData.toString('hex')
    )

    const signature = EXAMPLE_SIGNING_CERT.subarray(108, 172)
    console.log('signature', signature.toString('hex'))

    const digest = EXAMPLE_SIGNING_CERT.subarray(
      32,
      EXAMPLE_SIGNING_CERT.length - 64
    )
    console.log('digest', digest.toString('hex'))

    const verified = await TorSigner.verify(extData, digest, signature)
    console.log('verified', verified)

    console.log()

    const master_id_pk_header = EXAMPLE_MASTER_ID_PUBLIC_KEY.subarray(0, 32)
    console.log('master_id_pk_header', master_id_pk_header.toString())

    const master_id_pk = EXAMPLE_MASTER_ID_PUBLIC_KEY.subarray(32)
    console.log('master_id_pk', master_id_pk.toString('hex'))

    console.log()

    const master_id_sk_header = EXAMPLE_MASTER_ID_SECRET_KEY.subarray(0 ,32)
    console.log('master_id_sk_header', master_id_sk_header.toString())

    const master_id_sk = EXAMPLE_MASTER_ID_SECRET_KEY.subarray(32)
    console.log('master_id_sk', master_id_sk.toString('hex'))

    console.log()

    const signing_sk_header = EXAMPLE_SIGNING_SECRET_KEY.subarray(0, 32)
    console.log('signing_sk_header', signing_sk_header.toString())

    const signing_sk = EXAMPLE_SIGNING_SECRET_KEY.subarray(32)
    console.log('signing_sk', signing_sk.toString('hex'))

    const signing_sk_secret_key_d = signing_sk.subarray(0, 32)
    console.log(
      'signing_sk_secret_key_d',
      signing_sk_secret_key_d.toString('hex')
    )

    console.log()

    const signing_pk = onion_public_key_from_expanded_key(
      signing_sk.subarray(0, 32)
    )
    console.log('   signing_pk', Buffer.from(signing_pk).toString('hex'))
    console.log('certified_key', certified_key.toString('hex'))

    expect(Buffer.from(signing_pk).toString('hex'))
      .to.equal(certified_key.toString('hex'))

    console.log()

    const signer = new TorSigner(master_id_sk, master_id_pk)

    const tor_signer_signature = await signer.sign(digest)
    console.log(
      ' tor_signer_signature',
      Buffer.from(tor_signer_signature.subarray(0, 32)).toString('hex'),
      Buffer.from(tor_signer_signature.subarray(32)).toString('hex')
    )
    console.log(
      '            signature',
      signature.subarray(0, 32).toString('hex'),
      signature.subarray(32).toString('hex')
    )

    expect(Buffer.from(tor_signer_signature).toString('hex'))
      .to.equal(signature.toString('hex'))

    const tor_signer_verify = await TorSigner.verify(
      master_id_pk,
      digest,
      signature
    )
    console.log('tor_signer_verify', tor_signer_verify)

    const stable_verify = await TorSigner.verify(
      master_id_pk,
      digest,
      signature
    )
    console.log('stable_verify', stable_verify)
  })
})
