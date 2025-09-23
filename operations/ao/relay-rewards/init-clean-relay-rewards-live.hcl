job "init-clean-relay-rewards-live" {
  datacenters = [ "ator-fin" ]
  type = "batch"
  namespace = "live-protocol"

  constraint {
    attribute = "${meta.pool}"
    value = "live-protocol"
  }

  reschedule { attempts = 0 }

  task "relay-rewards-live" {
    env {
      SCRIPT = "scripts/init-clean.ts"
      # Script data - stringified JSON
      INIT_CLEAN_DATA="{\"Configuration\":{\"TokensPerSecond\": \"52083333300000000\",\"Delegates\": [],\"Multipliers\": {\"Family\": {\"Enabled\": true,\"Offset\": 0.03,\"Power\": 0.5},\"Location\": {\"Offset\": 0.001,\"Enabled\": true,\"Divider\": 20,\"Power\": 1.85}},\"Modifiers\": {\"ExitBonus\": {\"Share\": 0.1,\"Enabled\": true},\"Hardware\": {\"Enabled\": true,\"Share\": 0.25,\"UptimeInfluence\": 0.45},\"Uptime\": {\"Enabled\": true,\"Share\": 0.15,\"Tiers\": {\"0\": 0,\"3\": 1,\"14\":3,\"45\":5}},\"Network\":{\"Share\":0.5}}}}"

      PHASE = "live"
      CU_URL="https://cu.ardrive.io"
    }

    driver = "docker"

    config {
      network_mode = "host"
      image = "ghcr.io/anyone-protocol/smart-contracts-ao:8cc6c8bd0ace216de6a3c0cf90baa8c39e42b276"
      entrypoint = ["npx"]
      command = "tsx"
      args = ["${SCRIPT}"]
      logging {
        type = "loki"
        config {
          loki-url = "http://10.1.3.1:3100/loki/api/v1/push"
          loki-external-labels = "container_name={{.Name}},job_name=${NOMAD_JOB_NAME}"
        }
      }
    }

    restart {
      attempts = 0
      mode     = "fail"
    }

    resources {
      cpu    = 4096
      memory = 4096
    }

    consul {}

    vault {
      role = "any1-nomad-workloads-owner"
    }

    template {
      destination = "secrets/keys.env"
      env         = true
      data = <<EOH
      {{with secret "kv/live-protocol/relay-rewards-live"}}
        ETH_PRIVATE_KEY="{{.Data.data.ETH_ADMIN_KEY}}"
      {{end}}
      EOH
    }

    template {
      destination = "local/config.env"
      env         = true
      data = <<EOH
      PROCESS_ID="{{ key `smart-contracts/live/relay-rewards-address` }}"
      EOH
    }
  }
}
