
job "add-scores-live" {
  datacenters = ["ator-fin"]
  type = "batch"

  reschedule {
    attempts = 0
  }

  task "add-scores-live-task" {
    driver = "docker"

    config {
      network_mode = "host"
      image = "ghcr.io/ator-development/smart-contracts:0.1.3"
      entrypoint = ["npx"]
      command = "ts-node"
      args = ["scripts/distribution/add-scores.ts"]
      volumes = [
        "local/scores:/usr/src/app/smartweave/dist/contracts/scores.json"
      ]
    }

    vault {
      policies = ["distribution-live"]
    }

    template {
      data = <<EOH
      {{with secret "kv/distribution/live"}}
        DISTRIBUTION_OWNER_KEY="{{.Data.data.DISTRIBUTION_OWNER_KEY}}"
        CONSUL_TOKEN="{{.Data.data.CONSUL_TOKEN}}"
      {{end}}
      EOH
      destination = "secrets/file.env"
      env         = true
    }

    template {
      data = <<EOH
      TODO: scores json :)
      EOH
      destination = "local/scores.json"
      env = false
    }

    env {
      PHASE="live"
      CONSUL_IP="127.0.0.1"
      CONSUL_PORT="8500"
      TEST_ACCOUNTS_KEY="facilitator-goerli/test-accounts"
      DISTRIBUTION_ADDRESS_CONSUL_KEY="smart-contracts/live/distribution-address"
    }

    restart {
      attempts = 0
      mode = "fail"
    }

    resources {
      cpu = 4096
      memory = 4096
    }
  }
}
