import { Wallet } from 'ethers'

async function main() {
  const privateKeyHex = 'ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'
  const wallet = new Wallet(privateKeyHex)
  const address = await wallet.getAddress()
  console.log('Address', address)
}

main().then().catch(err => console.error(err))
