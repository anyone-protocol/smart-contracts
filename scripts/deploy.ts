import { ethers } from 'hardhat'

async function main () {
  const ATOR = await ethers.getContractFactory('AirTor')
  console.log('Deploying AirTor token contract')
  const ator = await ATOR.deploy()
  await ator.deployed()
  console.log('AirTor token contract deployed to:', ator.address)
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error)
    process.exit(1)
  })
