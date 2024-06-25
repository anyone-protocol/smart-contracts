job "add-relays-stage" {
  datacenters = ["ator-fin"]
  type = "batch"

  reschedule {
    attempts = 0
  }

  task "add-relays-stage-task" {
    driver = "docker"

    config {
      network_mode = "host"
      image = "ghcr.io/ator-development/smart-contracts:0.2.9"
      entrypoint = ["npx"]
      command = "ts-node"
      args = ["scripts/relay-registry/add-relays.ts"]
    }

    vault {
      policies = ["relay-registry-stage"]
    }

    template {
      data = <<EOH
      {{with secret "kv/relay-registry/stage"}}
        RELAY_REGISTRY_OWNER_KEY="{{.Data.data.RELAY_REGISTRY_OWNER_KEY}}"
        CONSUL_TOKEN="{{.Data.data.CONSUL_TOKEN}}"
      {{end}}
      EOH
      destination = "secrets/file.env"
      env         = true
    }

    env {
      PHASE="stage"
      CONSUL_IP="127.0.0.1"
      CONSUL_PORT="8500"
      TEST_ACCOUNTS_KEY="facilitator/goerli/stage/test-accounts"
      RELAY_REGISTRY_ADDRESS_CONSUL_KEY="smart-contracts/stage/relay-registry-address"
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
