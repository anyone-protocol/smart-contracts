// ** Add-Scores Request Handler
// Only owner can send messages
// Message must contain Data field
// Data must be valid JSON
// Timestamp Validation
//     Must be an integer
//     Must be greater than 0
//     Must be greater than previous round's timestamp
// Scores Validation
//     Must be a table/array
//     Each score entry must have:
//         Fingerprint has valid format
//         Fingerprint score was not set during the round
//         Address Must be valid EVM address format
//         Network score must be integer and >= 0
//         IsHardware must be boolean
//         UptimeStreak must be integer and >= 0
//         ExitBonus must be boolean
//         FamilySize must be integer and >= 0
//         LocationSize must be integer and >= 0
// Scores Storage
//     Should create a new PendingRound if timestamp not exists
//     Should store score data for each fingerprint in PendingRounds state