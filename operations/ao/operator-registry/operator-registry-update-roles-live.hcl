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
      image = "ghcr.io/anyone-protocol/smart-contracts-ao:1a586b1a8f8380dac623b19408f04b1bccbffc22"
      entrypoint = ["npx"]
      command = "tsx"
      args = ["scripts/acl/update-roles.ts"]
    }

    env {
      PHASE = "live"
      PROCESS_ID=""
      UPDATE_ROLES_DATA=""
    }

    template {
      destination = "secrets/file.env"
      env         = true
      data = <<EOH
      {{with secret "kv/relay-registry/live"}}
        ETH_PRIVATE_KEY="{{.Data.data.RELAY_REGISTRY_OWNER_KEY}}"
      {{end}}
      EOH
    }
  }
}
