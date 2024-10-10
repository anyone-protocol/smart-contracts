job "distribution-set-hw-bonus-distribution-rate-live" {
  datacenters = ["ator-fin"]
  type = "batch"

  reschedule {
    attempts = 0
  }

  task "distribution-set-hw-bonus-distribution-rate-live-task" {
    driver = "docker"

    config {
      network_mode = "host"
      image = "ghcr.io/anyone-protocol/smart-contracts:0.3.5"
      entrypoint = ["npx"]
      command = "ts-node"
      args = ["scripts/distribution/set-hw-bonus-distribution-rate.ts"]
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
      DISTRIBUTION_ADDRESS_CONSUL_KEY="smart-contracts/live/distribution-address"
      HW_BONUS_TOKENS_DISTRIBUTED_PER_SECOND="8680555500000000"
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
