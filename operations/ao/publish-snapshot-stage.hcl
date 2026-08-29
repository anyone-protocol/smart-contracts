# D22 - capture and publish a state snapshot of all three native contracts to Arweave.
#
# PERIODIC batch job, once a day. Deliberately a SEPARATE job rather than a sidecar in the
# hyperbeam group: a sidecar would share the node's lifecycle, so every change to this tooling
# or its image would redeploy hyperbeam and RESTART THE NODE. Snapshot tooling should never be
# a reason to restart a node holding live protocol state.
#
# It needs nothing from the node but two reads. It resolves the node through the in-cluster
# `hyperbeam-stage-node` Consul service, which exists for exactly this - deploy and verify jobs
# address the node there rather than through the public edge. `slot/current` and `as/dump` are
# both on p4's non-chargable routes, so this signer needs NO faff allow-list entry, and the
# snapshot never touches the write path.
#
# --- Why the node's own ~bundler@1.0 and not direct L1 --------------------------------------
# One upload mechanism, not two. D24 closed self-bundling on all three nodes, so every scheduled
# message and assignment already reaches Arweave through ~bundler@1.0. Publishing snapshots the
# same way leaves a single path to operate, fund and monitor.
#
# The objection this had to clear: recovery finds snapshots by GraphQL TAG QUERY, and a bundled
# data item is indexed only if a gateway chooses to UNBUNDLE it. Verified against live on
# 2026-08-28 - items inside our own node-signed bundles ARE tag-discoverable on arweave.net, and
# `transaction(id:)` reports a block height for them, which is what the settlement wait uses.
#
# What the handoff costs, and it is not nothing: snapshot durability now shares a failure domain
# with the node's own upload queue, and acceptance by the bundler is NOT settlement on chain. A
# run can legitimately end with items accepted but not yet indexed, and it exits 0 when it does.
# That is exactly why D25's publishing-reliability monitoring has to cover snapshots too.
#
# --- Cost and safety ------------------------------------------------------------------------
# WARNING: this spends the NODE's AR, not PUBLISH_JWK's - the node signs and pays for the bundle
# that carries the snapshot. PUBLISH_JWK signs the data item only and needs NO balance. The
# thing to keep funded is the NODE wallet, which also pays for every assignment it publishes.
# Estimated at 2026-08-25 prices: 0.0206 AR for all three live contracts.
#
# Publishing is IDEMPOTENT on (process, slot). A contract that has not advanced a slot since its
# last published snapshot is SKIPPED, not re-posted - live operator-registry sits at slot 8 for
# long stretches and a daily cadence would otherwise pay for a byte-identical copy every day.
# `prohibit_overlap` below means a slow run can never race the next one.
#
# WARNING: refuses to publish an UNANCHORED snapshot. A snapshot with no anchor assignment
# leaves the published chain rootless, which is the exact defect D22 closes. If it refuses, the
# slot's assignment is usually just not indexed yet - the next run will pick it up.
#
# WARNING: every slot written before the D21 fix (scheduler-default-commitment-spec, deployed
# 2026-08-25) has NO assignment on Arweave. Snapshots anchor history from their own slot
# FORWARD. They do not recover what was never published.
#
# Verify afterwards, per id printed by the job:
#   bun run scripts/verify-snapshot.ts --published <tx-id>

job "publish-snapshot-stage" {
  datacenters = [ "ator-fin" ]
  type = "batch"
  namespace = "stage-services"

  constraint {
    attribute = "${meta.pool}"
    value = "stage"
  }

  # Once a day. prohibit_overlap stops a slow or hung run from racing its successor, which with
  # the (process, slot) dedupe means a double-post is not reachable even if a run wedges.
  periodic {
    cron             = "@daily"
    prohibit_overlap = true
  }

  reschedule { attempts = 0 }

  task "publish-snapshot-stage" {
    driver = "docker"

    env {
      GATEWAY = "https://arweave.net"
    }

    config {
      network_mode = "host"

      # Pinned to bbbcdbb, the commit that moved publishing onto the node's own ~bundler@1.0.
      # The previous pin (48d4cb5a, 2026-08-20) PREDATED the snapshot tooling entirely and would
      # have failed on a missing file - the scripts landed in c35dbc6 on 2026-08-26.
      # Tag and digest must move together: the tag names the commit, the digest is what runs.
      # Digest verified against the tag on ghcr 2026-08-29.
      image = "ghcr.io/anyone-protocol/smart-contracts-ao-mainnet:bbbcdbbc9f630efa06aa78a144ece80fa4038dec@sha256:70f87446adcce501291e585ce03f493819f2af67080ab43e14bc740a67b75e8f"

      # Chained with && so a failed capture never reaches the publisher. NOT wrapped in
      # ( set -e; ... ): POSIX ignores -e for a list being tested, and a subshell inherits that
      # - verified in sh and bash that it runs the second command anyway AND reports success.
      entrypoint = ["sh", "-c"]
      command = "bun run scripts/snapshot-state.ts stage --out /tmp/snap && bun run scripts/publish-snapshot.ts /tmp/snap --confirm --wait 900"

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
      memory = 2048
    }

    vault {
      role = "any1-nomad-workloads-owner"
    }

    # SNAPSHOT_HOST and PUBLISH_JWK are here, not in the env block: an env block does not run
    # through consul-template, so neither a service lookup nor a Vault read works there.
    #
    # PUBLISH_JWK is a DEDICATED Arweave JWK that SIGNS the snapshot data item and nothing else.
    # It holds no AR and needs none: the node pays for the bundle. It is deliberately not the
    # node's own key - the node's identity stays in its own Vault path and never signs a payload
    # - so a snapshot stays attributable to the publisher rather than to the scheduler.
    #
    # BUNDLER is not set here: publish-snapshot.ts defaults it to http://$SNAPSHOT_HOST, which is
    # the in-cluster address resolved just below. That matters - `~bundler@1.0` is refused at the
    # edge on this env, so the upload only works from inside the cluster.
    template {
      destination = "secrets/keys.env"
      env         = true
      data = <<-EOH
      {{- with secret "kv/stage-services/publish-snapshot-stage" }}
      PUBLISH_JWK="{{ .Data.data.PUBLISH_JWK }}"
      {{- end }}
      {{- range service "hyperbeam-stage-node" }}
      SNAPSHOT_HOST="{{ .Address }}:{{ .Port }}"
      {{- end }}
      EOH
    }
  }
}
