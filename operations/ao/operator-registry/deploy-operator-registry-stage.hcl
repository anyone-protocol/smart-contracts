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
      image = "ghcr.io/anyone-protocol/smart-contracts-ao-mainnet:e6ba945a9bdac3b4db3869bb67dd0fe5855e332f@sha256:4e767164d492a8405b7cd1a7bc0ae202a06523a9d553dea1d86699e52d02cc4a"

      entrypoint = ["bun"]
      command = "run"
      args = ["scripts/deploy.ts", "operator-registry", "--seed", "current", "--envelope", "seeds/stage-operator-registry.envelope.json"]

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
      # HB_URL is NOT here: an `env` block does not run through consul-template, so a service
      # lookup written here would reach the process as a literal `{{ range ... }}` string. It is
      # rendered in the template block below instead.

      # The durable module id, published from this contract's module.
      # deploy.ts refuses an id that is not indexed on Arweave: a node-local id lives in one
      # alloc's cache, and a process spawned against it can never compute a slot anywhere else.
      MODULE_ID = "ERlyEXrEBxKjmcNXZUmeVvIGn2C4sMhq5lYM4csIvAU"

      # deploy.ts writes the PID here itself, then verifies the seeded state and restores the
      # previous value if that fails.
      CONSUL_IP = "127.0.0.1"
      CONSUL_PORT = "8500"
      CONTRACT_CONSUL_KEY = "smart-contracts/stage/operator-registry-address"
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
      {{- range service "hyperbeam-stage-node" }}
      HB_URL="http://{{ .Address }}:{{ .Port }}"
      {{- end }}
      EOH
    }
  }
}
