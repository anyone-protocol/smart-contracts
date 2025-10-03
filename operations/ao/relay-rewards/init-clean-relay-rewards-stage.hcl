job "init-clean-relay-rewards-stage" {
  datacenters = [ "ator-fin" ]
  type = "batch"
  namespace = "stage-protocol"

  constraint {
    attribute = "${meta.pool}"
    value = "stage"
  }

  reschedule { attempts = 0 }

  task "relay-rewards-stage" {
    env {
      SCRIPT = "scripts/init-clean.ts"
      # Script data - stringified JSON
      INIT_CLEAN_DATA="{\"Configuration\":{\"TokensPerSecond\": \"28935184200000000\",\"Delegates\": [],\"Multipliers\": {\"Family\": {\"Enabled\": true,\"Offset\": 0.01,\"Power\": 1},\"Location\": {\"Offset\": 0.001,\"Enabled\": true,\"Divider\": 20,\"Power\": 2}},\"Modifiers\": {\"ExitBonus\": {\"Share\": 0.1,\"Enabled\": true},\"Hardware\": {\"Enabled\": true,\"Share\": 0.2,\"UptimeInfluence\": 0.35},\"Uptime\": {\"Enabled\": true,\"Share\": 0.14,\"Tiers\": {\"0\": 0,\"3\": 1,\"14\":3}},\"Network\":{\"Share\":0.56}}}}"

      PHASE = "stage"
      CU_URL="https://cu-stage.anyone.tech"
    }

    driver = "docker"

    config {
      network_mode = "host"
      image = "ghcr.io/anyone-protocol/smart-contracts-ao:03f9ae715e1b0ff0ada8ef75e46b356cd9d02933"
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
      {{with secret "kv/stage-protocol/relay-rewards-stage"}}
        ETH_PRIVATE_KEY="{{.Data.data.ETH_ADMIN_KEY}}"
      {{end}}
      EOH
    }

    template {
      destination = "local/config.env"
      env         = true
      data = <<EOH
      PROCESS_ID="{{ key `smart-contracts/stage/relay-rewards-address` }}"
      EOH
    }
  }
}
