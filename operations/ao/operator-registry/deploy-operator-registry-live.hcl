job "operator-registry-live" {
  datacenters = [ "ator-fin" ]
  type = "batch"
  namespace = "live-protocol"

  constraint {
    attribute = "${meta.pool}"
    value = "live-protocol"
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
      image = "ghcr.io/anyone-protocol/smart-contracts-ao-mainnet:32b9f2382e1f84c0f0ee65b4ff54c4dd4cef9264@sha256:7b2fa8568643f25575658a88998589ee75d1b046378219fc4ad7964409b8e508"

      entrypoint = ["bun"]
      command = "run"
      args = ["scripts/deploy.ts", "operator-registry", "--seed", "current", "--envelope", "seeds/live-operator-registry.envelope.json"]

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

      # The durable module id. This is the id published from the STAGE publish job and already
      # running on stage — deliberately reused rather than republished under the live key.
      #
      # A module id is the id of the SIGNED item, so publishing identical bytes under the live
      # key would mint a different id for the same module. Reusing gains two things: live runs
      # bytes that have been settling rounds on stage since 2026-08-11, and the id is directly
      # comparable across environments. The signer holds no authority over a published module,
      # so nothing is given up by it being the stage key.
      #
      # deploy.ts refuses an id that is not indexed on Arweave: a node-local id lives in one
      # alloc's cache, and a process spawned against it can never compute a slot anywhere else.
      MODULE_ID = "2vWsI194X4gmK66fhWQdRsBnQJIoG8nFBqnSazW_cgA"

      # deploy.ts writes the PID here itself, then verifies the seeded state and restores the
      # previous value if that fails.
      CONSUL_IP = "127.0.0.1"
      CONSUL_PORT = "8500"
      CONTRACT_CONSUL_KEY = "smart-contracts/live/operator-registry-address"
    }

    template {
      destination = "secrets/file.env"
      env         = true
      data = <<-EOH
      {{- with secret "kv/live-protocol/operator-registry-live" }}
      DEPLOYER_PRIVATE_KEY="{{.Data.data.OPERATOR_REGISTRY_OWNER_KEY}}"
      CONSUL_TOKEN="{{.Data.data.CONSUL_TOKEN}}"
      {{- end }}
      {{- range service "loki" }}
      LOKI_URL="http://{{ .Address }}:{{ .Port }}/loki/api/v1/push"
      {{- end }}
      {{- range service "hyperbeam-live-node" }}
      HB_URL="http://{{ .Address }}:{{ .Port }}"
      {{- end }}
      EOH
    }
  }
}
