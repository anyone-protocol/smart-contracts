job "operator-registry-update-roles-stage" {
  datacenters = [ "ator-fin" ]
  type = "batch"

  reschedule { attempts = 0 }

  task "operator-registry-update-roles-stage-task" {
    driver = "docker"

    restart {
      attempts = 0
      mode     = "fail"
    }

    resources {
      cpu    = 4096
      memory = 4096
    }

    vault { policies = [ "relay-registry-stage" ] }

    config {
      network_mode = "host"
      image = "ghcr.io/anyone-protocol/smart-contracts-ao:stage"
      entrypoint = ["npx"]
      command = "tsx"
      args = ["scripts/operator-registry/add-verified-hardware.ts"]
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
      CONSUL_IP = "127.0.0.1"
      CONSUL_PORT = "8500"
      CONTRACT_NAME = "operator-registry"
      CONTRACT_CONSUL_KEY = "smart-contracts/stage/operator-registry-address"
      CONTRACT_SOURCE_CONSUL_KEY = "smart-contracts/stage/operator-registry-source"
      ETH_PRIVATE_KEY=""
      PROCESS_ID=""
      FINGERPRINTS=""
    }

    template {
      destination = "secrets/file.env"
      env         = true
      data = <<EOH
      {{with secret "kv/relay-registry/stage"}}
        DEPLOYER_PRIVATE_KEY="{{.Data.data.RELAY_REGISTRY_OWNER_KEY}}"
        CONSUL_TOKEN="{{.Data.data.CONSUL_TOKEN}}"
      {{end}}
      EOH
    }
  }
}
