job "staking-rewards-admin-stage" {
  datacenters = [ "ator-fin" ]
  namespace = "stage-protocol"
  type = "batch"

  reschedule { attempts = 0 }

  task "staking-rewards-update-configuration-stage-task" {

    env {
      PHASE = "stage"
      SCRIPT = "scripts/staking-rewards/update-configuration.ts"

      # Stringified JSON
      UPDATE_CONFIG_DATA="{\"TokensPerSecond\":\"28935185000000000\",\"Requirements\":{\"Running\":0.5}}"
      CU_URL="https://cu.anyone.permaweb.services"
    }

    driver = "docker"

    restart {
      attempts = 0
      mode     = "fail"
    }

    resources {
      cpu    = 4096
      memory = 4096
    }

    vault {
      role = "any1-nomad-workloads-controller"
    }

    config {
      network_mode = "host"
      image = "ghcr.io/anyone-protocol/smart-contracts-ao:84c580b4a8c67a629821340b5c8fe663ae52e94b"
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

    template {
      destination = "local/config.env"
      env         = true
      data = <<EOH
      PROCESS_ID="{{ key `smart-contracts/stage/staking-rewards-address` }}"
      EOH
    }

    template {
      destination = "secrets/file.env"
      env         = true
      data = <<EOH
      {{with secret "kv/stage-protocol/staking-rewards-admin-stage"}}
        ETH_PRIVATE_KEY="{{.Data.data.ETH_ADMIN_KEY}}"
      {{end}}
      EOH
    }
  }
}
