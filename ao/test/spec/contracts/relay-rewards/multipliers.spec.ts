import { expect } from 'chai'

import {
  AOTestHandle,
  createLoader,
  OWNER_ADDRESS
} from '~/test/util/setup'

describe('Update-Configuration Multipliers of relay rewards', () => {
  let handle: AOTestHandle

  beforeEach(async () => {
    handle = (await createLoader('relay-rewards')).handle
  })

  it('Family Enabled must be boolean', async () => {
    const stringFamilyResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Update-Configuration' }
      ],
      Data: JSON.stringify({ 
        Multipliers: {
            Family: {
                Enabled: 'asd'
            }
        }
      })
    })
    expect(stringFamilyResult.Error).to.be.a('string').that.includes('Multipliers.Family.Enabled')

    const numberFamilyResult = await handle({
        From: OWNER_ADDRESS,
        Tags: [
            { name: 'Action', value: 'Update-Configuration' }
        ],
        Data: JSON.stringify({ 
            Multipliers: {
                Family: {
                  Enabled: 1
              }
          }
        })
      })
      expect(numberFamilyResult.Error).to.be.a('string').that.includes('Multipliers.Family.Enabled')
  })

  it('Family Offset must be number between 0 and 1 inclusive', async () => {
    const stringFamOffsetResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Update-Configuration' }
      ],
      Data: JSON.stringify({
        Multipliers: {
            Family: {
                Enabled: true,
                Offset: 'abc'
            }
        }
      })
    })
    expect(stringFamOffsetResult.Error).to.be.a('string').that.includes('Multipliers.Family.Offset')
    const boolFamOffsetResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Update-Configuration' }
      ],
      Data: JSON.stringify({
        Multipliers: {
            Family: {
                Enabled: true,
                Offset: true
            }
        }
      })
    })
    expect(boolFamOffsetResult.Error).to.be.a('string').that.includes('Multipliers.Family.Offset')
    const maxFamOffsetResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Update-Configuration' }
      ],
      Data: JSON.stringify({
        Multipliers: {
            Family: {
                Enabled: true,
                Offset: 2
            }
        }
      })
    })
    expect(maxFamOffsetResult.Error).to.be.a('string').that.includes('Multipliers.Family.Offset has to be <= 1')
    const minFamOffsetResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Update-Configuration' }
      ],
      Data: JSON.stringify({
        Multipliers: {
            Family: {
                Enabled: true,
                Offset: -2
            }
        }
      })
    })
    expect(minFamOffsetResult.Error).to.be.a('string').that.includes('Multipliers.Family.Offset has to be >= 0')
  })

  it('Family Power must be number >= 0', async () => {
    const stringFamPowerResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Update-Configuration' }
      ],
      Data: JSON.stringify({
        Multipliers: {
            Family: {
                Enabled: true,
                Offset: 0.001,
                Power: 'abc'
            }
        }
      })
    })
    expect(stringFamPowerResult.Error).to.be.a('string').that.includes('Multipliers.Family.Power')
    const boolFamPowerResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Update-Configuration' }
      ],
      Data: JSON.stringify({
        Multipliers: {
            Family: {
                Enabled: true,
                Offset: 0.001,
                Power: true
            }
        }
      })
    })
    expect(boolFamPowerResult.Error).to.be.a('string').that.includes('Multipliers.Family.Power')
    const minFamPowerResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Update-Configuration' }
      ],
      Data: JSON.stringify({
        Multipliers: {
            Family: {
                Enabled: true,
                Offset: 0.001,
                Power: -1
            }
        }
      })
    })
    expect(minFamPowerResult.Error).to.be.a('string').that.includes('Multipliers.Family.Power has to be >= 0')
  })


  it('Location Enabled must be boolean', async () => {
    const stringLocationResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Update-Configuration' }
      ],
      Data: JSON.stringify({ 
        Multipliers: {
            Location: {
                Enabled: 'asd'
            }
        }
      })
    })
    expect(stringLocationResult.Error).to.be.a('string').that.includes('Multipliers.Location.Enabled')

    const numberLocationResult = await handle({
        From: OWNER_ADDRESS,
        Tags: [
            { name: 'Action', value: 'Update-Configuration' }
        ],
        Data: JSON.stringify({ 
            Multipliers: {
                Location: {
                  Enabled: 1
              }
          }
        })
      })
      expect(numberLocationResult.Error).to.be.a('string').that.includes('Multipliers.Location.Enabled')
  })

  it('Location Offset must be number between 0 and 1 inclusive', async () => {
    const stringLocationOffsetResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Update-Configuration' }
      ],
      Data: JSON.stringify({
        Multipliers: {
            Location: {
                Enabled: true,
                Offset: 'abc'
            }
        }
      })
    })
    expect(stringLocationOffsetResult.Error).to.be.a('string').that.includes('Multipliers.Location.Offset')
    const boolLocationOffsetResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Update-Configuration' }
      ],
      Data: JSON.stringify({
        Multipliers: {
            Location: {
                Enabled: true,
                Offset: true
            }
        }
      })
    })
    expect(boolLocationOffsetResult.Error).to.be.a('string').that.includes('Multipliers.Location.Offset')
    const maxLocationOffsetResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Update-Configuration' }
      ],
      Data: JSON.stringify({
        Multipliers: {
            Location: {
                Enabled: true,
                Offset: 2
            }
        }
      })
    })
    expect(maxLocationOffsetResult.Error).to.be.a('string').that.includes('Multipliers.Location.Offset has to be <= 1')
    const minLocationOffsetResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Update-Configuration' }
      ],
      Data: JSON.stringify({
        Multipliers: {
            Location: {
                Enabled: true,
                Offset: -2
            }
        }
      })
    })
    expect(minLocationOffsetResult.Error).to.be.a('string').that.includes('Multipliers.Location.Offset has to be >= 0')
  })

  it('Location Power must be number >= 0', async () => {
    const stringLocationPowerResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Update-Configuration' }
      ],
      Data: JSON.stringify({
        Multipliers: {
            Location: {
                Enabled: true,
                Offset: 0.001,
                Power: 'abc'
            }
        }
      })
    })
    expect(stringLocationPowerResult.Error).to.be.a('string').that.includes('Multipliers.Location.Power')
    const boolLocationPowerResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Update-Configuration' }
      ],
      Data: JSON.stringify({
        Multipliers: {
            Location: {
                Enabled: true,
                Offset: 0.001,
                Power: true
            }
        }
      })
    })
    expect(boolLocationPowerResult.Error).to.be.a('string').that.includes('Multipliers.Location.Power')
    const minLocationPowerResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Update-Configuration' }
      ],
      Data: JSON.stringify({
        Multipliers: {
            Location: {
                Enabled: true,
                Offset: 0.001,
                Power: -1
            }
        }
      })
    })
    expect(minLocationPowerResult.Error).to.be.a('string').that.includes('Multipliers.Location.Power has to be >= 0')
  })


})