job "relay-rewards-stage" {
  datacenters = [ "ator-fin" ]
  type = "batch"
  namespace = "stage-protocol"

  constraint {
      attribute = "${meta.pool}"
      value = "stage"
  }

  reschedule { attempts = 0 }

  task "deploy-relay-rewards-task" {
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
      image = "ghcr.io/anyone-protocol/smart-contracts-ao-mainnet:081d81e01d7d5d9498235115fb6b8e475812c4aa@sha256:3f74b2b6b0b509a6ac9b73dd210b90a61dc004b3109d2528e625ed8b28c78eba"
      entrypoint = ["bun"]
      command = "run"
      args = ["scripts/deploy.ts", "relay-rewards", "--seed", "stage"]
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
      MODULE_ID = "2NkHWA1fhkpTCIFXnCYf6qGmD-GE271wKRfISDGD-OU"

      # deploy.ts writes the PID here itself, but only after the seed diff AND the write-gate
      # checks pass — so an id the gate cannot read never reaches what the hyperbeam jobspecs
      # template gated-processes from.
      CONSUL_IP = "127.0.0.1"
      CONSUL_PORT = "8500"
      CONTRACT_CONSUL_KEY = "smart-contracts/stage/relay-rewards-address"
    }

    template {
      destination = "secrets/file.env"
      env         = true
      data = <<-EOH
      {{- with secret "kv/stage-protocol/relay-rewards-stage" }}
      DEPLOYER_PRIVATE_KEY="{{.Data.data.ETH_ADMIN_KEY}}"
      CONSUL_TOKEN="{{.Data.data.CONSUL_TOKEN}}"
      {{- end }}
      {{- range service "hyperbeam-stage-node" }}
      HB_URL="http://{{ .Address }}:{{ .Port }}"
      {{- end }}
      EOH
    }
  }
}
