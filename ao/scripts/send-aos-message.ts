import {
  createDataItemSigner,
  message as aoMessage,
  result as aoResult
} from '@permaweb/aoconnect'
import { createData, Signer } from 'arbundles'

export type SendAosMessageOptions = {
  processId: string
  data?: string
  tags?: { name: string, value: string }[]
  signer: ReturnType<typeof createDataItemSigner>
}

export async function createEthereumDataItemSigner(signer: Signer) {
  return (
    { data, tags, target, anchor }: {
      data: string | Uint8Array,
      tags: any[],
      target?: string,
      anchor?: string
    }
  ) => {
    const dataItem = createData(data, signer, { tags, target, anchor })

    return dataItem.sign(signer).then(async () => ({
      id: await dataItem.id,
      raw: await dataItem.getRaw()
    }))
  }
}

export async function sendAosMessage(
  { processId, data, tags, signer }: SendAosMessageOptions,
  retries = 3
) {
  let attempts = 0
  let lastError: Error | undefined

  while (attempts < retries) {
    try {
      console.debug(`Sending AO Message to process ${processId}`)
      const messageId = await aoMessage({
        process: processId,
        tags,
        data,
        signer
      })
  
      console.debug(
        `Fetching AO Message result ${messageId} from process ${processId}`
      )
      const result = await aoResult({
        message: messageId,
        process: processId
      })
      console.debug(`Got AO Message result ${messageId} from process ${processId}`)
      console.dir(result, { depth: null })

      return { messageId, result }
    } catch (error) {
      console.error(
        `Error sending AO Message to process ${processId}`,
        error
      )

      if (error.message.includes('500')) {
        console.debug(
          `Retrying sending AO message to process ${processId}`,
          JSON.stringify(
            { attempts, retries, error: error.message },
            undefined,
            2
          )
        )

        // NB: Sleep between each attempt with exponential backoff
        await new Promise(
          resolve => setTimeout(resolve, 2 ** attempts * 2000)
        )

        attempts++
        lastError = error
      } else throw error
    }
  }

  throw lastError
}
