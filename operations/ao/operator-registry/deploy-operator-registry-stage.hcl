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
      image = "ghcr.io/anyone-protocol/smart-contracts-ao:f82f72fbb628351f4af8c7e36f9ab45d7fe188f1"
      entrypoint = ["npm"]
      command = "run"
      args = ["deploy"]
      volumes = [
        "local/operator-registry-init-state.json:/usr/src/app/ao/dist/operator-registry-init-state.json"
      ]
      logging {
        type = "loki"
        config {
          loki-url = "${LOKI_URL}"
          loki-external-labels = "container_name={{.Name}},job_name=${NOMAD_JOB_NAME}"
        }
      }
    }

    vault {
        role = "any1-nomad-workloads-controller"
    }

    consul {}

    env {
      PHASE = "stage"
      CONSUL_IP = "127.0.0.1"
      CONSUL_PORT = "8500"
      CONTRACT_NAME = "operator-registry"
      CONTRACT_CONSUL_KEY = "smart-contracts/stage/operator-registry-address"
      CONTRACT_SOURCE_CONSUL_KEY = "smart-contracts/stage/operator-registry-source"
      IS_MIGRATION_DEPLOYMENT = "false"
      MIGRATION_SOURCE_PROCESS_ID = ""
      CU_URL="https://cu-stage.anyone.tech"
    }

    template {
      destination = "secrets/file.env"
      env         = true
      data = <<-EOH
      {{with secret "kv/stage-protocol/operator-registry-stage"}}
        DEPLOYER_PRIVATE_KEY="{{.Data.data.OPERATOR_REGISTRY_OWNER_KEY}}"
        CONSUL_TOKEN="{{.Data.data.CONSUL_TOKEN}}"
      {{end}}

      {{ range service "loki" }}
      LOKI_URL="http://{{ .Address }}:{{ .Port }}/loki/api/v1/push"
      {{ end }}
      EOH
    }

    template {
      destination = "local/operator-registry-init-state.json"
      env         = false
      data = <<-EOH
      {}
      EOH
    }
  }
}
