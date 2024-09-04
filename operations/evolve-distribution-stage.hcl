job "deploy-distribution-stage" {
    datacenters = ["ator-fin"]
    type = "batch"

    reschedule {
        attempts = 0
    }

    task "deploy-distribution-task" {
        driver = "docker"

        config {
            network_mode = "host"
            image = "ghcr.io/anyone-protocol/smart-contracts:0.3.4"
            entrypoint = ["npm"]
            command = "run"
            args = ["evolve"]
        }

        vault {
            policies = ["distribution-stage"]
        }

        template {
            data = <<EOH
            {{with secret "kv/distribution/stage"}}
                DEPLOYER_PRIVATE_KEY="{{.Data.data.DISTRIBUTION_OWNER_KEY}}"
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
            CONTRACT_CONSUL_KEY="smart-contracts/stage/distribution-address"
            CONTRACT_SOURCE_CONSUL_KEY="smart-contracts/stage/distribution-source"
            CONTRACT_SRC="../dist/contracts/distribution.js"
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
