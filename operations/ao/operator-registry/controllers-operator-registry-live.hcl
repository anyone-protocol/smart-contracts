job "controllers-operator-registry-live" {
  datacenters = [ "ator-fin" ]
  type = "batch"
  namespace = "live-protocol"

  constraint {
    attribute = "${meta.pool}"
    value = "live-protocol"
  }

  reschedule { attempts = 0 }

  task "operator-registry-live" {
    env {
      SCRIPT = "scripts/acl/update-roles.ts"
      # Script data - stringified JSON
      UPDATE_ROLES_DATA="{\"Grant\":{\"0x79053CA2ED70c8831D42e1456e15271941787D32\":[\"Add-Scores\",\"Complete-Round\"],\"0x8F666992a6dA43e2Be89F39497110e2b012D7e94\":[\"Claim-Rewards\"]}}"

      PHASE = "live"
      CU_URL="https://cu.ardrive.io"
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
      {{with secret "kv/live-protocol/operator-registry-live"}}
        ETH_PRIVATE_KEY="{{.Data.data.ETH_ADMIN_KEY}}"
      {{end}}
      EOH
    }

    template {
      destination = "local/config.env"
      env         = true
      data = <<EOH
      PROCESS_ID="{{ key `smart-contracts/live/operator-registry-address` }}"
      EOH
    }
  }
}
