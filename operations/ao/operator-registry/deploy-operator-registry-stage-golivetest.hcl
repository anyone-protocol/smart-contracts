## Deploys Operator Registry using stage keys to "dev" env without updating Consul
job "operator-registry-stage" {
  datacenters = [ "ator-fin" ]
  type = "batch"
  namespace = "stage-protocol"

  constraint {
    attribute = "${meta.pool}"
    value = "stage"
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
      image = "ghcr.io/anyone-protocol/smart-contracts-ao:c759cf551b9329405716c09d447833e0e15a9976"
      # entrypoint = ["npm"]
      # command = "run"
      # args = ["deploy"]
      entrypoint = ["/usr/src/app/scripts/entrypoint.sh"]
      mount {
        type = "bind"
        source = "local/entrypoint.sh"
        target = "/usr/src/app/scripts/entrypoint.sh"
        readonly = true
      }
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

    env {
      PHASE = "dev"
      CONTRACT_NAME = "operator-registry"
      CU_URL="https://cu.anyone.tech"

      ## NB: Only one of the below methods should be used at a time:

      ## NB: Spawn a new process & migrate state from an existing one
      ##     Set MIGRATION_SOURCE_PROCESS_ID in template below to the
      ##     existing process ID to migrate from
      # IS_MIGRATION_DEPLOYMENT = "true"

      ## NB: Spawn a new process & call Init with data from file at
      ##     INIT_DATA_PATH
      CALL_INIT_HANDLER="true"
      INIT_DATA_PATH="scripts/operator-registry-state-golive.json"
      PROCESS_ID="n5IsDdUksrAGbKHDE7kGZYNyufidb-CIf2rY6qo80Ck" # Live Operator Registry
    }

    template {
      destination = "secrets/file.env"
      env         = true
      data = <<-EOH
      {{- with secret "kv/stage-protocol/operator-registry-stage" }}
      DEPLOYER_PRIVATE_KEY="{{.Data.data.OPERATOR_REGISTRY_OWNER_KEY}}"
      {{- end }}
      {{- range service "loki" }}
      LOKI_URL="http://{{ .Address }}:{{ .Port }}/loki/api/v1/push"
      {{- end }}
      EOH
    }

    template {
      data = <<-EOF
      #!/bin/sh
      set -e

      echo "Preparing to deploy Operator Registry to DEV environment"
      
      npx tsx scripts/dryrun-view-state.ts > scripts/operator-registry-state.json

      jq '
        # Extract VerifiedHardwareFingerprints keys and remove all whitespace
        (.VerifiedHardwareFingerprints | keys | map(select(startswith(" ") | not))) as $hw_fps |
        
        # Filter VerifiedFingerprintsToOperatorAddresses by verified hardware fingerprints
        # AND exclude any keys that originally contained whitespace
        {
          VerifiedHardwareFingerprints: (
            $hw_fps | 
            map({key: ., value: true}) | 
            from_entries
          ),
          VerifiedFingerprintsToOperatorAddresses: (
            .VerifiedFingerprintsToOperatorAddresses | 
            to_entries | 
            map(select(
              (.key | test("\\s") | not) and  # Exclude keys with whitespace
              (.key | IN($hw_fps[]))           # Keep only verified fingerprints
            )) |
            from_entries
          )
        }
      ' scripts/operator-registry-state.json > scripts/operator-registry-state-golive.json

      # cat scripts/operator-registry-state-golive.json
      npm run deploy
      EOF
      destination = "local/entrypoint.sh"
      perms = "0755"
    }
  }
}
