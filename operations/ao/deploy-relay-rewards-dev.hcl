job "deploy-relay-rewards-dev" {
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
      image = "ghcr.io/anyone-protocol/smart-contracts-ao:0.0.1"
      entrypoint = ["npm"]
      command = "run"
      args = ["deploy"]
    }

    vault { policies = [ "distribution-dev" ] }

    env {
      PHASE = "dev"
      CONSUL_IP = "127.0.0.1"
      CONSUL_PORT = "8500"
      CONTRACT_NAME = "relay-rewards"
      CONTRACT_CONSUL_KEY = "smart-contracts/dev/relay-rewards-address"
      CONTRACT_SOURCE_CONSUL_KEY = "smart-contracts/dev/relay-rewards-source"
    }

    template {
      destination = "secrets/file.env"
      env         = true
      data = <<EOH
      {{with secret "kv/distribution/dev"}}
        DEPLOYER_PRIVATE_KEY="{{.Data.data.DISTRIBUTION_OWNER_KEY}}"
        CONSUL_TOKEN="{{.Data.data.CONSUL_TOKEN}}"
      {{end}}
      EOH
    }
  }
}
