import { expect } from 'chai'

import {
  AOTestHandle,
  createLoader,
  OWNER_ADDRESS
} from '~/test/util/setup'

describe('Update-Configuration Modifiers of relay rewards', () => {
  let handle: AOTestHandle

  beforeEach(async () => {
    handle = (await createLoader('relay-rewards')).handle
  })

  it('Network share must be number between 0 and 1 inclusive', async () => {
    const stringNetworkResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Update-Configuration' }
      ],
      Data: JSON.stringify({
        Modifiers: {
            Network: {
                Share: 'abc'
            }
        }
      })
    })
    expect(stringNetworkResult.Error).to.be.a('string').that.includes('Modifiers.Network.Share')
    const boolNetworkResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Update-Configuration' }
      ],
      Data: JSON.stringify({
        Modifiers: {
            Network: {
                Share: true
            }
        }
      })
    })
    expect(boolNetworkResult.Error).to.be.a('string').that.includes('Modifiers.Network.Share')
    const maxNetworkResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Update-Configuration' }
      ],
      Data: JSON.stringify({
        Modifiers: {
            Network: {
                Share: 2
            }
        }
      })
    })
    expect(maxNetworkResult.Error).to.be.a('string').that.includes('Modifiers.Network.Share has to be <= 1')
    const minNetworkResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Update-Configuration' }
      ],
      Data: JSON.stringify({
        Modifiers: {
            Network: {
                Share: -2
            }
        }
      })
    })
    expect(minNetworkResult.Error).to.be.a('string').that.includes('Modifiers.Network.Share has to be >= 0')
  })

  it('Hardware Enabled must be boolean', async () => {
    const stringHardwareResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Update-Configuration' }
      ],
      Data: JSON.stringify({ 
        Modifiers: {
            Hardware: {
                Enabled: 'asd'
            }
        }
      })
    })
    expect(stringHardwareResult.Error).to.be.a('string').that.includes('Modifiers.Hardware.Enabled')

    const numberHardwareResult = await handle({
        From: OWNER_ADDRESS,
        Tags: [
            { name: 'Action', value: 'Update-Configuration' }
        ],
        Data: JSON.stringify({ 
          Modifiers: {
              Hardware: {
                  Enabled: 1
              }
          }
        })
      })
      expect(numberHardwareResult.Error).to.be.a('string').that.includes('Modifiers.Hardware.Enabled')
  })

  it('Hardware Share must be number between 0 and 1 inclusive', async () => {
    const stringHardwareResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Update-Configuration' }
      ],
      Data: JSON.stringify({
        Modifiers: {
            Hardware: {
                Enabled: false,
                Share: 'abc'
            }
        }
      })
    })
    expect(stringHardwareResult.Error).to.be.a('string').that.includes('Modifiers.Hardware.Share')
    const boolHardwareResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Update-Configuration' }
      ],
      Data: JSON.stringify({
        Modifiers: {
            Hardware: {
                Enabled: false,
                Share: true
            }
        }
      })
    })
    expect(boolHardwareResult.Error).to.be.a('string').that.includes('Modifiers.Hardware.Share')
    const maxHardwareResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Update-Configuration' }
      ],
      Data: JSON.stringify({
        Modifiers: {
            Hardware: {
                Enabled: false,
                Share: 2
            }
        }
      })
    })
    expect(maxHardwareResult.Error).to.be.a('string').that.includes('Modifiers.Hardware.Share has to be <= 1')
    const minHardwareResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Update-Configuration' }
      ],
      Data: JSON.stringify({
        Modifiers: {
            Hardware: {
                Enabled: false,
                Share: -2
            }
        }
      })
    })
    expect(minHardwareResult.Error).to.be.a('string').that.includes('Modifiers.Hardware.Share has to be >= 0')
  })
  
  it('UptimeInfluence on Hardware must be number between 0 and 1 inclusive', async () => {
    const stringUptimeInfluenceResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Update-Configuration' }
      ],
      Data: JSON.stringify({
        Modifiers: {
            Hardware: {
                Enabled: false,
                Share: 0.1,
                UptimeInfluence: 'abc'
            }
        }
      })
    })
    expect(stringUptimeInfluenceResult.Error).to.be.a('string').that.includes('Modifiers.Hardware.UptimeInfluence')
    const boolUptimeInfluenceResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Update-Configuration' }
      ],
      Data: JSON.stringify({
        Modifiers: {
            Hardware: {
                Enabled: false,
                Share: 0.1,
                UptimeInfluence: true
            }
        }
      })
    })
    expect(boolUptimeInfluenceResult.Error).to.be.a('string').that.includes('Modifiers.Hardware.UptimeInfluence')
    const maxUptimeInfluenceResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Update-Configuration' }
      ],
      Data: JSON.stringify({
        Modifiers: {
            Hardware: {
                Enabled: false,
                Share: 0.2,
                UptimeInfluence: 2
            }
        }
      })
    })
    expect(maxUptimeInfluenceResult.Error).to.be.a('string').that.includes('Modifiers.Hardware.UptimeInfluence has to be <= 1')
    const minUptimeInfluenceResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Update-Configuration' }
      ],
      Data: JSON.stringify({
        Modifiers: {
            Hardware: {
                Enabled: false,
                Share: 0.1,
                UptimeInfluence: -1
            }
        }
      })
    })
    expect(minUptimeInfluenceResult.Error).to.be.a('string').that.includes('Modifiers.Hardware.UptimeInfluence has to be >= 0')
  })

  it('Uptime Enabled must be boolean', async () => {
    const stringUptimeResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Update-Configuration' }
      ],
      Data: JSON.stringify({ 
        Modifiers: {
            Uptime: {
                Enabled: 'asd'
            }
        }
      })
    })
    expect(stringUptimeResult.Error).to.be.a('string').that.includes('Modifiers.Uptime.Enabled')

    const numberUptimeResult = await handle({
        From: OWNER_ADDRESS,
        Tags: [
            { name: 'Action', value: 'Update-Configuration' }
        ],
        Data: JSON.stringify({ 
          Modifiers: {
              Uptime: {
                  Enabled: 1
              }
          }
        })
      })
      expect(numberUptimeResult.Error).to.be.a('string').that.includes('Modifiers.Uptime.Enabled')
  })

  it('Uptime Share must be number between 0 and 1 inclusive', async () => {
    const stringUptimeResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Update-Configuration' }
      ],
      Data: JSON.stringify({
        Modifiers: {
            Uptime: {
                Enabled: false,
                Share: 'abc'
            }
        }
      })
    })
    expect(stringUptimeResult.Error).to.be.a('string').that.includes('Modifiers.Uptime.Share')
    const boolUptimeResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Update-Configuration' }
      ],
      Data: JSON.stringify({
        Modifiers: {
            Uptime: {
                Enabled: false,
                Share: true
            }
        }
      })
    })
    expect(boolUptimeResult.Error).to.be.a('string').that.includes('Modifiers.Uptime.Share')
    const maxUptimeResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Update-Configuration' }
      ],
      Data: JSON.stringify({
        Modifiers: {
            Uptime: {
                Enabled: false,
                Share: 2
            }
        }
      })
    })
    expect(maxUptimeResult.Error).to.be.a('string').that.includes('Modifiers.Uptime.Share has to be <= 1')
    const minUptimeResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Update-Configuration' }
      ],
      Data: JSON.stringify({
        Modifiers: {
            Uptime: {
                Enabled: false,
                Share: -2
            }
        }
      })
    })
    expect(minUptimeResult.Error).to.be.a('string').that.includes('Modifiers.Uptime.Share has to be >= 0')
  })

  it('Uptime Tiers validation - Must be table type', async () => {
    const boolTierResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Update-Configuration' }
      ],
      Data: JSON.stringify({ 
        Modifiers: {
            Uptime: {
                Enabled: false,
                Share: 0.2,
                Tiers: true
            }
        }
      })
    })
    expect(boolTierResult.Error).to.be.a('string').that.includes('Table type required for Modifiers.Uptime.Tiers')

    const stringTierResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Update-Configuration' }
      ],
      Data: JSON.stringify({ 
        Modifiers: {
            Uptime: {
                Enabled: false,
                Share: 0.2,
                Tiers: 'asd'
            }
        }
      })
    })
    expect(boolTierResult.Error).to.be.a('string').that.includes('Table type required for Modifiers.Uptime.Tiers')
    
    const numberTierResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Update-Configuration' }
      ],
      Data: JSON.stringify({ 
        Modifiers: {
            Uptime: {
                Enabled: false,
                Share: 0.2,
                Tiers: 123
            }
        }
      })
    })
    expect(numberTierResult.Error).to.be.a('string').that.includes('Table type required for Modifiers.Uptime.Tiers')
  })

  it('Uptime Tiers validation - Keys must be integers >= 0', async () => {
    const stringTierKeyResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Update-Configuration' }
      ],
      Data: JSON.stringify({ 
        Modifiers: {
            Uptime: {
                Enabled: false,
                Share: 0.2,
                Tiers: {
                    a: 0
                }
            }
        }
      })
    })
    expect(stringTierKeyResult.Error).to.be.a('string').that.includes('Modifiers.Uptime.Tiers days')
    const negativeTierKeyResult = await handle({
        From: OWNER_ADDRESS,
        Tags: [
            { name: 'Action', value: 'Update-Configuration' }
        ],
        Data: JSON.stringify({ 
          Modifiers: {
              Uptime: {
                  Enabled: false,
                  Share: 0.2,
                  Tiers: {
                      [-10]: 0
                  }
              }
          }
        })
      })
      expect(negativeTierKeyResult.Error).to.be.a('string').that.includes('Modifiers.Uptime.Tiers days')
      const boolTierKeyResult = await handle({
        From: OWNER_ADDRESS,
        Tags: [
            { name: 'Action', value: 'Update-Configuration' }
        ],
        Data: JSON.stringify({ 
          Modifiers: {
              Uptime: {
                  Enabled: false,
                  Share: 0.2,
                  Tiers: {
                      true: 0
                  }
              }
          }
        })
      })
      expect(boolTierKeyResult.Error).to.be.a('string').that.includes('Modifiers.Uptime.Tiers days')
  })

  it('Uptime Tiers validation - Values must be integers >= 0', async () => {
    const stringTierValueResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Update-Configuration' }
      ],
      Data: JSON.stringify({ 
        Modifiers: {
            Uptime: {
                Enabled: false,
                Share: 0.2,
                Tiers: {
                    0: 'a'
                }
            }
        }
      })
    })
    expect(stringTierValueResult.Error).to.be.a('string').that.includes('Modifiers.Uptime.Tiers weight')
    const negativeTierValueResult = await handle({
        From: OWNER_ADDRESS,
        Tags: [
            { name: 'Action', value: 'Update-Configuration' }
        ],
        Data: JSON.stringify({ 
          Modifiers: {
              Uptime: {
                  Enabled: false,
                  Share: 0.2,
                  Tiers: {
                      0: -10
                  }
              }
          }
        })
      })
      expect(negativeTierValueResult.Error).to.be.a('string').that.includes('Modifiers.Uptime.Tiers Value has to be >= 0')
      const boolTierValueResult = await handle({
        From: OWNER_ADDRESS,
        Tags: [
            { name: 'Action', value: 'Update-Configuration' }
        ],
        Data: JSON.stringify({ 
          Modifiers: {
              Uptime: {
                  Enabled: false,
                  Share: 0.2,
                  Tiers: {
                      0: true
                  }
              }
          }
        })
      })
      expect(boolTierValueResult.Error).to.be.a('string').that.includes('Modifiers.Uptime.Tiers weight')
  })


  it('Uptime Tiers validation - Allows for maximum of 42 tiers', async () => {
    const tiers: {[key: string]: number} = {};
    for (let i = 1; i <= 43; i++) {
        tiers[i.toString()] = i;
    }

    const stringTierValueResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Update-Configuration' }
      ],
      Data: JSON.stringify({ 
        Modifiers: {
            Uptime: {
                Enabled: false,
                Share: 0.2,
                Tiers: tiers
            }
        }
      })
    })
    expect(stringTierValueResult.Error).to.be.a('string').that.includes('Too many Modifiers.Uptime.Tiers')
  })

  it('ExitBonus Enabled must be boolean', async () => {
    const stringExitBonusResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Update-Configuration' }
      ],
      Data: JSON.stringify({ 
        Modifiers: {
            ExitBonus: {
                Enabled: 'asd'
            }
        }
      })
    })
    expect(stringExitBonusResult.Error).to.be.a('string').that.includes('Modifiers.ExitBonus.Enabled')

    const numberExitBonusResult = await handle({
        From: OWNER_ADDRESS,
        Tags: [
            { name: 'Action', value: 'Update-Configuration' }
        ],
        Data: JSON.stringify({ 
          Modifiers: {
            ExitBonus: {
                  Enabled: 1
              }
          }
        })
      })
      expect(numberExitBonusResult.Error).to.be.a('string').that.includes('Modifiers.ExitBonus.Enabled')
  })

  it('ExitBonus Share must be number between 0 and 1 inclusive', async () => {
    const stringExitBonusResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Update-Configuration' }
      ],
      Data: JSON.stringify({
        Modifiers: {
            ExitBonus: {
                Enabled: false,
                Share: 'abc'
            }
        }
      })
    })
    expect(stringExitBonusResult.Error).to.be.a('string').that.includes('Modifiers.ExitBonus.Share')
    const boolExitBonusResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Update-Configuration' }
      ],
      Data: JSON.stringify({
        Modifiers: {
            ExitBonus: {
                Enabled: false,
                Share: true
            }
        }
      })
    })
    expect(boolExitBonusResult.Error).to.be.a('string').that.includes('Modifiers.ExitBonus.Share')
    const maxExitBonusResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Update-Configuration' }
      ],
      Data: JSON.stringify({
        Modifiers: {
            ExitBonus: {
                Enabled: false,
                Share: 2
            }
        }
      })
    })
    expect(maxExitBonusResult.Error).to.be.a('string').that.includes('Modifiers.ExitBonus.Share has to be <= 1')
    const minExitBonusResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Update-Configuration' }
      ],
      Data: JSON.stringify({
        Modifiers: {
            ExitBonus: {
                Enabled: false,
                Share: -2
            }
        }
      })
    })
    expect(minExitBonusResult.Error).to.be.a('string').that.includes('Modifiers.ExitBonus.Share has to be >= 0')
  })

  it('Ensures that total sum of shares of enabled modifiers equals 1', async () => {
    const tooLowNetworkResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Update-Configuration' }
      ],
      Data: JSON.stringify({ 
        Modifiers: {
            Network: { Share: 0.4 },
            Hardware: { Enabled: false, Share: 0 },
            Uptime: { Enabled: false, Share: 0 },
            ExitBonus: { Enabled: false, Share: 0 }
        }
      })
    })
    expect(tooLowNetworkResult.Error).to.be.a('string').that.includes('Sum of shares for enabled modifiers has to equal 1')

    const tooLowNetHwResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Update-Configuration' }
      ],
      Data: JSON.stringify({ 
        Modifiers: {
            Network: { Share: 0.6 },
            Hardware: { Enabled: true, Share: 0.3 },
            Uptime: { Enabled: false, Share: 0 },
            ExitBonus: { Enabled: false, Share: 0 }
        }
      })
    })
    expect(tooLowNetHwResult.Error).to.be.a('string').that.includes('Sum of shares for enabled modifiers has to equal 1')
    const tooHighNetHwResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Update-Configuration' }
      ],
      Data: JSON.stringify({ 
        Modifiers: {
            Network: { Share: 0.6 },
            Hardware: { Enabled: true, Share: 0.5 },
            Uptime: { Enabled: false, Share: 0 },
            ExitBonus: { Enabled: false, Share: 0 }
        }
      })
    })
    expect(tooHighNetHwResult.Error).to.be.a('string').that.includes('Sum of shares for enabled modifiers has to equal 1')

    const tooLowNetHwUptResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Update-Configuration' }
      ],
      Data: JSON.stringify({ 
        Modifiers: {
            Network: { Share: 0.4 },
            Hardware: { Enabled: true, Share: 0.3 },
            Uptime: { Enabled: true, Share: 0.2 },
            ExitBonus: { Enabled: false, Share: 0 }
        }
      })
    })
    expect(tooLowNetHwUptResult.Error).to.be.a('string').that.includes('Sum of shares for enabled modifiers has to equal 1')
    const tooHighNetHwUptResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Update-Configuration' }
      ],
      Data: JSON.stringify({ 
        Modifiers: {
            Network: { Share: 0.6 },
            Hardware: { Enabled: true, Share: 0.3 },
            Uptime: { Enabled: true, Share: 0.2 },
            ExitBonus: { Enabled: false, Share: 0 }
        }
      })
    })
    expect(tooHighNetHwUptResult.Error).to.be.a('string').that.includes('Sum of shares for enabled modifiers has to equal 1')

    const tooLowNetHwUptExtResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Update-Configuration' }
      ],
      Data: JSON.stringify({ 
        Modifiers: {
            Network: { Share: 0.4 },
            Hardware: { Enabled: true, Share: 0.3 },
            Uptime: { Enabled: true, Share: 0.2 },
            ExitBonus: { Enabled: true, Share: 0.05 }
        }
      })
    })
    expect(tooLowNetHwUptExtResult.Error).to.be.a('string').that.includes('Sum of shares for enabled modifiers has to equal 1')
    const tooHighNetHwUptExtResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Update-Configuration' }
      ],
      Data: JSON.stringify({ 
        Modifiers: {
            Network: { Share: 0.4 },
            Hardware: { Enabled: true, Share: 0.3 },
            Uptime: { Enabled: true, Share: 0.2 },
            ExitBonus: { Enabled: true, Share: 0.2 }
        }
      })
    })
    expect(tooHighNetHwUptExtResult.Error).to.be.a('string').that.includes('Sum of shares for enabled modifiers has to equal 1')
    const onlyEnabledResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Update-Configuration' }
      ],
      Data: JSON.stringify({ 
        Modifiers: {
            Network: { Share: 1 },
            Hardware: { Enabled: false, Share: 0.3 },
            Uptime: { Enabled: false, Share: 0.2 },
            ExitBonus: { Enabled: false, Share: 0.2 }
        }
      })
    })
    
    expect(onlyEnabledResult.Messages).to.have.lengthOf(1)
    expect(onlyEnabledResult.Messages[0].Data).to.equal('OK')
  })
})