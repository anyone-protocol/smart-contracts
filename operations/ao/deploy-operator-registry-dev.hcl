job "deploy-operator-registry-dev" {
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
            image = "ghcr.io/anyone-protocol/smart-contracts-ao:stage"
            entrypoint = ["npm"]
            command = "run"
            args = ["deploy"]
            // volumes = [
            //     "local/relay-registry-init-state.json:/usr/src/app/smartweave/dist/contracts/relay-registry-init-state.json"
            // ]
        }

        vault { policies = [ "relay-registry-dev" ] }

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

//         template {
//             data = <<EOH
//             {{with secret "kv/relay-registry/dev"}}
// {
//     "claimable":{},
//     "owner":"{{.Data.data.RELAY_REGISTRY_OWNER_ADDRESS}}",
//     "verified":{},
//     "registrationCredits":{},
//     "blockedAddresses":[],
//     "families":{}
// }
//             {{end}}
//             EOH
//             destination = "local/relay-registry-init-state.json"
//             env         = false
//         }

        env {
            PHASE = "dev"
            CONSUL_IP = "127.0.0.1"
            CONSUL_PORT = "8500"
            CONTRACT_NAME="operator-registry"
            CONTRACT_CONSUL_KEY="smart-contracts/dev/operator-registry-address"
        }
    }
}
