import dotenv from 'dotenv'

import { logger } from './util/logger'

dotenv.config()

const HYPERBEAM_NODE = process.env.HYPERBEAM_NODE

const metaInfoPath = '/~meta@1.0/info'

export async function getHyperbeamMeta() {
  logger.info(`Getting hyperbeam meta from ${HYPERBEAM_NODE}${metaInfoPath}`)
  const getResponse = await fetch(`${HYPERBEAM_NODE}${metaInfoPath}`)
  logger.info(`Response: ${getResponse.status} ${getResponse.statusText}`)
  logger.info(
    `Response body: ${await getResponse.text()}`
  )
}

getHyperbeamMeta().then().catch(err => logger.error(err.stack))
