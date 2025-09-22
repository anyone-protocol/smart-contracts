job "controllers-staking-rewards-live" {
  datacenters = [ "ator-fin" ]
  type = "batch"
  namespace = "live-protocol"

  constraint {
    attribute = "${meta.pool}"
    value = "live-protocol"
  }

  reschedule { attempts = 0 }

  task "staking-rewards-live" {
    env {
      SCRIPT = "scripts/acl/update-roles.ts"
      # Script data - stringified JSON
      UPDATE_ROLES_DATA="{\"Grant\":{\"0xB45B7F679b7470b094dDf99ebCbee1bc8552fa1A\":[\"Add-Scores\",\"Complete-Round\"],\"0x14F7b53a09758aa257D8597cF992bDB61915f319\":[\"Claim-Rewards\"]}}"

      PHASE = "live"
      CU_URL="https://cu.anyone.permaweb.services"
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
      {{with secret "kv/live-protocol/staking-rewards-live"}}
        ETH_PRIVATE_KEY="{{.Data.data.ETH_ADMIN_KEY}}"
      {{end}}
      EOH
    }

    template {
      destination = "local/config.env"
      env         = true
      data = <<EOH
      PROCESS_ID="{{ key `smart-contracts/live/staking-rewards-address` }}"
      EOH
    }
  }
}
