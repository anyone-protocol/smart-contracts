job "deploy-relay-registry-dev" {
    datacenters = ["ator-fin"]
    type = "batch"

    reschedule {
        attempts = 0
    }

    task "deploy-relay-registry-task" {
        driver = "docker"

        config {
            network_mode = "host"
            image = "ghcr.io/ator-development/smart-contracts:0.2.11"
            entrypoint = ["npm"]
            command = "run"
            args = ["deploy"]
            volumes = [
                "local/relay-registry-init-state.json:/usr/src/app/smartweave/dist/contracts/relay-registry-init-state.json"
            ]
        }

        vault {
            policies = ["relay-registry-dev"]
        }

        template {
            data = <<EOH
            {{with secret "kv/relay-registry/dev"}}
                DEPLOYER_PRIVATE_KEY="{{.Data.data.RELAY_REGISTRY_OWNER_KEY}}"
                CONSUL_TOKEN="{{.Data.data.CONSUL_TOKEN}}"
            {{end}}
            EOH
            destination = "secrets/file.env"
            env         = true
        }

        template {
            data = <<EOH
            {{with secret "kv/relay-registry/dev"}}
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
            destination = "local/relay-registry-init-state.json"
            env         = false
        }

        env {
            PHASE="dev"
            CONSUL_IP="127.0.0.1"
            CONSUL_PORT="8500"
            CONTRACT_CONSUL_KEY="smart-contracts/dev/relay-registry-address"
            CONTRACT_SOURCE_CONSUL_KEY="smart-contracts/dev/relay-registry-source"
            CONTRACT_SRC="../dist/contracts/relay-registry.js"
            INIT_STATE="../dist/contracts/relay-registry-init-state.json"
        }

        restart {
            attempts = 0
            mode = "fail"
        }

        resources {
            cpu    = 4096
            memory = 4096
        }
    }
}
