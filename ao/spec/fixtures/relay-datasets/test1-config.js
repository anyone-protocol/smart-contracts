export const test1Config = {
  "TokensPerSecond": "40509259200000000",
  "Multipliers": {
    "Family": { "Enabled": true, "Offset": 0.02, "Power": 0.7 },
    "Location": { "Offset": 0.001, "Enabled": true, "Divider": 20, "Power": 1.85 }
  }, 
  "Modifiers": {
    "ExitBonus": { "Share": 0.1, "Enabled": true },
    "Hardware": { "Enabled": true, "Share": 0.2, "UptimeInfluence": 0.35 },
    "Uptime": { "Enabled": true, "Share": 0.14, "Tiers": { "0": 0, "3": 1, "14": 3 } },
    "Network": { "Share": 0.56 }
  }
}