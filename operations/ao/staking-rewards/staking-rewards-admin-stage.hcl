job "staking-rewards-admin-stage" {
  datacenters = [ "ator-fin" ]
  namespace = "stage-protocol"
  type = "batch"

  constraint {
      attribute = "${meta.pool}"
      value = "stage"
  }

  reschedule { attempts = 0 }

  task "staking-rewards-stage" {

    env {
      PHASE = "stage"
      SCRIPT = "scripts/acl/update-roles.ts"
      # Stringified JSON
      UPDATE_ROLES_DATA="{\"Grant\":{\"0x01B188F45bcde0D1E2dDD171279E1356782cDdE2\":[\"Complete-Round\",\"Add-Scores\"],\"0x999245c6ddc6E23F99844152e39045013C438d00\":[\"Claim-Rewards\"]}}"

      CU_URL="https://cu-stage.anyone.tech"
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
      image = "ghcr.io/anyone-protocol/smart-contracts-ao:bec6cf978246be973f9c0848e81e4ca0fe884c98"
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
      {{with secret "kv/stage-protocol/staking-rewards-stage"}}
        ETH_PRIVATE_KEY="{{.Data.data.ETH_ADMIN_KEY}}"
      {{end}}
      EOH
    }
  }
}
