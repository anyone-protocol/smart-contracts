# Publish modules to Arweave.
#
# One job for all of them, configured by editing the args list below: comment out what you are
# not publishing. publish-module.ts takes any number of files and prints an id per file, so a
# single run produces every id you then need to pin.
#
# Run:
#   nomad job run publish-modules-stage.hcl
#   nomad alloc logs <alloc-id>
#
# ⚠️ RUN ONE OF THESE, NOT ALL THREE. The three jobs exist because Vault scopes a secret to
# `kv/<namespace>/<job-id>`, so publishing from a given network needs a job in that namespace —
# not because each environment needs its own modules. The id is the SIGNED item id, so the same
# bytes signed by three different keys produce THREE DIFFERENT IDs for identical source, and
# "dev, stage and live run the same module" stops being visible at a glance. Publish once, then
# pin that single id in all three environments.
#
# ─── What gets pinned where ─────────────────────────────────────────────────────────────────
#   write-gate         -> `module` in the hyperbeam jobspecs (infra-arweave)
#   <contract>-native  -> MODULE_ID in that contract's deploy job
#
# Neither is a Consul key. A module id is content-addressed and already a permanent version sha,
# so pinning it in git makes what is running reviewable, and removes the failure where a missing
# key renders empty into a device that fails closed.
#
# ─── Why publish at all ─────────────────────────────────────────────────────────────────────
# The node-local route (`bin/hb eval`) produces an id that exists in ONE alloc's cache. A process
# spawned against it can never compute a slot elsewhere, and a gate module a node cannot resolve
# refuses every write, because it fails closed. deploy.ts refuses an unindexed id for exactly
# this reason.
#
# ⚠️ A bundler 200 is a QUEUE RECEIPT, not persistence, and the gateway's data endpoint serves
# unsettled items from an optimistic cache — `curl arweave.net/<id>` will 200 for an item that
# never lands. publish-module.ts only trusts the GraphQL index, and --wait blocks on it.
#
# ⚠️ The id is the SIGNED ans104 item id, so it depends on the signing wallet as well as the
# bytes. Republishing identical source with a different wallet yields a DIFFERENT id.
#
# ⚠️ The contract bundles are built INTO the image (Dockerfile-Mainnet), so what gets signed is
# pinned by the image digest. The seed is not part of them — it rides the spawn message — so one
# published id serves dev, stage and live alike.

job "publish-modules-stage" {
  datacenters = [ "ator-fin" ]
  type = "batch"
  namespace = "stage-protocol"

  constraint {
    attribute = "${meta.pool}"
    value = "stage"
  }

  reschedule { attempts = 0 }

  task "publish-modules-stage" {
    env {
      SCRIPT = "scripts/publish-module.ts"

      # No default in the script either: which bundler carries our modules is a decision, not a
      # fallback.
      BUNDLER = "https://up.arweave.net"
    }

    driver = "docker"

    config {
      network_mode = "host"

      # TODO: pin the commit that built this image before running.
      # Actions -> "Build & Publish AO Mainnet Contracts Image" -> Run workflow -> pick the
      # branch; it tags by commit SHA. The bytes signed below come from this image, so this line
      # is what makes a published id traceable to a commit.
      image = "ghcr.io/anyone-protocol/smart-contracts-ao-mainnet:d1cbc8feab33a68bafd7a87e683f768915fb934d"

      entrypoint = ["bun"]
      command = "run"
      args = [
        "${SCRIPT}",

        # Comment out anything you are not publishing this run.
        # write-gate is UNCHANGED since it was published as Jo_Ur2HyzPjlhmt7OGZyfNyTrmwhmySWwo4Mo8bcyZw
        # (it does not embed runtime/native.lua, so the 2026-08-12 runtime change does not reach it).
        # "runtime/write-gate.lua",
        # "dist/operator-registry-native.lua",   # UNCHANGED this run
        "dist/relay-rewards-native.lua",
        # "dist/staking-rewards-native.lua",   # UNCHANGED this run

        # Block until the GraphQL index confirms settlement, rather than reporting an id that
        # may never land.
        "--wait", "900",
      ]

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
      cpu    = 1024
      memory = 1024
    }

    vault {
      role = "any1-nomad-workloads-owner"
    }

    # The Vault policy templates the path from the workload identity as
    # kv/data/<nomad_namespace>/<nomad_job_id>, so this must match this job's namespace and id.
    # Renaming the job renames the secret it is allowed to read.
    template {
      destination = "secrets/keys.env"
      env         = true
      data = <<-EOH
      {{- with secret "kv/stage-protocol/publish-modules-stage" }}
      PUBLISH_KEY="{{ .Data.data.PUBLISH_KEY }}"
      {{ end }}
      EOH
    }
  }
}
