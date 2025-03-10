job "operator-registry-update-roles-live" {
  datacenters = [ "ator-fin" ]
  type = "batch"

  reschedule { attempts = 0 }

  task "operator-registry-update-roles-live-task" {
    driver = "docker"

    restart {
      attempts = 0
      mode     = "fail"
    }

    resources {
      cpu    = 4096
      memory = 4096
    }

    vault { policies = [ "relay-registry-live" ] }

    config {
      network_mode = "host"
      image = "ghcr.io/anyone-protocol/smart-contracts-ao:e7939a6367dc9413bd790e154b7f5aee92450c2c"
      entrypoint = ["npx"]
      command = "tsx"
      args = ["scripts/operator-registry/add-verified-hardware.ts"]
    }

    env {
      PHASE = "live"
      CONSUL_IP = "127.0.0.1"
      CONSUL_PORT = "8500"
      CONTRACT_NAME = "operator-registry"
      CONTRACT_CONSUL_KEY = "smart-contracts/live/operator-registry-address"
      CONTRACT_SOURCE_CONSUL_KEY = "smart-contracts/live/operator-registry-source"
      ETH_PRIVATE_KEY=""
      PROCESS_ID=""
      FINGERPRINTS=""
    }

    template {
      destination = "secrets/file.env"
      env         = true
      data = <<EOH
      {{with secret "kv/relay-registry/live"}}
        DEPLOYER_PRIVATE_KEY="{{.Data.data.RELAY_REGISTRY_OWNER_KEY}}"
        CONSUL_TOKEN="{{.Data.data.CONSUL_TOKEN}}"
      {{end}}
      EOH
    }
  }
}
