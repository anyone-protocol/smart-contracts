job "operator-registry-update-roles-stage" {
  datacenters = [ "ator-fin" ]
  type = "batch"

  reschedule { attempts = 0 }

  task "operator-registry-update-roles-stage-task" {
    driver = "docker"

    restart {
      attempts = 0
      mode     = "fail"
    }

    resources {
      cpu    = 4096
      memory = 4096
    }

    vault { policies = [ "relay-registry-stage" ] }

    config {
      network_mode = "host"
      image = "ghcr.io/anyone-protocol/smart-contracts-ao:stage"
      entrypoint = ["npx"]
      command = "tsx"
      args = ["scripts/acl/update-roles.ts"]
    }

    env {
      PHASE = "stage"
      PROCESS_ID=""
      UPDATE_ROLES_DATA=""
    }

    template {
      destination = "secrets/file.env"
      env         = true
      data = <<EOH
      {{with secret "kv/relay-registry/stage"}}
        ETH_PRIVATE_KEY="{{.Data.data.RELAY_REGISTRY_OWNER_KEY}}"
      {{end}}
      EOH
    }
  }
}
