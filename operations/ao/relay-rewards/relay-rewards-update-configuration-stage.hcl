job "relay-rewards-update-configuration-stage" {
  datacenters = [ "ator-fin" ]
  type = "batch"

  reschedule { attempts = 0 }

  task "relay-rewards-update-configuration-stage-task" {
    driver = "docker"

    restart {
      attempts = 0
      mode     = "fail"
    }

    resources {
      cpu    = 4096
      memory = 4096
    }

    vault { policies = [ "distribution-stage" ] }

    config {
      network_mode = "host"
      image = "ghcr.io/anyone-protocol/smart-contracts-ao:stage"
      entrypoint = ["npx"]
      command = "tsx"
      args = ["scripts/relay-rewards/update-configuration.ts"]
    }

    env {
      PHASE = "stage"

      # Relay Rewards Process ID
      PROCESS_ID=""
      
      # Stringified JSON
      UPDATE_CONFIG_DATA=""
    }

    template {
      destination = "secrets/file.env"
      env         = true
      data = <<EOH
      {{with secret "kv/distribution/stage"}}
        ETH_PRIVATE_KEY="{{.Data.data.DISTRIBUTION_OWNER_KEY}}"
      {{end}}
      EOH
    }
  }
}
