job "staking-rewards-admin-live" {
  datacenters = [ "ator-fin" ]
  namespace = "live-protocol"
  type = "batch"

  constraint {
      attribute = "${meta.pool}"
      value = "live-protocol"
  }

  reschedule { attempts = 0 }

  task "staking-rewards-live" {

    env {
      PHASE = "live"
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

    consul {}

    vault {
      role = "any1-nomad-workloads-owner"
    }

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

    template {
      destination = "local/config.env"
      env         = true
      data = <<EOH
      PROCESS_ID="{{ key `smart-contracts/live/staking-rewards-address` }}"
      EOH
    }

    template {
      destination = "secrets/file.env"
      env         = true
      data = <<EOH
      {{with secret "kv/live-protocol/staking-rewards-live"}}
        ETH_PRIVATE_KEY="{{.Data.data.ETH_ADMIN_KEY}}"
      {{end}}
      EOH
    }
  }
}
