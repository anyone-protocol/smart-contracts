job "eval-operator-registry-live" {
  datacenters = [ "ator-fin" ]
  type = "batch"
  namespace = "live-protocol"

  constraint {
    attribute = "${meta.pool}"
    value = "live-protocol"
  }

  reschedule { attempts = 0 }

  task "operator-registry-live" {
    env {
      SCRIPT = "scripts/operator-registry/eval.ts"
      PHASE = "live"
      CU_URL="https://cu.ao-testnet.xyz"
      EVAL_CODE_PATH="src/patches/patch-operator-registry-live.lua"
    }

    driver = "docker"

    config {
      network_mode = "host"
      image = "ghcr.io/anyone-protocol/smart-contracts-ao:833756013ac7f67bc6eecd792b1e0f3bcd07c9b0"
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
      {{- with secret "kv/live-protocol/operator-registry-live" }}
      ETH_PRIVATE_KEY="{{ .Data.data.OPERATOR_REGISTRY_OWNER_KEY }}"
      {{- end }}
      EOH
    }

    template {
      destination = "local/config.env"
      env         = true
      data = <<EOH
      PROCESS_ID="{{ key `smart-contracts/live/operator-registry-address` }}"
      EOH
    }
  }
}
