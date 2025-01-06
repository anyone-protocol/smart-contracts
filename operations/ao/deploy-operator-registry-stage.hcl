job "deploy-operator-registry-stage" {
  datacenters = [ "ator-fin" ]
  type = "batch"

  reschedule { attempts = 0 }

  task "deploy-operator-registry-task" {
    driver = "docker"

    restart {
      attempts = 0
      mode     = "fail"
    }

    resources {
      cpu    = 4096
      memory = 4096
    }

    config {
      network_mode = "host"
      image = "ghcr.io/anyone-protocol/smart-contracts-ao:e65a0c0e473f8cec1bd2fed53a35c0e41a6f395b"
      entrypoint = ["npm"]
      command = "run"
      args = ["deploy"]
      volumes = [
        "local/operator-registry-init-state.json:/usr/src/app/ao/dist/operator-registry-init-state.json"
      ]
    }

    vault { policies = [ "relay-registry-stage" ] }

    env {
      PHASE = "stage"
      CONSUL_IP = "127.0.0.1"
      CONSUL_PORT = "8500"
      CONTRACT_NAME = "operator-registry"
      CONTRACT_CONSUL_KEY = "smart-contracts/stage/operator-registry-address"
      CONTRACT_SOURCE_CONSUL_KEY = "smart-contracts/stage/operator-registry-source"
    }

    template {
      destination = "secrets/file.env"
      env         = true
      data = <<EOH
      {{with secret "kv/relay-registry/stage"}}
        DEPLOYER_PRIVATE_KEY="{{.Data.data.RELAY_REGISTRY_OWNER_KEY}}"
        CONSUL_TOKEN="{{.Data.data.CONSUL_TOKEN}}"
      {{end}}
      EOH
    }

    template {
      destination = "local/operator-registry-init-state.json"
      env         = false
      data = <<EOH
      {{with secret "kv/relay-registry/stage"}}
        {
          "claimable":{},
          "owner":"{{.Data.data.RELAY_REGISTRY_OWNER_ADDRESS}}",
          "verified":{},
          "registrationCredits":{},
          "blockedAddresses":[],
          "families":{}
        }
      {{end}}
      EOH
    }
  }
}
