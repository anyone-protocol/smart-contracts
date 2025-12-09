job "staking-rewards-stage" {
  datacenters = [ "ator-fin" ]
  type = "batch"
  namespace = "stage-protocol"

  constraint {
      attribute = "${meta.pool}"
      value = "stage"
  }

  reschedule { attempts = 0 }

  task "deploy-staking-rewards-task" {
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
      image = "ghcr.io/anyone-protocol/smart-contracts-ao:c759cf551b9329405716c09d447833e0e15a9976"
      entrypoint = ["npm"]
      command = "run"
      args = ["deploy"]
      logging {
        type = "loki"
        config {
          loki-url = "http://10.1.3.1:3100/loki/api/v1/push"
          loki-external-labels = "container_name={{.Name}},job_name=${NOMAD_JOB_NAME}"
        }
      }
    }

    vault { role = "any1-nomad-workloads-controller" }

    consul {}

    env {
      PHASE = "stage"
      CONSUL_IP = "127.0.0.1"
      CONSUL_PORT = "8500"
      CONTRACT_CONSUL_KEY = "smart-contracts/stage/staking-rewards-address"
      CONTRACT_NAME = "staking-rewards"
      CU_URL="https://cu-stage.anyone.tech"

      ## NB: Spawn a new process & migrate state from an existing one
      ##     Set MIGRATION_SOURCE_PROCESS_ID in template below to the
      ##     existing process ID to migrate from
      IS_MIGRATION_DEPLOYMENT = "true"

      ## NB: Call Init with data from file at INIT_DATA_PATH
      # CALL_INIT_HANDLER="true"
    }

    template {
      data = <<-EOF
      MIGRATION_SOURCE_PROCESS_ID={{ key "smart-contracts/stage/staking-rewards-address" }}
      EOF
      destination = "local/config.env"
      env = true
    }

    template {
      destination = "secrets/file.env"
      env         = true
      data = <<-EOH
      {{- with secret "kv/stage-protocol/staking-rewards-stage" }}
      DEPLOYER_PRIVATE_KEY="{{.Data.data.ETH_ADMIN_KEY}}"
      CONSUL_TOKEN="{{.Data.data.CONSUL_TOKEN}}"
      {{- end }}
      EOH
    }
  }
}
