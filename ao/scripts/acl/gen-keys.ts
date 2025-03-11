import Arweave from 'arweave'

import { logger } from '../util/logger'

const arweave = Arweave.init({
  host: 'arweave.net',
  port: 443,
  protocol: 'https'
})

async function genKeys(numberOfKeys: string = '10') {
  const n = parseInt(numberOfKeys)
  if (isNaN(n)) {
    throw new Error(
      'Invalid number of keys.  NUMBER_OF_KEYS_TO_GENERATE must be a number (default: 10).'
    )
  }
  logger.info(`Generating ${n} keys...`)

  const keys: any = {}
  for (let i = 0; i < n; i++) {
    const jwk = await Arweave.crypto.generateJWK()
    const address = await arweave.wallets.jwkToAddress(jwk)
    logger.info(`Generated key ${i}: ${address}`)
    
    keys[`worker_${i}_address`] = address
    keys[`worker_${i}_b64jwk`] = Buffer.from(JSON.stringify(jwk)).toString('base64')
  }

  logger.info(`Generated ${n} keys.`)
  console.log(JSON.stringify(keys, null, 2))
}

genKeys(process.env.NUMBER_OF_KEYS_TO_GENERATE)
  .catch(e => { logger.error(e); process.exit(1); })
