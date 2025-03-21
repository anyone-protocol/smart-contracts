job "distribution-add-hw-bonus-fingerprints-live" {
  datacenters = [ "ator-fin" ]
  type = "batch"

  reschedule { attempts = 0 }

  task "distribution-add-hw-bonus-fingerprints-live-task" {
    driver = "docker"

    config {
      network_mode = "host"
      image = "ghcr.io/anyone-protocol/smart-contracts:0.3.10"
      entrypoint = ["npx"]
      command = "ts-node"
      args = ["scripts/distribution/add-hw-bonus-fingerprints.ts"]
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
      DRE_HOSTNAME="https://dre.ec.anyone.tech"
      DISTRIBUTION_ADDRESS_CONSUL_KEY="smart-contracts/live/distribution-address"
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
