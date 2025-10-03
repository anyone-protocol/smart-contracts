job "relay-rewards-live" {
  datacenters = [ "ator-fin" ]
  type = "batch"
  namespace = "live-protocol"

  constraint {
      attribute = "${meta.pool}"
      value = "live-protocol"
  }

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
      image = "ghcr.io/anyone-protocol/smart-contracts-ao:8cc6c8bd0ace216de6a3c0cf90baa8c39e42b276"
      entrypoint = ["npm"]
      command = "run"
      args = ["deploy"]
      logging {
        type = "loki"
        config {
          loki-url = "http://10.1.3.1:3100/loki/api/v1/push"
          loki-external-labels = "container_name={{.Name}},job_name=${NOMAD_JOB_NAME}"
        }
      }
    }

    vault {
        role = "any1-nomad-workloads-controller"
    }

    consul {}

    env {
      PHASE = "live"
      CONSUL_IP = "127.0.0.1"
      CONSUL_PORT = "8500"
      CONTRACT_NAME = "relay-rewards"
      CONTRACT_CONSUL_KEY = "smart-contracts/live/relay-rewards-address"
      CONTRACT_SOURCE_CONSUL_KEY = "smart-contracts/live/relay-rewards-source"
      CU_URL="https://cu.anyone.tech"
    }

    template {
      destination = "secrets/file.env"
      env         = true
      data = <<EOH
      {{with secret "kv/live-protocol/relay-rewards-live"}}
        DEPLOYER_PRIVATE_KEY="{{.Data.data.ETH_ADMIN_KEY}}"
        CONSUL_TOKEN="{{.Data.data.CONSUL_TOKEN}}"
      {{end}}
      EOH
    }
  }
}
