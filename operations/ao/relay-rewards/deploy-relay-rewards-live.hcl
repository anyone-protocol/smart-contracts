job "deploy-relay-rewards-live" {
  datacenters = [ "ator-fin" ]
  type = "batch"

  reschedule { attempts = 0 }

  task "deploy-relay-rewards-task" {
    driver = "docker"

    restart {
      attempts = 0
      mode     = "fail"
    }

    resources {
      cpu    = 4096
      memory = 4096
    }

    config {
      network_mode = "host"
      image = "ghcr.io/anyone-protocol/smart-contracts-ao:8fa98916f665df94e0182381aa98f674f49cc471"
      entrypoint = ["npm"]
      command = "run"
      args = ["deploy"]
      logging {
        type = "loki"
        config {
          loki-url = "http://10.1.244.1:3100/loki/api/v1/push"
          loki-external-labels = "container_name={{.Name}},job_name=${NOMAD_JOB_NAME}"
        }
      }
    }

    vault { policies = [ "distribution-live" ] }

    env {
      PHASE = "live"
      CONSUL_IP = "127.0.0.1"
      CONSUL_PORT = "8500"
      CONTRACT_NAME = "relay-rewards"
      CONTRACT_CONSUL_KEY = "smart-contracts/live/relay-rewards-address"
      CONTRACT_SOURCE_CONSUL_KEY = "smart-contracts/live/relay-rewards-source"
        CU_URL="https://cu.anyone.permaweb.services"
    }

    template {
      destination = "secrets/file.env"
      env         = true
      data = <<EOH
      {{with secret "kv/distribution/live"}}
        DEPLOYER_PRIVATE_KEY="{{.Data.data.DISTRIBUTION_OWNER_KEY}}"
        CONSUL_TOKEN="{{.Data.data.CONSUL_TOKEN}}"
      {{end}}
      EOH
    }
  }
}
