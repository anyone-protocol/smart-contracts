# Staking Rewards Shares Feature - Manual Test Plan

## Overview

This document provides a manual test plan for QA to verify the Staking Rewards Shares refactor via the Dashboard dapp. The shares feature allows operators to configure a percentage (0% - 100%) of staking rewards that will be allocated to them instead of the hodler.

## Test Environment

- **AO**: Mainnet
- **EVM**: Sepolia Testnet
- **Interface**: Dashboard dapp (staging environment)

---

## Feature Summary

### What's New for Operators
- Operators can now set a "share" percentage (when feature is enabled)
- Share determines how much of the staking reward goes to the operator vs the hodler
- Example: 10% share means operator gets 10% of rewards, hodler gets 90%

### Configuration Bounds (set by contract owner)
- **Min**: Minimum allowed share percentage
- **Max**: Maximum allowed share percentage  
- **Default**: Share assigned to new operators automatically

---

## Test Cases

### Section 1: Operator Share Configuration via Dashboard

#### TC1.1: View current share setting
**Steps:**
1. Connect operator wallet to Dashboard
2. Navigate to operator settings/share configuration section

**Expected:**
- Current share percentage is displayed
- Min/Max allowed range is visible
- Feature enabled/disabled status is shown

#### TC1.2: Set share within allowed range
**Precondition:** Shares feature is enabled, Min=0%, Max=50%

**Steps:**
1. Connect operator wallet to Dashboard
2. Navigate to share configuration
3. Enter a valid share value (e.g., 15%)
4. Submit the transaction
5. Wait for AO confirmation

**Expected:**
- Transaction succeeds
- Dashboard updates to show new share value (15%)
- Share persists on page refresh

#### TC1.3: Attempt to set share below minimum
**Precondition:** Min=5%

**Steps:**
1. Connect operator wallet
2. Try to set share to 2%

**Expected:**
- Dashboard should prevent submission OR
- Transaction fails with error message about minimum

#### TC1.4: Attempt to set share above maximum
**Precondition:** Max=50%

**Steps:**
1. Connect operator wallet
2. Try to set share to 75%

**Expected:**
- Dashboard should prevent submission OR
- Transaction fails with error message about maximum

#### TC1.5: Update existing share
**Steps:**
1. Operator with existing share of 10%
2. Change share to 20%
3. Submit transaction

**Expected:**
- Transaction succeeds
- New share value (20%) displayed
- Previous value replaced

#### TC1.6: Set share when feature is disabled
**Precondition:** Shares feature is disabled

**Steps:**
1. Connect operator wallet
2. Attempt to access share configuration

**Expected:**
- Dashboard shows feature is disabled OR
- Transaction fails with "Shares feature is disabled" error

---

### Section 2: Reward Distribution Verification

#### TC2.1: Verify reward split in Dashboard
**Precondition:** Operator has share set to 10%

**Steps:**
1. Wait for a staking round to complete
2. View reward details in Dashboard for a hodler staking with this operator

**Expected:**
- Reward breakdown shows:
  - Hodler reward: 90% of total
  - Operator reward: 10% of total
- Total adds up correctly

#### TC2.2: Zero share - all rewards to hodler
**Precondition:** Operator has share set to 0%

**Steps:**
1. Complete a staking round
2. Check reward distribution

**Expected:**
- Hodler receives 100% of reward
- Operator reward shows 0

#### TC2.3: New operator gets default share
**Precondition:** Default share is configured to 10%

**Steps:**
1. Register a new operator (first time appearing in scores)
2. Complete a round
3. Check the operator's share in Dashboard

**Expected:**
- New operator automatically has 10% share
- Reward split reflects default share

#### TC2.4: Share persists across multiple rounds
**Steps:**
1. Operator sets share to 15%
2. Complete round 1 - verify 15% split
3. Complete round 2 - verify 15% split
4. Complete round 3 - verify 15% split

**Expected:**
- Share remains 15% across all rounds
- No drift or reset of share value

---

### Section 3: Dashboard UI/UX

#### TC3.1: Share input validation
**Steps:**
1. Try entering various invalid inputs:
   - Negative number (-5%)
   - Over 100% (150%)
   - Non-numeric text ("abc")
   - Empty value

**Expected:**
- Dashboard validates input
- Clear error messages shown
- Invalid submissions prevented

#### TC3.2: Share display formatting
**Steps:**
1. Set share to various values (0%, 5.5%, 10%, 100%)
2. View how share is displayed

**Expected:**
- Consistent percentage formatting
- Decimal places handled appropriately

#### TC3.3: Transaction feedback
**Steps:**
1. Submit a share update
2. Observe UI during transaction

**Expected:**
- Loading/pending state shown
- Success confirmation displayed
- Error message shown if failed

---

### Section 4: Edge Cases

#### TC4.1: Boundary value - minimum (0%)
**Precondition:** Min=0%

**Steps:**
1. Set share to exactly 0%
2. Complete a round

**Expected:**
- Valid, transaction succeeds
- All rewards go to hodler

#### TC4.2: Boundary value - maximum (if 100% allowed)
**Precondition:** Max=100%

**Steps:**
1. Set share to exactly 100%
2. Complete a round

**Expected:**
- Valid, transaction succeeds
- All rewards go to operator

#### TC4.3: Multiple operators with different shares
**Steps:**
1. Operator A: 5% share
2. Operator B: 20% share
3. Operator C: 0% share
4. Hodler stakes with all three
5. Complete a round

**Expected:**
- Each operator's rewards calculated independently
- Hodler gets different amounts from each based on operator's share

#### TC4.4: Share change mid-round
**Steps:**
1. Operator has 10% share
2. Round starts (scores added)
3. Operator changes share to 25%
4. Round completes

**Expected:**
- Round uses share value that was set when scores were added (10%)
- New share (25%) applies to next round

---

### Section 5: Wallet Connection Scenarios

#### TC5.1: Correct operator address used
**Steps:**
1. Connect wallet with operator address
2. Set share
3. Verify share is stored against correct address

**Expected:**
- Share associated with connected wallet address
- Lowercase address normalization applied

#### TC5.2: Non-operator wallet
**Steps:**
1. Connect a wallet that is not a registered operator
2. Navigate to share configuration

**Expected:**
- Dashboard handles gracefully
- May show "not an operator" message or allow setting for future use

---

## Checklist Summary

- [ ] Operators can view their current share in Dashboard
- [ ] Operators can set share within allowed bounds
- [ ] Share below min is rejected
- [ ] Share above max is rejected
- [ ] Set-Share blocked when feature disabled
- [ ] Reward split displays correctly (hodler vs operator)
- [ ] Zero share = all rewards to hodler
- [ ] New operators get default share automatically
- [ ] Share persists across rounds
- [ ] Dashboard input validation works
- [ ] Transaction feedback is clear
- [ ] Boundary values (0%, max%) work correctly

---

## Notes

- Shares feature must be enabled by contract owner before operators can set shares
- Share values are stored as decimals (0.0 - 1.0) but displayed as percentages in Dashboard
- Changes to share take effect on the next round after the change is confirmed
