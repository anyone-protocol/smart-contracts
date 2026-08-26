# D22 - capture and publish a state snapshot of all three native contracts to Arweave.
#
# PERIODIC batch job, once a day. Deliberately a SEPARATE job rather than a sidecar in the
# hyperbeam group: a sidecar would share the node's lifecycle, so every change to this tooling
# or its image would redeploy hyperbeam and RESTART THE NODE. Snapshot tooling should never be
# a reason to restart a node holding live protocol state.
#
# It needs nothing from the node but two reads. It resolves the node through the in-cluster
# `hyperbeam-live-node` Consul service, which exists for exactly this - deploy and verify jobs
# address the node there rather than through the public edge. `slot/current` and `as/dump` are
# both on p4's non-chargable routes, so this signer needs NO faff allow-list entry, and the
# snapshot never touches the write path.
#
# --- Why direct L1 and not the node's ~bundler@1.0 ------------------------------------------
# Three reasons, in order of weight:
#
#   1. Our own ~bundler@1.0 is BROKEN. It signs, prices and mines the bundle transaction, then
#      every chunk POST returns 400 data_root_not_found: `building_proofs` computes a data_size
#      that does not match the bundle it just posted a header for, so the merkle root describes
#      a payload that does not exist. That is structural in the SignedTX -> structured@1.0 ->
#      tx@1.0 round trip between post_tx and build_proofs, not payload-specific, so snapshots
#      would fail exactly the same way - while still being PAID FOR.
#   2. A bundled item is only queryable by tag if a gateway chooses to UNBUNDLE it. A direct L1
#      transaction is indexed natively with its tags. Recovery finds snapshots by
#      `tag process=<pid>, type=state-snapshot`, so bundling would make the durability
#      mechanism depend on gateway policy for no benefit.
#   3. The saving is 0.348%. Measured 2026-08-25: three separate transactions cost 0.0205867 AR,
#      one bundle of the same bytes costs 0.0205150 AR. Arweave prices per byte; bundling exists
#      to amortise MANY SMALL items, and three ~1 MiB blobs are the opposite shape.
#
# If ~bundler@1.0 is ever fixed, revisit (2) before (3) - the unbundling dependency is the real
# objection, not the fee.
#
# --- Cost and safety ------------------------------------------------------------------------
# WARNING: this SPENDS AR from PUBLISH_JWK - a real L1 transaction per contract. Keep it funded.
# Measured 2026-08-25: 0.0206 AR for all three live contracts.
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

job "publish-snapshot-live" {
  datacenters = [ "ator-fin" ]
  type = "batch"
  namespace = "live-protocol"

  constraint {
    attribute = "${meta.pool}"
    value = "live-protocol"
  }

  # Once a day. prohibit_overlap stops a slow or hung run from racing its successor, which with
  # the (process, slot) dedupe means a double-post is not reachable even if a run wedges.
  periodic {
    cron             = "@daily"
    prohibit_overlap = true
  }

  reschedule { attempts = 0 }

  task "publish-snapshot-live" {
    driver = "docker"

    env {
      GATEWAY = "https://arweave.net"
    }

    config {
      network_mode = "host"

      # TODO: pin the commit that built this image before running.
      image = "ghcr.io/anyone-protocol/smart-contracts-ao-mainnet:48d4cb5a2dd59498489441d3f15294ecd2f53658@sha256:893fdecab1a7dc78642598cf962bb4ba22407a181a5b5048195af4749af53d4a"

      # Chained with && so a failed capture never reaches the publisher. NOT wrapped in
      # ( set -e; ... ): POSIX ignores -e for a list being tested, and a subshell inherits that
      # - verified in sh and bash that it runs the second command anyway AND reports success.
      entrypoint = ["sh", "-c"]
      command = "bun run scripts/snapshot-state.ts live --out /tmp/snap && bun run scripts/publish-snapshot.ts /tmp/snap --confirm --wait 900"

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
    # PUBLISH_JWK is a DEDICATED Arweave JWK that signs and pays. Not the node's wallet - the
    # node's identity key stays in its own Vault path and is never used to publish - and not the
    # EVM key publish-module.ts uses, which signs ANS-104 items for a bundler and holds no AR.
    template {
      destination = "secrets/keys.env"
      env         = true
      data = <<-EOH
      {{- with secret "kv/live-protocol/publish-snapshot-live" }}
      PUBLISH_JWK="{{ .Data.data.PUBLISH_JWK }}"
      {{- end }}
      {{- range service "hyperbeam-live-node" }}
      SNAPSHOT_HOST="{{ .Address }}:{{ .Port }}"
      {{- end }}
      EOH
    }
  }
}
