job "relay-registry-toggle-registration-credits-requirement-dev" {
  datacenters = ["ator-fin"]
  type = "batch"

  reschedule {
    attempts = 0
  }

  task "relay-registry-toggle-registration-credits-requirement-dev-task" {
    driver = "docker"

    config {
      network_mode = "host"
      image = "ghcr.io/ator-development/smart-contracts:0.3.3"
      entrypoint = ["npx"]
      command = "ts-node"
      args = [
        "scripts/relay-registry/toggle-registration-credits-requirement.ts"
      ]
    }

    vault {
      policies = ["relay-registry-dev"]
    }

    template {
      data = <<EOH
      {{with secret "kv/relay-registry/dev"}}
        RELAY_REGISTRY_OPERATOR_KEY="{{.Data.data.RELAY_REGISTRY_OWNER_KEY}}"
        CONSUL_TOKEN="{{.Data.data.CONSUL_TOKEN}}"
      {{end}}
      EOH
      destination = "secrets/file.env"
      env         = true
    }

    env {
      PHASE="dev"
      CONSUL_IP="127.0.0.1"
      CONSUL_PORT="8500"
      RELAY_REGISTRY_ADDRESS_CONSUL_KEY="smart-contracts/dev/relay-registry-address"
      RELAY_REGISTRY_CONTRACT_ID=""
      REGISTRATION_CREDITS_ENABLED=""
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
