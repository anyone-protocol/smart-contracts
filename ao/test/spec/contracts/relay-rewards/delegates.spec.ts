// ** Delegates configuration validation
// During configuration update
//     Delegates must be of table type
//     For each delegate:
//         Operator address must be valid EVM address
//         Delegated address must be valid EVM address
//         Share must be number between 0 and 1 inclusive
// During Set Delegate Operation
//     Input address format must be valid EVM address
//     Input share value must be a number between 0 and 1 inclusive
//     When delegate address provided store delegate config
//     When delegate address not provided remove delegate config