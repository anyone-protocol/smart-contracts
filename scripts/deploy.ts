import { ethers } from 'hardhat'

async function main () {
  const contract = 'RelayRegistry'
  const Contract = await ethers.getContractFactory(contract)
  console.log(`Deploying ${contract} contract`)
  const deployed = await Contract.deploy('0x8626f6940E2eb28930eFb4CeF49B2d1F2C9C1199')
  await deployed.deployed()
  console.log(`${contract} contract deployed to ${deployed.address}`)
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error)
    process.exit(1)
  })
