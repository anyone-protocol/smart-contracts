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
      # ⚠️ REPIN REQUIRED, not optional. The previous pin predated BOTH deploy-order fixes
      # (2814394 publish-PID-before-verify, 248aa91 defer the forced first compute), so a deploy
      # from it deadlocks on a gated node - the opreg wedge of 2026-09-02.
      image = "ghcr.io/anyone-protocol/smart-contracts-ao-mainnet:48c12f5fa2c4da5854aebf68734cbe7dc4860ede@sha256:f2f4f96521a79472dd04b3c18b677f1857af27319d95950eb747ec5d03a3a9ab"
      entrypoint = ["bun"]
      command = "run"
      # --previous-round 0 makes the FIRST round pay nothing: the pot is
      # TokensPerSecond * (roundTimestamp - PreviousRound.Timestamp), and the dump carries
      # legacynet's 2026-07-03 date, which is what paid a 48-day round at the cutover.
      args = ["scripts/deploy.ts", "relay-rewards", "--seed", "stage", "--previous-round", "0"]
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

      # The durable module id, published from this contract's module and reused by live.
      # deploy.ts refuses an id that is not indexed on Arweave: a node-local id lives in one
      # alloc's cache, and a process spawned against it can never compute a slot anywhere else.
      MODULE_ID = "kTf0r-R_MxizLz3_9S0zSM7G8nGURL9qF-Hplnl8-Eo"

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
