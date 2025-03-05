job "staking-rewards-update-configuration-stage" {
  datacenters = [ "ator-fin" ]
  type = "batch"

  reschedule { attempts = 0 }

  task "staking-rewards-update-configuration-stage-task" {
    driver = "docker"

    restart {
      attempts = 0
      mode     = "fail"
    }

    resources {
      cpu    = 4096
      memory = 4096
    }

    vault { policies = [ "distribution-stage" ] }

    config {
      network_mode = "host"
      image = "ghcr.io/anyone-protocol/smart-contracts-ao:stage"
      entrypoint = ["npx"]
      command = "tsx"
      args = ["scripts/staking-rewards/update-configuration.ts"]
      logging {
        type = "loki"
        config {
          loki-url = "http://10.1.244.1:3100/loki/api/v1/push"
          loki-external-labels = "container_name={{.Name}},job_name=${NOMAD_JOB_NAME}"
        }
      }
    }

    env {
      PHASE = "stage"

      # Relay Rewards Process ID
      PROCESS_ID=""
      
      # Stringified JSON
      UPDATE_CONFIG_DATA=""
    }

    template {
      destination = "secrets/file.env"
      env         = true
      data = <<EOH
      {{with secret "kv/distribution/stage"}}
        ETH_PRIVATE_KEY="{{.Data.data.DISTRIBUTION_OPERATOR_KEY}}"
      {{end}}
      EOH
    }
  }
}
