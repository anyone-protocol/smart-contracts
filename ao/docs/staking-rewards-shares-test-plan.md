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
- Operators can now set a "share" percentage (when feature is enabled AND operator setting is enabled)
- Share determines how much of the staking reward goes to the operator vs the hodler
- Example: 10% share means operator gets 10% of rewards, hodler gets 90%
- When operator share setting is disabled by admin, all operators use the configured default share

### Configuration Bounds (set by contract owner)
- **Min**: Minimum allowed share percentage
- **Max**: Maximum allowed share percentage  
- **Default**: Share used for all operators when "Set Shares" is disabled, or for operators who haven't set their own share
- **SetSharesEnabled**: Whether operators can set their own custom share (if false, everyone uses Default)

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

#### TC1.7: Set share when operator setting is disabled
**Precondition:** Shares feature is enabled, but "Set Shares" toggle is disabled

**Steps:**
1. Connect operator wallet
2. Attempt to set a custom share

**Expected:**
- Dashboard shows operator share setting is disabled OR
- Transaction fails with "Operator share setting is disabled" error
- Dashboard may show that all operators are using the default share

---

### Section 2: Operator Setting Disabled Behavior

#### TC2.1: All operators use default share when SetSharesEnabled is off
**Precondition:** 
- Shares feature enabled
- SetSharesEnabled is OFF
- Default share is 10%
- Operator A previously set share to 25%

**Steps:**
1. Wait for a staking round to complete
2. Check reward distribution for Operator A

**Expected:**
- Operator A's reward is calculated using 10% (default), NOT 25%
- All operators receive the same share percentage

#### TC2.2: Operator share resumes when SetSharesEnabled is re-enabled
**Precondition:**
- Operator had set share to 25%
- SetSharesEnabled was toggled OFF, then back ON

**Steps:**
1. Verify SetSharesEnabled is now ON
2. Wait for a staking round to complete
3. Check reward distribution

**Expected:**
- Operator's custom share (25%) is used again
- Previous share setting was preserved

#### TC2.3: New operators use default share
**Precondition:** 
- Shares feature enabled
- SetSharesEnabled is ON
- Default share is 15%
- Operator has NOT set a custom share

**Steps:**
1. Complete a staking round with a new operator
2. Check the share used for that operator

**Expected:**
- New operator's rewards calculated using default share (15%)
- Operator can then set a custom share if desired

---

### Section 3: Reward Distribution Verification

#### TC3.1: Verify reward split in Dashboard
**Precondition:** Operator has share set to 10%

**Steps:**
1. Wait for a staking round to complete
2. View reward details in Dashboard for a hodler staking with this operator

**Expected:**
- Reward breakdown shows:
  - Hodler reward: 90% of total
  - Operator reward: 10% of total
- Total adds up correctly

#### TC3.2: Zero share - all rewards to hodler
**Precondition:** Operator has share set to 0%

**Steps:**
1. Complete a staking round
2. Check reward distribution

**Expected:**
- Hodler receives 100% of reward
- Operator reward shows 0

#### TC3.3: Share persists across multiple rounds
**Steps:**
1. Operator sets share to 15%
2. Complete round 1 - verify 15% split
3. Complete round 2 - verify 15% split
4. Complete round 3 - verify 15% split

**Expected:**
- Share remains 15% across all rounds
- No drift or reset of share value

---

### Section 4: Dashboard UI/UX

#### TC4.1: Share input validation
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

#### TC4.2: Share display formatting
**Steps:**
1. Set share to various values (0%, 5.5%, 10%, 100%)
2. View how share is displayed

**Expected:**
- Consistent percentage formatting
- Decimal places handled appropriately

#### TC4.3: Transaction feedback
**Steps:**
1. Submit a share update
2. Observe UI during transaction

**Expected:**
- Loading/pending state shown
- Success confirmation displayed
- Error message shown if failed

---

### Section 5: Edge Cases

#### TC5.1: Boundary value - minimum (0%)
**Precondition:** Min=0%

**Steps:**
1. Set share to exactly 0%
2. Complete a round

**Expected:**
- Valid, transaction succeeds
- All rewards go to hodler

#### TC5.2: Boundary value - maximum (if 100% allowed)
**Precondition:** Max=100%

**Steps:**
1. Set share to exactly 100%
2. Complete a round

**Expected:**
- Valid, transaction succeeds
- All rewards go to operator

#### TC5.3: Multiple operators with different shares
**Steps:**
1. Operator A: 5% share
2. Operator B: 20% share
3. Operator C: 0% share
4. Hodler stakes with all three
5. Complete a round

**Expected:**
- Each operator's rewards calculated independently
- Hodler gets different amounts from each based on operator's share

#### TC5.4: Share change mid-round
**Steps:**
1. Operator has 10% share
2. Round starts (scores added)
3. Operator changes share to 25%
4. Round completes

**Expected:**
- Round uses share value that was set when scores were added (10%)
- New share (25%) applies to next round

---

### Section 6: Wallet Connection Scenarios

#### TC6.1: Correct operator address used
**Steps:**
1. Connect wallet with operator address
2. Set share
3. Verify share is stored against correct address

**Expected:**
- Share associated with connected wallet address
- Lowercase address normalization applied

#### TC6.2: Non-operator wallet
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
- [ ] Set-Share blocked when shares feature is disabled
- [ ] Set-Share blocked when operator setting (SetSharesEnabled) is disabled
- [ ] When SetSharesEnabled is OFF, all operators use default share
- [ ] Operator shares resume when SetSharesEnabled is toggled back ON
- [ ] Reward split displays correctly (hodler vs operator)
- [ ] Zero share = all rewards to hodler
- [ ] New operators use default share (no automatic assignment to Shares table)
- [ ] Share persists across rounds
- [ ] Dashboard input validation works
- [ ] Transaction feedback is clear
- [ ] Boundary values (0%, max%) work correctly

---

## Notes

- Shares feature must be enabled by contract owner before operators can set shares
- SetSharesEnabled must also be enabled for operators to set custom shares
- When SetSharesEnabled is OFF, all operators use the configured Default share
- Operator shares are preserved when SetSharesEnabled is toggled off - they resume when re-enabled
- Share values are stored as decimals (0.0 - 1.0) but displayed as percentages in Dashboard
- Changes to share take effect on the next round after the change is confirmed
