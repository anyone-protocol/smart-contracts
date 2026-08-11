job "staking-rewards-stage" {
  datacenters = [ "ator-fin" ]
  type = "batch"
  namespace = "stage-protocol"

  constraint {
    attribute = "${meta.pool}"
    value = "stage"
  }

  reschedule { attempts = 0 }

  task "deploy-staking-rewards-task" {
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
      image = "ghcr.io/anyone-protocol/smart-contracts-ao-mainnet:d6e137a7104b16c1955c9a5db737de5c27ce77d9@sha256:35af094c450f9d602932ca50d5b0f6821930a393fc789017d67458726188ca57"
      entrypoint = ["bun"]
      command = "run"
      args = ["scripts/deploy.ts", "staking-rewards", "--seed", "stage"]
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
      # Our own node. The client has no default — falling back to a public endpoint is the
      # failure it exists to prevent.
      HB_URL = "https://hb-stage.anyone.tech"

      # TODO: the durable module id, from publishing this contract's module.
      # deploy.ts refuses an id that is not indexed on Arweave: a node-local id lives in one
      # alloc's cache, and a process spawned against it can never compute a slot anywhere else.
      MODULE_ID = "aV5R_U1R-saSd3_ozxA98XooZ-KSfgE_uivOhOrHdEw"

      # deploy.ts writes the PID here itself, but only after the seed diff AND the write-gate
      # checks pass — so an id the gate cannot read never reaches what the hyperbeam jobspecs
      # template gated-processes from.
      CONSUL_IP = "127.0.0.1"
      CONSUL_PORT = "8500"
      CONTRACT_CONSUL_KEY = "smart-contracts/stage/staking-rewards-address"
    }

    template {
      destination = "secrets/file.env"
      env         = true
      data = <<-EOH
      {{- with secret "kv/stage-protocol/staking-rewards-stage" }}
      DEPLOYER_PRIVATE_KEY="{{.Data.data.ETH_ADMIN_KEY}}"
      CONSUL_TOKEN="{{.Data.data.CONSUL_TOKEN}}"
      {{- end }}
      EOH
    }
  }
}
