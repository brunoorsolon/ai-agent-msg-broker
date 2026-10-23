#!/usr/bin/env bash
# Broker only: no native executable discovery, connector clone or session launcher.
set -Eeuo pipefail
umask 077
stage='argument validation'
trap 'status=$?; printf "Broker startup failed during %s (exit %s). No existing sessions were changed.\n" "$stage" "$status" >&2; exit "$status"' ERR
printf '%s\n' 'Preparing broker-only local startup. No Claude command or connector checkout is required.'
image='localhost/ai-agent-msg-broker-test:reviewed'
while (($#)); do
  case "$1" in
    --image) [[ $# -ge 2 ]] || { echo 'Supply an existing local image.' >&2; exit 1; }; image=$2; shift 2 ;;
    *) echo 'Usage: bash scripts/start-local-broker.sh [--image EXISTING_LOCAL_IMAGE]' >&2; exit 1 ;;
  esac
done
stage='local prerequisites'
[[ $(uname -s) == Linux && $(id -u) != 0 ]] || { echo 'Use an ordinary nonroot Linux account.' >&2; exit 1; }
for command in podman sha256sum stat timeout mktemp; do
  command -v "$command" >/dev/null || { printf 'Required local command is unavailable: %s\n' "$command" >&2; exit 1; }
done
broker_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)
stage='private directory creation'
lab=$(mktemp -d "$HOME/broker-local.XXXXXXXX")
lab=$(cd -- "$lab" && pwd -P)
printf 'Private broker directory: %s\n' "$lab"
stage='isolated runtime copy (maximum 180 seconds)'
timeout --kill-after=5s 180s bash "$broker_root/scripts/copy-image-node.sh" "$image" "$lab/node"
stage='broker startup'
printf '%s\n' 'Runtime ready. Creating two private two-hour credentials and opening only 127.0.0.1.'
exec "$lab/node" "$broker_root/scripts/local-broker.mjs" --directory "$lab/state"
