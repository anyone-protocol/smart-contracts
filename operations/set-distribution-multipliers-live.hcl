job "set-distribution-multipliers-live" {
  datacenters = ["ator-fin"]
  type = "batch"

  reschedule {
    attempts = 0
  }

  task "set-distribution-multipliers-live-task" {
    driver = "docker"

    config {
      network_mode = "host"
      image = "ghcr.io/ator-development/smart-contracts:0.2.11"
      entrypoint = ["npx"]
      command = "ts-node"
      args = ["scripts/distribution/set-multipliers.ts"]
      volumes = [
          "local/distribution-multipliers.json:/usr/src/app/smartweave/dist/contracts/distribution-multipliers.json"
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
            {{with secret "kv/distribution/live"}}
            
{
    [<FINGERPRINT>]: "1.234"
}

            {{end}}
            EOH
            destination = "local/distribution-multipliers.json"
            env         = false
        }

    env {
      PHASE="dev"
      CONSUL_IP="127.0.0.1"
      CONSUL_PORT="8500"
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
