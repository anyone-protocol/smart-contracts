job "evolve-relay-registry-stage" {
    datacenters = ["ator-fin"]
    type = "batch"

    reschedule {
        attempts = 0
    }

    task "deploy-relay-registry-task" {
        driver = "docker"

        config {
            network_mode = "host"
            image = "ghcr.io/ator-development/smart-contracts:0.3.2"
            entrypoint = ["npm"]
            command = "run"
            args = ["evolve"]
        }

        vault {
            policies = ["relay-registry-stage"]
        }

        template {
            data = <<EOH
            {{with secret "kv/relay-registry/stage"}}
                DEPLOYER_PRIVATE_KEY="{{.Data.data.RELAY_REGISTRY_OWNER_KEY}}"
                CONSUL_TOKEN="{{.Data.data.CONSUL_TOKEN}}"
            {{end}}
            EOH
            destination = "secrets/file.env"
            env         = true
        }

        env {
            PHASE="stage"
            CONSUL_IP="127.0.0.1"
            CONSUL_PORT="8500"
            CONTRACT_CONSUL_KEY="smart-contracts/stage/relay-registry-address"
            CONTRACT_SOURCE_CONSUL_KEY="smart-contracts/stage/relay-registry-source"
            CONTRACT_SRC="../dist/contracts/relay-registry.js"
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
