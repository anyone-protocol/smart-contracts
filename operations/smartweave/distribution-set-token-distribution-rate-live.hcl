job "distribution-set-token-distribution-rate-live" {
  datacenters = ["ator-fin"]
  type = "batch"

  reschedule {
    attempts = 0
  }

  task "distribution-set-token-distribution-rate-live-task" {
    driver = "docker"

    config {
      network_mode = "host"
      image = "ghcr.io/anyone-protocol/smart-contracts:0.3.10"
      entrypoint = ["npx"]
      command = "ts-node"
      args = ["scripts/distribution/set-token-distribution-rate.ts"]
    }

    vault {
      policies = ["distribution-live"]
    }

    template {
      data = <<EOH
      {{with secret "kv/distribution/live"}}
        DISTRIBUTION_OPERATOR_KEY="{{.Data.data.DISTRIBUTION_OWNER_KEY}}"
        CONSUL_TOKEN="{{.Data.data.CONSUL_TOKEN}}"
      {{end}}
      EOH
      destination = "secrets/file.env"
      env         = true
    }

    env {
      PHASE="live"
      CONSUL_IP="127.0.0.1"
      CONSUL_PORT="8500"
      TOKENS_DISTRIBUTED_PER_SECOND="16203703700000000"
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
