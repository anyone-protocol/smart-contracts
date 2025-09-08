job "staking-rewards-stage" {
  datacenters = [ "ator-fin" ]
  type = "batch"
  namespace = "stage-protocol"

  constraint {
      attribute = "${meta.pool}"
      value = "stage"
  }

  reschedule { attempts = 0 }

  task "deploy-staking-rewards-task" {
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
      image = "ghcr.io/anyone-protocol/smart-contracts-ao:d35b61dcb47ef90cf2d7afd95af12e94aeb2dabd"
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
      PHASE = "stage"
      CONSUL_IP = "127.0.0.1"
      CONSUL_PORT = "8500"
      CONTRACT_NAME = "staking-rewards"
      CONTRACT_CONSUL_KEY = "smart-contracts/stage/staking-rewards-address"
      CONTRACT_SOURCE_CONSUL_KEY = "smart-contracts/stage/staking-rewards-source"
    }

    template {
      destination = "secrets/file.env"
      env         = true
      data = <<EOH
      {{with secret "kv/stage-protocol/staking-rewards-stage"}}
        DEPLOYER_PRIVATE_KEY="{{.Data.data.ETH_ADMIN_KEY}}"
        CONSUL_TOKEN="{{.Data.data.CONSUL_TOKEN}}"
      {{end}}
      EOH
    }
  }
}
