job "eval-operator-registry-stage" {
  datacenters = [ "ator-fin" ]
  type = "batch"
  namespace = "stage-protocol"

  constraint {
    attribute = "${meta.pool}"
    value = "stage"
  }

  reschedule { attempts = 0 }

  task "operator-registry-stage" {
    env {
      SCRIPT = "scripts/operator-registry/eval.ts"
      PHASE = "stage"
      CU_URL="https://cu-stage.anyone.tech"
      EVAL_CODE_PATH="src/patches/operator-registry-patch-stage-2025-09-24.lua"
    }

    driver = "docker"

    config {
      network_mode = "host"
      image = "ghcr.io/anyone-protocol/smart-contracts-ao:c749aa63068a35ac8fc9326d9b083083384c6346"
      entrypoint = ["npx"]
      command = "tsx"
      args = ["${SCRIPT}"]
      logging {
        type = "loki"
        config {
          loki-url = "http://10.1.3.1:3100/loki/api/v1/push"
          loki-external-labels = "container_name={{.Name}},job_name=${NOMAD_JOB_NAME}"
        }
      }
    }

    restart {
      attempts = 0
      mode     = "fail"
    }

    resources {
      cpu    = 4096
      memory = 4096
    }

    consul {}

    vault {
      role = "any1-nomad-workloads-owner"
    }

    template {
      destination = "secrets/keys.env"
      env         = true
      data = <<-EOH
      {{- with secret "kv/stage-protocol/operator-registry-stage" }}
      ETH_PRIVATE_KEY="{{ .Data.data.OPERATOR_REGISTRY_OWNER_KEY }}"
      {{- end }}
      EOH
    }

    template {
      destination = "local/config.env"
      env         = true
      data = <<EOH
      PROCESS_ID="{{ key `smart-contracts/stage/operator-registry-address` }}"
      EOH
    }
  }
}
