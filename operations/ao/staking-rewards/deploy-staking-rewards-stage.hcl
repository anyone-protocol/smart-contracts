job "deploy-staking-rewards-stage" {
  datacenters = [ "ator-fin" ]
  type = "batch"

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
      image = "ghcr.io/anyone-protocol/smart-contracts-ao:2678ed128f488700d846bf8835c8def0290bb338"
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

    vault { policies = [ "distribution-stage" ] }

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
      {{with secret "kv/distribution/stage"}}
        DEPLOYER_PRIVATE_KEY="{{.Data.data.DISTRIBUTION_OWNER_KEY}}"
        CONSUL_TOKEN="{{.Data.data.CONSUL_TOKEN}}"
      {{end}}
      EOH
    }
  }
}
