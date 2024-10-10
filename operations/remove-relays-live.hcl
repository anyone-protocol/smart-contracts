job "remove-relays-live" {
  datacenters = ["ator-fin"]
  type = "batch"

  reschedule {
    attempts = 0
  }

  task "remove-relays-live-task" {
    driver = "docker"

    config {
      network_mode = "host"
      image = "ghcr.io/anyone-protocol/smart-contracts:0.3.8"
      entrypoint = ["npx"]
      command = "ts-node"
      args = ["scripts/relay-registry/remove-relays.ts"]
      volumes = [ "data/data.json:/usr/src/app/smartweave/data/data.json" ]
    }

    vault {
      policies = ["relay-registry-live"]
    }

    template {
      data = <<EOH
      {{with secret "kv/relay-registry/live"}}
        RELAY_REGISTRY_OPERATOR_KEY="{{.Data.data.RELAY_REGISTRY_OWNER_KEY}}"
        CONSUL_TOKEN="{{.Data.data.CONSUL_TOKEN}}"
      {{end}}
      EOH
      destination = "secrets/file.env"
      env         = true
    }

    template {
      data = <<EOH
      {
        "fingerprints": [
          
        ]
      }
      EOH
      destination = "data/data.json"
    }

    env {
      PHASE="live"
      CONSUL_IP="127.0.0.1"
      CONSUL_PORT="8500"
      RELAY_REGISTRY_ADDRESS_CONSUL_KEY="smart-contracts/live/relay-registry-address"
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
