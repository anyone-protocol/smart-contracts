job "relay-rewards-admin-live" {
  datacenters = [ "ator-fin" ]
  type = "batch"
  namespace = "live-protocol"

  constraint {
    attribute = "${meta.pool}"
    value = "live-protocol"
  }

  reschedule { attempts = 0 }

  task "relay-rewards-live" {
    env {
      SCRIPT = ""
      # Script data - stringified JSON
      # UPDATE_ROLES_DATA=""

      PHASE = "live"
      CU_URL="https://cu.anyone.tech"
    }

    driver = "docker"

    config {
      network_mode = "host"
      image = "ghcr.io/anyone-protocol/smart-contracts-ao:bec6cf978246be973f9c0848e81e4ca0fe884c98"
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

    vault { role = "any1-nomad-workloads-owner" }

    template {
      destination = "secrets/keys.env"
      env         = true
      data = <<-EOH
      {{- with secret "kv/live-protocol/relay-rewards-live"}}
      ETH_PRIVATE_KEY="{{.Data.data.ETH_ADMIN_KEY}}"
      {{- end }}
      EOH
    }

    template {
      destination = "local/config.env"
      env         = true
      data = <<-EOH
      PROCESS_ID="{{ key `smart-contracts/live/relay-rewards-address` }}"
      EOH
    }
  }
}
