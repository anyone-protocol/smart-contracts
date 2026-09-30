import axios from 'axios';
import { connect, createSigner } from '@permaweb/aoconnect'
import fs from 'fs'

interface SpawnProcessOptions {
  wasmTxId: string;         // Arweave transaction ID of the uploaded WASM binary
  relayUrl: string;         // URL of your HyperBEAM relay
  initialState?: object;    // Optional initial state for the process
  wallet?: any; // Optional private key for signing the spawn request
  modulePrefix?: string
}

/**
 * Spawns a WASM process on the AO network by POSTing to a HyperBEAM relay
 * 
 * @param options Configuration options for spawning the process
 * @returns The process ID of the newly created process
 */
export async function spawnWasmProcess(options: SpawnProcessOptions): Promise<string> {
  const { wasmTxId, relayUrl, wallet, modulePrefix, initialState = {} } = options;
  
  // Construct the process definition message
  const processDefinition = {
    "Device": "process@1.0",
    "Scheduler-Device": "scheduler@1.0",
    "Execution-Device": "stack@1.0",
    "Execution-Stack": ["scheduler@1.0", "wasm-64@1.0"],
    // "WASM-Image": wasmTxId,
    // Specify the image with the prefix
    [`${modulePrefix}/image`]: wasmTxId,
    "Initial-State": initialState
  };
  
  try {
    console.log('1')
    const signer = createSigner(wallet)
    console.log('2')
    const { request } = connect({
      MODE: 'mainnet', 
      URL: relayUrl,
      signer
    })
    console.log('3')
    const response = await request({
      path: '/~wasm-64@1.0/init',
      method: 'POST',
      data: processDefinition
    })
    console.log('Response Status:', response.status);
    console.log('Response Status Text:', response.statusText);
    const responseData = await response.json()
    console.log('Response Data:', responseData);

    // Send the POST request to spawn the process
    // const response = await axios.post(`${relayUrl}/~wasm64@1.0/init`, processDefinition, {
    //   headers: {
    //     'Content-Type': 'application/json'
    //   }
    // });
    
    // Extract the process ID from the response
    if (responseData && responseData.ProcessId) {
      console.log(`Process successfully spawned with ID: ${responseData.ProcessId}`);
      return responseData.ProcessId;
    } else {
      throw new Error('Failed to extract process ID from response');
    }
  } catch (error) {
    console.error('Error spawning WASM process:', error);
    throw error;
  }
}

async function runSpawnWasmProcess() {
  try {
    const modulePrefix = 'testmodule'
    const WALLET_PATH = 'keys/wallet.json'
    const wallet = JSON.parse(fs.readFileSync(WALLET_PATH, 'utf8'))
    const processId = await spawnWasmProcess({
      wallet,
      modulePrefix,
      wasmTxId: 'uDiBjFLbeI2ETMUMJEyxUzVFwIIUyFnrBj9ypId-kAE',
      relayUrl: 'https://hyperbeam-dev.ec.anyone.tech'
    });
    
    console.log(`Your process is available at: ${processId}~process@1.0/now`);
    
    // You could now interact with this process
    // For example, send a message to it:
    /*
    await axios.post(`https://your-hyperbeam-relay.com/${processId}~process@1.0/schedule`, {
      Action: "YourAction",
      Data: "YourData"
    });
    */
  } catch (error) {
    console.error('Failed in example:', error);
  }
}

// Uncomment to run the example
runSpawnWasmProcess().catch(err => {
  console.error('Error in spawnWasmProcess:', err)
  process.exit(1)
})
