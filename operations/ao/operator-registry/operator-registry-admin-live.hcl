job "operator-registry-admin-live" {
  datacenters = [ "ator-fin" ]
  namespace = "live-protocol"
  type = "batch"

  constraint {
    attribute = "${meta.pool}"
    value = "live-protocol"
  }

  reschedule { attempts = 0 }

  task "operator-registry-admin-live-task" {

    env {
      PHASE = "live"
      SCRIPT = "scripts/operator-registry/eval.ts"
      CU_URL="https://cu.anyone.permaweb.services"
      EVAL_CODE="OperatorRegistry.RegistrationCreditsRequired = false"
    }

    driver = "docker"

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

    config {
      network_mode = "host"
      image = "ghcr.io/anyone-protocol/smart-contracts-ao:1a95b84f158e202a542cc4fd318ff19ac641c923"
      entrypoint = ["npx"]
      command = "tsx"
      args = ["${SCRIPT}"]
      # logging {
      #   type = "loki"
      #   config {
      #     loki-url = "http://10.1.3.1:3100/loki/api/v1/push"
      #     loki-external-labels = "container_name={{.Name}},job_name=${NOMAD_JOB_NAME}"
      #   }
      # }
    }

    template {
      destination = "local/config.env"
      env         = true
      data = <<-EOH
      PROCESS_ID="{{ key `smart-contracts/live/operator-registry-address` }}"
      EOH
    }

    template {
      destination = "secrets/file.env"
      env         = true
      data = <<-EOH
      {{- with secret "kv/live-protocol/operator-registry-admin-live" }}
      ETH_PRIVATE_KEY="{{ .Data.data.OPERATOR_REGISTRY_OWNER_KEY }}"
      {{- end}}
      EOH
    }
  }
}
