job "operator-registry-stage" {
  datacenters = [ "ator-fin" ]
  type = "batch"
  namespace = "stage-protocol"

  constraint {
    attribute = "${meta.pool}"
    value = "stage"
  }

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
      image = "ghcr.io/anyone-protocol/smart-contracts-ao:ce3d635cbe88f16563720d39dd2073d1c5bd9053"

      entrypoint = ["npm"]
      command = "run"
      args = ["deploy"]

      logging {
        type = "loki"
        config {
          loki-url = "${LOKI_URL}"
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
      CONTRACT_CONSUL_KEY = "smart-contracts/stage/operator-registry-address"
      CONTRACT_NAME = "operator-registry"
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
      MIGRATION_SOURCE_PROCESS_ID={{ key "smart-contracts/stage/operator-registry-address" }}
      EOF
      destination = "local/config.env"
      env = true
    }

    template {
      destination = "secrets/file.env"
      env         = true
      data = <<-EOH
      {{- with secret "kv/stage-protocol/operator-registry-stage" }}
      DEPLOYER_PRIVATE_KEY="{{.Data.data.OPERATOR_REGISTRY_OWNER_KEY}}"
      CONSUL_TOKEN="{{.Data.data.CONSUL_TOKEN}}"
      {{- end }}
      {{- range service "loki" }}
      LOKI_URL="http://{{ .Address }}:{{ .Port }}/loki/api/v1/push"
      {{- end }}
      EOH
    }
  }
}
