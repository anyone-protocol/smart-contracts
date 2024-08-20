job "deploy-distribution-live" {
    datacenters = ["ator-fin"]
    type = "batch"

    reschedule {
        attempts = 0
    }

    task "deploy-distribution-task" {
        driver = "docker"

        config {
            network_mode = "host"
            image = "ghcr.io/ator-development/smart-contracts:0.3.1"
            entrypoint = ["npm"]
            command = "run"
            args = ["deploy"]
            volumes = [
                "local/distribution-init-state.json:/usr/src/app/smartweave/dist/contracts/distribution-init-state.json"
            ]
        }

        vault {
            policies = ["distribution-live"]
        }

        template {
            data = <<EOH
            {{with secret "kv/distribution/live"}}
                DEPLOYER_PRIVATE_KEY="{{.Data.data.DISTRIBUTION_OWNER_KEY}}"
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
    "claimable":{},
    "owner":"{{.Data.data.DISTRIBUTION_OWNER_ADDRESS}}",
    "pendingDistributions":{},
    "previousDistributions":{},
    "tokensDistributedPerSecond":"62800000000000000"
}

            {{end}}
            EOH
            destination = "local/distribution-init-state.json"
            env         = false
        }

        env {
            PHASE="live"
            CONSUL_IP="127.0.0.1"
            CONSUL_PORT="8500"
            CONTRACT_CONSUL_KEY="smart-contracts/live/distribution-address"
            CONTRACT_SOURCE_CONSUL_KEY="smart-contracts/live/distribution-source"
            CONTRACT_SRC="../dist/contracts/distribution.js"
            INIT_STATE="../dist/contracts/distribution-init-state.json"
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
