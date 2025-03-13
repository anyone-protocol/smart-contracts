job "relay-rewards-update-configuration-live" {
  datacenters = [ "ator-fin" ]
  type = "batch"

  reschedule { attempts = 0 }

  task "relay-rewards-update-configuration-live-task" {
    driver = "docker"

    restart {
      attempts = 0
      mode     = "fail"
    }

    resources {
      cpu    = 4096
      memory = 4096
    }

    vault { policies = [ "distribution-live" ] }

    config {
      network_mode = "host"
      image = "ghcr.io/anyone-protocol/smart-contracts-ao:25120ce3162374bfde041a69c8e838aa9dfb4efb"
      entrypoint = ["npx"]
      command = "tsx"
      args = ["scripts/relay-rewards/update-configuration.ts"]
      logging {
        type = "loki"
        config {
          loki-url = "http://10.1.244.1:3100/loki/api/v1/push"
          loki-external-labels = "container_name={{.Name}},job_name=${NOMAD_JOB_NAME}"
        }
      }
    }

    env {
      PHASE = "live"

      # Relay Rewards Process ID
      PROCESS_ID="pQ1RUISn_ulJwCXwIKTTZq9yJuAEVdnEN76HTRwCEOA"
      
      # Stringified JSON
      UPDATE_CONFIG_DATA="{\"TokensPerSecond\": 40509259200000000,\"Multipliers\": {\"Family\": {\"Enabled\": true,\"Offset\": 0.02,\"Power\": 0.7},\"Location\": {\"Offset\": 0.001,\"Enabled\": true,\"Divider\": 20,\"Power\": 1.85}},\"Modifiers\": {\"ExitBonus\": {\"Share\": 0.1,\"Enabled\": true},\"Hardware\": {\"Enabled\": true,\"Share\": 0.2,\"UptimeInfluence\": 0.35},\"Uptime\": {\"Enabled\": true,\"Share\": 0.14,\"Tiers\": {\"0\": 0,\"3\": 1,\"14\": 3}},\"Network\": {\"Share\": 0.56}}}"
    }

    template {
      destination = "secrets/file.env"
      env         = true
      data = <<EOH
      {{with secret "kv/distribution/live"}}
        ETH_PRIVATE_KEY="{{.Data.data.DISTRIBUTION_OWNER_KEY}}"
      {{end}}
      EOH
    }
  }
}
