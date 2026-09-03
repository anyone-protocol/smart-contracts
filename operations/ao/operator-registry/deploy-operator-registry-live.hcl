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
      # Pinned to 32b9f23, which fixes BOTH layers of the same deploy-order deadlock. The
      # write gate makes verification impossible for a pid that is not yet published: the reads
      # are UNSIGNED, unsigned reads are free only for pids already in `p4-non-chargable-routes`,
      # and that list templates from the very Consul key being held back. A freshly spawned pid
      # therefore always 400s "Node will not service this request".
      #   layer 1 (2814394) — the CALLER verified before publishing. It now publishes, waits for
      #     the node to re-render and restart onto the new pid, verifies, and REVERTS the key on
      #     any failure, so a bad id never outlives the run. Measured on stage 2026-08-31.
      #   layer 2 (32b9f23) — `spawnProcess` ALSO forced a first compute of its own, via the same
      #     unsigned `now/at-slot` read, so the spawn died before the key was ever written. That
      #     read is now deferred (`verify: false`); `materialize()` drives slot 0 afterwards,
      #     once the route exists. Measured on stage 2026-09-01.
      # Do not re-pin below this commit without restoring BOTH.
      # ⚠️ THERE IS NO SAFE ROLLBACK TARGET. Every earlier image carries at least one of the two
      # layers above, so a deploy from one cannot complete a spawn on a gated node:
      #   2814394 @sha256:7287ea8041fa517fc4781ceda167dd7ac19097949c15a095d0cc99d35a23cfb3
      #     fixes layer 1 only — the spawn still dies on its own forced first compute.
      #   0e1566b @sha256:c1bf2ff575f5a2901f34383c02b61418dbd9f47abc6b50cee1746d51c416c4f0
      #     carries BOTH deadlocks.
      # If this pin fails, fix forward. Rolling back only reproduces a failure we have already
      # measured twice.
      image = "ghcr.io/anyone-protocol/smart-contracts-ao-mainnet:32b9f2382e1f84c0f0ee65b4ff54c4dd4cef9264@sha256:7b2fa8568643f25575658a88998589ee75d1b046378219fc4ad7964409b8e508"

      entrypoint = ["bun"]
      command = "run"
      args = ["scripts/deploy.ts", "operator-registry", "--seed", "live"]

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

      # deploy.ts writes the PID here itself, but only after the seed diff AND the write-gate
      # checks pass — so an id the gate cannot read never reaches what the hyperbeam jobspecs
      # template gated-processes from.
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
