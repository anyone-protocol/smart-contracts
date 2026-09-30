import Arlocal from 'arlocal'
import Arweave from 'arweave'
import axios from 'axios'

import TestWeaveJWK from './test-keys/testweave-keyfile.json'

(async () => {
  const showLogs = false
  const persist = false
  const arlocal = new Arlocal(1984, showLogs, '.db', persist)
  const arweave = new Arweave({
    protocol: 'http', host: 'localhost', port: 1984
  })

  const testweave = await arweave.wallets.getAddress(TestWeaveJWK)

  await arlocal.start()

  await axios.get(`http://localhost:1984/mint/${testweave}/99999999999999`)
  
  process.on('SIGINT', async () => { await arlocal.stop() })
  process.on('SIGTERM', async () => { await arlocal.stop() })
})()
