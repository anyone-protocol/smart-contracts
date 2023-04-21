import { expect } from 'chai'
import { BigNumber } from 'ethers'
import hardhat from 'hardhat'

describe('ATOR (NO DEX) Token Contract', () => {
  it('Deploys', async () => {
    const ATOR = await hardhat.ethers.getContractFactory('ATORNODEX')
    const ator = await ATOR.deploy()
    const totalSupply: BigNumber = await ator.totalSupply()

    expect(totalSupply.toString()).to.equal('100000000000000000000000000')
  })
})
