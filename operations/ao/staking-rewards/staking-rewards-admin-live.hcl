job "staking-rewards-admin-live" {
  datacenters = [ "ator-fin" ]
  namespace = "live-protocol"
  type = "batch"

  constraint {
    attribute = "${meta.pool}"
    value = "live-protocol"
  }

  reschedule { attempts = 0 }

  task "staking-rewards-live" {

    env {
      # SCRIPT = "scripts/acl/update-roles.ts"
      # UPDATE_ROLES_DATA="{\"Grant\":{\"0x14F7b53a09758aa257D8597cF992bDB61915f319\":[\"Claim-Rewards\"],\"0xB45B7F679b7470b094dDf99ebCbee1bc8552fa1A\":[\"Complete-Round\",\"Add-Scores\"]}}"
      
      SCRIPT="scripts/staking-rewards/toggle-share-feature.ts"
      FEATURE_SHARES_ENABLED="true"

      PHASE = "live"
      CU_URL="https://cu.anyone.tech"
    }

    driver = "docker"

    restart {
      attempts = 0
      mode     = "fail"
    }

    resources {
      cpu    = 4096
      memory = 4096
    }

    consul {}

    vault { role = "any1-nomad-workloads-owner" }

    config {
      network_mode = "host"
      image = "ghcr.io/anyone-protocol/smart-contracts-ao:94dbaf9c050604df219a33a67a53a24875755c0a"
      entrypoint = ["npx"]
      command = "tsx"
      args = ["${SCRIPT}"]
      logging {
        type = "loki"
        config {
          loki-url = "http://10.1.3.1:3100/loki/api/v1/push"
          loki-external-labels = "container_name={{.Name}},job_name=${NOMAD_JOB_NAME}"
        }
      }
    }

    template {
      destination = "local/config.env"
      env         = true
      data = <<-EOH
      PROCESS_ID="{{ key `smart-contracts/live/staking-rewards-address` }}"
      EOH
    }

    template {
      destination = "secrets/file.env"
      env         = true
      data = <<-EOH
      {{- with secret "kv/live-protocol/staking-rewards-live"}}
      ETH_PRIVATE_KEY="{{.Data.data.ETH_ADMIN_KEY}}"
      {{- end }}
      EOH
    }
  }
}
