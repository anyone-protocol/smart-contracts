function last_snapshot(base, req)
  local result = {
    timestamp = base.previous_round.Timestamp,
    period = base.previous_round.Period,

    summary_ratings_network = base.previous_round.Summary.Ratings.Network,
    summary_ratings_uptime = base.previous_round.Summary.Ratings.Uptime,
    summary_ratings_exitbonus = base.previous_round.Summary.Ratings.ExitBonus,
    summary_rewards_total = base.previous_round.Summary.Rewards.Total,
    summary_rewards_network = base.previous_round.Summary.Rewards.Network,
    summary_rewards_hardware = base.previous_round.Summary.Rewards.Hardware,
    summary_rewards_uptime = base.previous_round.Summary.Rewards.Uptime,
    summary_rewards_exitbonus = base.previous_round.Summary.Rewards.ExitBonus,

    configuration_tokenspersecond = base.configuration.TokensPerSecond,
    configuration_modifiers_network_share = base.configuration.Modifiers.Network.Share,
    configuration_modifiers_hardware_enabled = base.configuration.Modifiers.Hardware.Enabled,
    configuration_modifiers_hardware_share = base.configuration.Modifiers.Hardware.Share,
    configuration_modifiers_hardware_uptimeinfluence = base.configuration.Modifiers.Hardware.UptimeInfluence,
    configuration_modifiers_uptime_enabled = base.configuration.Modifiers.Uptime.Enabled,
    configuration_modifiers_uptime_share = base.configuration.Modifiers.Uptime.Share,
    configuration_modifiers_exitbonus_enabled = base.configuration.Modifiers.ExitBonus.Enabled,
    configuration_modifiers_exitbonus_share = base.configuration.Modifiers.ExitBonus.Share,
    configuration_multipliers_family_enabled = base.configuration.Multipliers.Family.Enabled,
    configuration_multipliers_family_offset = base.configuration.Multipliers.Family.Offset,
    configuration_multipliers_family_power = base.configuration.Multipliers.Family.Power,
    configuration_multipliers_location_enabled = base.configuration.Multipliers.Location.Enabled,
    configuration_multipliers_location_offset = base.configuration.Multipliers.Location.Offset,
    configuration_multipliers_location_power = base.configuration.Multipliers.Location.Power,
    configuration_multipliers_location_divider = base.configuration.Multipliers.Location.Divider,
  }

  -- Enumerates Configuration.Modifiers.Uptime.Tiers
  local tierIndex = 0
  for streak, weight in pairs(base.configuration.Modifiers.Uptime.Tiers) do
    result['configuration_modifiers_uptime_tier_'..tostring(tierIndex)..'_streak' ] = streak
    result['configuration_modifiers_uptime_tier_'..tostring(tierIndex)..'_weight' ] = weight
    tierIndex = tierIndex + 1
  end

  -- TODO -> Enumerate Configuration.Delegates

  -- TODO -> Details (per fingerprint)

  return result
end
