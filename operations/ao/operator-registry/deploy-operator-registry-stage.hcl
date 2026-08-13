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
      # TODO: pin the commit that built this image before running.
      image = "ghcr.io/anyone-protocol/smart-contracts-ao-mainnet:0e1566bf8bb0cf4627e7f9ca2aee6456b5540384@sha256:c1bf2ff575f5a2901f34383c02b61418dbd9f47abc6b50cee1746d51c416c4f0"

      entrypoint = ["bun"]
      command = "run"
      args = ["scripts/deploy.ts", "operator-registry", "--seed", "stage"]

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

    # The legacy PHASE / CU_URL / CONTRACT_NAME / IS_MIGRATION_DEPLOYMENT / CALL_INIT_HANDLER
    # vars are gone with the runtime they configured. There is no CU, and migration is no longer
    # a read from a live source process: the seed is built from the 2026-07-09 legacynet dump and
    # rides the spawn message, selected by `--seed` above.
    env {
      # HB_URL is NOT here: an `env` block does not run through consul-template, so a service
      # lookup written here would reach the process as a literal `{{ range ... }}` string. It is
      # rendered in the template block below instead.

      # TODO: the durable module id, from publishing this contract's module.
      # deploy.ts refuses an id that is not indexed on Arweave: a node-local id lives in one
      # alloc's cache, and a process spawned against it can never compute a slot anywhere else.
      MODULE_ID = "2vWsI194X4gmK66fhWQdRsBnQJIoG8nFBqnSazW_cgA"

      # deploy.ts writes the PID here itself, but only after the seed diff AND the write-gate
      # checks pass — so an id the gate cannot read never reaches what the hyperbeam jobspecs
      # template gated-processes from.
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
