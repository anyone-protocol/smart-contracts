import { expect } from 'chai'
import { test1Scores as scores } from './test1-scores.js'
import { test1Config as config } from './test1-config.js'

import {
  AOTestHandle,
  createLoader,
  OWNER_ADDRESS
} from '~/test/util/setup'
import { testData } from './view-init-state-test-data.js'

describe('relay-rewards-view-init-state', () => {
  let handle: AOTestHandle

  const specInit = {
    "PreviousRound": { "Period": 3600, "Timestamp": 1741948079386 },
    "Configuration": {
      "TokensPerSecond": "40509259200000000",
      "Multipliers": {
        "Family": { "Enabled": true, "Offset": 0.02, "Power": 0.7 },
        "Location": {
          "Offset": 0.001,
          "Enabled": true,
          "Divider": 20,
          "Power": 1.85
        }
      },
      "Modifiers": {
        "ExitBonus": { "Share": 0.1, "Enabled": true },
        "Hardware": { "Enabled": true, "Share": 0.2, "UptimeInfluence": 0.35 },
        "Uptime": {
          "Enabled": true,
          "Share": 0.14,
          "Tiers": { "0": 0, "3": 1, "14": 3 }
        },
        "Network": { "Share": 0.56 }
      }
    },
    "TotalFingerprintReward": {
      "9DCE2E73FC950AC0DD85A2614EF5F00F282401C6": "830055776974343241",
      "ABEC4F5FA4895FB77F4C0A9059D8174E050B9BBA": "2297212781963434939",
      "F52CA3CDDAEC905D2E6990B0B360F806DB59DA47": "11722828725171727047",
      "59E36B707147CD59FBF9930D187DCDDEB4AD20A2": "388463949103352195",
      "438089BDA922294AC19520A56F96379908777BB5": "46721406387021560357",
      "CD20E11505272E43E09DB466FAE5C6441F8D1CBD": "11691864665962394141",
      "A6B11EA5869B1B3739C45A14FAD556FDEE27F322": "1871735693086640027",
      "1FB00400CD0E2C8800A119F8C3AC7F28F706AE70": "33182720496911801296",
      "7D693A06CABA96D745196B39E637E827A93890FF": "2208730951654556152",
      "3E44C3A83DCC7E14A2002C65863FF84631C44F17": "3644330753531429946"
    },
    "TotalAddressReward": {
      "0xAD44FD9EF2F27F8D8133AD2C579EF3EEEFEB76CB": "43105548995409966667",
      "0xF058F64D2B74C7DF161C237E81356E57328B3813": "426289041170755537361",
      "0xAB8F493E39B9288DE834059C26428EB25C5AE325": "970102674393447307014",
      "0x13C4A32471B1865234C135B5F0C4355DB8C88C1E": "659248036235349016311",
      "0x1BF4D23AE938A2CEB343FA1507D77452B441C6E5": "479811718243165158381",
      "0x7C62F3B9A9501803A4241570626C9008F08FC543": "213350898431721858763",
      "0x2B75B8223FE26622A4540CED3A49EFDE53AE4E6C": "417990877231594478341",
      "0xE2C5A3168B4A877FCE42BE91A9F42D1AC571CF32": "2208730951654556152",
      "0xF411E412A80F373A67A40749DFF62D53DCBA45D9": "606092987519126062372",
      "0x68EAD76BCAC4E0F558312EA8FB1B884091D008E3": "40071342305560394463"
    }
}

  beforeEach(async () => {
    handle = (await createLoader('relay-rewards')).handle
  })

  it('works with the reference init data', async() => {
    const initStateResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Init' }
      ],
      Data: JSON.stringify(specInit)
    })
    expect(initStateResult.Messages).to.have.lengthOf(2)
    expect(initStateResult.Messages[0].Tags).to.deep.include({
      name: 'device',
      value: 'patch@1.0'
    })
    expect(initStateResult.Messages[0].Tags).to.deep.include({
      name: 'relay_rewards_initialized',
      value: true
    })
    expect(initStateResult.Messages[0].Tags).to.deep.include({
      name: 'claimed',
      value: []
    })
    expect(initStateResult.Messages[0].Tags).to.deep.include({
      name: 'total_address_reward',
      value: specInit.TotalAddressReward
    })
    expect(initStateResult.Messages[0].Tags).to.deep.include({
      name: 'total_fingerprint_reward',
      value: specInit.TotalFingerprintReward
    })
    expect(initStateResult.Messages[0].Tags).to.deep.include({
      name: 'previous_round',
      value: {
        ...specInit.PreviousRound,
        'Configuration': [],
        'Summary': {
          'Ratings': {
            'Network': '0',
            'Uptime': '0',
            'ExitBonus': '0'
          },
          'Rewards': {
            'Total': '0',
            'ExitBonus': '0',
            'Hardware': '0',
            'Uptime': '0',
            'Network': '0'
          }
        },
        'Details': []
      }
    })
    expect(initStateResult.Messages[0].Tags).to.deep.include({
      name: 'configuration',
      value: {
        ...specInit.Configuration,
        'Delegates': []
      }
    })
    expect(initStateResult.Messages[1].Data).to.equal('OK')

    const checkStateResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'View-State' }
      ],
      Data: JSON.stringify(specInit)
    })
    expect(checkStateResult.Messages).to.have.lengthOf(1)
    const state2 = checkStateResult.Messages[0].Data
    const s = specInit
    const s2 = JSON.parse(state2)
    expect(s.PreviousRound.Period).to.be.equal(s2.PreviousRound.Period)
    expect(s.PreviousRound.Timestamp).to.be.equal(s2.PreviousRound.Timestamp)
    expect(s.Configuration.TokensPerSecond).to.be.equal(s2.Configuration.TokensPerSecond)
  })

  it('works with the test init data', async() => {
    const initStateResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Init' }
      ],
      Data: JSON.stringify(testData)
    })
    expect(initStateResult.Messages).to.have.lengthOf(2)
    expect(initStateResult.Messages[0].Tags).to.deep.include({ name: 'device', value: 'patch@1.0' })
    expect(initStateResult.Messages[0].Tags).to.deep.include({ name: 'relay_rewards_initialized', value: true })
    expect(initStateResult.Messages[0].Tags).to.deep.include({ name: 'claimed', value: [] })
    expect(initStateResult.Messages[0].Tags).to.deep.include({ name: 'total_address_reward', value: testData.TotalAddressReward })
    expect(initStateResult.Messages[0].Tags).to.deep.include({ name: 'total_fingerprint_reward', value: testData.TotalFingerprintReward })
    expect(initStateResult.Messages[0].Tags).to.deep.include({
      name: 'previous_round',
      value: {
        ...testData.PreviousRound,
        'Configuration': [],
        'Summary': {
          'Ratings': {
            'Network': '0',
            'Uptime': '0',
            'ExitBonus': '0'
          },
          'Rewards': {
            'Total': '0',
            'ExitBonus': '0',
            'Hardware': '0',
            'Uptime': '0',
            'Network': '0'
          }
        },
        'Details': []
      }
    })
    expect(initStateResult.Messages[0].Tags).to.deep.include({
      name: 'configuration',
      value: {
        ...testData.Configuration,
        'Delegates': []
      }
    })
    expect(initStateResult.Messages[1].Data).to.equal('OK')

    const checkStateResult = await handle({
      Tags: [
          { name: 'Action', value: 'View-State' }
      ],
      Data: ''
    })
    expect(checkStateResult.Messages).to.have.lengthOf(1)
    const state2 = checkStateResult.Messages[0].Data
    const s = testData
    const s2 = JSON.parse(state2)
    expect(s.PreviousRound.Period).to.be.equal(s2.PreviousRound.Period)
    expect(s.PreviousRound.Timestamp).to.be.equal(s2.PreviousRound.Timestamp)
    expect(s.Configuration.TokensPerSecond).to.be.equal(s2.Configuration.TokensPerSecond)
  })

  it('allows for reimport of the state during init', async () => {
    const firstScoresResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Add-Scores' },
          { name: 'Round-Timestamp', value: '1741829169954' }
      ],
      Data: JSON.stringify(scores)
    })
    expect(firstScoresResult.Messages).to.have.lengthOf(1)
    expect(firstScoresResult.Messages[0].Data).to.equal('OK')

    const firstCompleteResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Complete-Round' },
          { name: 'Round-Timestamp', value: '1741829169954' }
      ]
    })
    expect(firstCompleteResult.Messages).to.have.lengthOf(2)
    expect(firstCompleteResult.Messages[0].Tags).to.deep.include({
      name: 'device',
      value: 'patch@1.0'
    })
    expect(firstCompleteResult.Messages[1].Data).to.equal('OK')

    const configResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
        { name: 'Action', value: 'Update-Configuration' }
      ],
      Data: JSON.stringify(config)
    })
    expect(configResult.Messages).to.have.lengthOf(2)
    expect(configResult.Messages[1].Data).to.equal('OK')
    expect(configResult.Messages[0].Tags).to.deep.include({
      name: 'device',
      value: 'patch@1.0'
    })

    const secondScoresResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Add-Scores' },
          { name: 'Round-Timestamp', value: '1741829269954' }
      ],
      Data: JSON.stringify(scores)
    })
    expect(secondScoresResult.Messages).to.have.lengthOf(1)
    expect(secondScoresResult.Messages[0].Data).to.equal('OK')

    const secondCompleteResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Complete-Round' },
          { name: 'Round-Timestamp', value: '1741829269954' }
      ]
    })
    expect(secondCompleteResult.Messages).to.have.lengthOf(2)
    expect(secondCompleteResult.Messages[0].Tags).to.deep.include({
      name: 'device',
      value: 'patch@1.0'
    })
    expect(secondCompleteResult.Messages[1].Data).to.equal('OK')

    const viewStateResult = await handle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'View-State' }
      ]
    })
    expect(viewStateResult.Messages).to.have.lengthOf(1)
    const state = viewStateResult.Messages[0].Data
    const s = JSON.parse(state)
    const newHandle = (await createLoader('relay-rewards')).handle
    const initStateResult = await newHandle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'Init' }
      ],
      Data: state
    })
    expect(initStateResult.Messages).to.have.lengthOf(2)
    expect(initStateResult.Messages[0].Tags).to.deep.include({
      name: 'device',
      value: 'patch@1.0'
    })
    expect(initStateResult.Messages[0].Tags).to.deep.include({
      name: 'relay_rewards_initialized',
      value: true
    })
    expect(initStateResult.Messages[0].Tags).to.deep.include({
      name: 'claimed',
      value: []
    })
    expect(initStateResult.Messages[0].Tags).to.deep.include({
      name: 'previous_round',
      value: {
        Period: s.PreviousRound.Period,
        Timestamp: s.PreviousRound.Timestamp,
        'Configuration': [],
        'Summary': {
          'Ratings': {
            'Network': '0',
            'Uptime': '0',
            'ExitBonus': '0'
          },
          'Rewards': {
            'Total': '0',
            'ExitBonus': '0',
            'Hardware': '0',
            'Uptime': '0',
            'Network': '0'
          }
        },
        'Details': []
      }
    })

    expect(initStateResult.Messages[0].Tags).to.deep.include({
      name: 'configuration',
      value: {
        ...s.Configuration,
        'Delegates': []
      }
    })
    expect(initStateResult.Messages[1].Data).to.equal('OK')

    const viewState2Result = await newHandle({
      From: OWNER_ADDRESS,
      Tags: [
          { name: 'Action', value: 'View-State' }
      ]
    })
    expect(viewState2Result.Messages).to.have.lengthOf(1)
    const state2 = viewState2Result.Messages[0].Data
    const s2 = JSON.parse(state2)
    expect(s.PreviousRound.Period).to.be.equal(s2.PreviousRound.Period)
    expect(s.PreviousRound.Timestamp).to.be.equal(s2.PreviousRound.Timestamp)
    expect(s.Configuration.TokensPerSecond).to.be.equal(s2.Configuration.TokensPerSecond)
  })
})