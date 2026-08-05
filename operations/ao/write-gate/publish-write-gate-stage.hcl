# Publish the write gate to Arweave.
#
# The gate is the p4 pricing-device the HyperBEAM nodes run; the jobspecs reference it by module
# id, so it has to be durably resolvable before that config is applied. A node-local id (the
# `bin/hb eval` route) exists in one alloc's cache only, and since the gate fails CLOSED, a node
# that cannot resolve it refuses every write to every gated contract.
#
# Run:
#   nomad job run publish-write-gate-stage.hcl
#   nomad alloc logs <alloc-id>          # prints the module id
#
# Then hard-code the printed id as `module` in the hyperbeam jobspecs (infra-arweave). It is not
# a Consul key: a module id is content-addressed and already a permanent version sha, so pinning
# it in git makes the running gate reviewable and removes the failure where a missing key renders
# empty into a fail-closed device.
#
# ⚠️ A bundler 200 is a QUEUE RECEIPT, not persistence, and the gateway's data endpoint serves
# unsettled items from an optimistic cache — `curl arweave.net/<id>` will 200 for an item that
# never lands. The script only trusts the GraphQL index; PUBLISH_WAIT makes this job block on
# that rather than printing an id that may not settle.
#
# ⚠️ The id is the SIGNED ans104 item id, so it depends on the signing wallet as well as the
# bytes. Republishing the same source with a different wallet yields a DIFFERENT id.

job "publish-write-gate-stage" {
  datacenters = [ "ator-fin" ]
  type = "batch"
  namespace = "stage-protocol"

  constraint {
    attribute = "${meta.pool}"
    value = "stage"
  }

  reschedule { attempts = 0 }

  task "publish-write-gate-task" {
    driver = "docker"

    restart {
      attempts = 0
      mode     = "fail"
    }

    resources {
      cpu    = 1024
      memory = 1024
    }

    config {
      network_mode = "host"

      # TODO: pin the commit that built this image before running.
      # Actions -> "Build & Publish AO Mainnet Contracts Image" -> Run workflow -> pick the
      # branch; it tags by commit SHA. Pinned here rather than passed at dispatch so the bytes
      # behind the published id trace to an exact commit — which is the only thing that makes a
      # content-addressed id meaningful.
      image = "ghcr.io/anyone-protocol/smart-contracts-ao-mainnet:REPLACE_WITH_COMMIT_SHA"

      entrypoint = ["bun"]
      command = "run"
      args = ["scripts/publish-module.ts", "runtime/write-gate.lua", "--wait", "900"]

      logging {
        type = "loki"
        config {
          loki-url = "${LOKI_URL}"
          loki-external-labels = "container_name={{.Name}},job_name=${NOMAD_JOB_NAME}"
        }
      }
    }

    vault { role = "any1-nomad-workloads-controller" }

    env {
      # No default in the script either: choosing a bundler is a decision, not a fallback.
      BUNDLER = "https://up.arweave.net"
    }

    # The secret path is NOT free-form: the Vault policy templates it from the workload identity
    # as kv/data/<nomad_namespace>/<nomad_job_id>, so it must match this job's namespace and id.
    # Renaming the job renames the secret it can read.
    template {
      destination = "secrets/file.env"
      env         = true
      data = <<-EOH
      {{- with secret "kv/stage-protocol/publish-write-gate-stage" }}
      PUBLISH_KEY="{{.Data.data.PUBLISH_KEY}}"
      {{- end }}
      {{- range service "loki" }}
      LOKI_URL="http://{{ .Address }}:{{ .Port }}/loki/api/v1/push"
      {{- end }}
      EOH
    }
  }
}
