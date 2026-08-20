job "relay-rewards-live" {
  datacenters = [ "ator-fin" ]
  type = "batch"
  namespace = "live-protocol"

  constraint {
    attribute = "${meta.pool}"
    value = "live-protocol"
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
      # Pinned to 48d4cb5 (2026-08-20). Carries the HARDENED `assertModuleIsDurable`: a module id
      # must be indexed, its containing bundle mined, >=50 confirmations deep, and its bytes must
      # sha256-MATCH the bundle this image builds. Safe to repin because 8e02154..48d4cb5 changed
      # ZERO Lua — only TypeScript tooling, docs and jobspecs — so this image builds byte-identical
      # bundles to the one that published the modules below, and the new check still passes.
      # Rollback: 8e02154 @sha256:0998cdc00a8d965bb7c1f2ffeafb83fa477d9f8c5d725c3e6f58a3bb76fdb7a0
      image = "ghcr.io/anyone-protocol/smart-contracts-ao-mainnet:48d4cb5a2dd59498489441d3f15294ecd2f53658@sha256:893fdecab1a7dc78642598cf962bb4ba22407a181a5b5048195af4749af53d4a"
      entrypoint = ["bun"]
      command = "run"
      args = ["scripts/deploy.ts", "relay-rewards", "--seed", "live"]
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
      MODULE_ID = "kTf0r-R_MxizLz3_9S0zSM7G8nGURL9qF-Hplnl8-Eo"

      # deploy.ts writes the PID here itself, but only after the seed diff AND the write-gate
      # checks pass — so an id the gate cannot read never reaches what the hyperbeam jobspecs
      # template gated-processes from.
      CONSUL_IP = "127.0.0.1"
      CONSUL_PORT = "8500"
      CONTRACT_CONSUL_KEY = "smart-contracts/live/relay-rewards-address"
    }

    template {
      destination = "secrets/file.env"
      env         = true
      data = <<-EOH
      {{- with secret "kv/live-protocol/relay-rewards-live" }}
      DEPLOYER_PRIVATE_KEY="{{.Data.data.ETH_ADMIN_KEY}}"
      CONSUL_TOKEN="{{.Data.data.CONSUL_TOKEN}}"
      {{- end }}
      {{- range service "hyperbeam-live-node" }}
      HB_URL="http://{{ .Address }}:{{ .Port }}"
      {{- end }}
      EOH
    }
  }
}
