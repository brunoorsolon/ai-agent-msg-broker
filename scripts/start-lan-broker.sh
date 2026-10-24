#!/usr/bin/env bash
# Explicit, temporary broker-only HTTPS; no native client or host network configuration.
set -Eeuo pipefail
umask 077
stage='argument validation'
trap 'status=$?; printf "HTTPS broker startup failed during %s (exit %s). No existing sessions were changed.\n" "$stage" "$status" >&2; exit "$status"' ERR
printf '%s\n' 'Preparing broker-only HTTPS. A host listener will be opened only at your explicitly selected bind.'
image='localhost/ai-agent-msg-broker-test:reviewed'
bind=''; hostname=''; port=8787; allow_all=false
while (($#)); do
  case "$1" in
    --image|--bind|--hostname|--port)
      [[ $# -ge 2 ]] || { echo 'Missing option value.' >&2; exit 1; }
      case "$1" in --image) image=$2 ;; --bind) bind=$2 ;; --hostname) hostname=$2 ;; --port) port=$2 ;; esac; shift 2 ;;
    --allow-all-interfaces) allow_all=true; shift ;;
    *) echo 'Usage: bash scripts/start-lan-broker.sh --bind HOST_IPV4 --hostname CLIENT_HOSTNAME [--port 8787] [--image EXISTING_IMAGE] [--allow-all-interfaces]' >&2; exit 1 ;;
  esac
done
[[ -n "$bind" && -n "$hostname" ]] || { echo 'Explicit --bind and --hostname are required; no network address is guessed.' >&2; exit 1; }
if [[ "$bind" == 0.0.0.0 ]]; then
  [[ "$allow_all" == true ]] || { echo 'Wildcard bind exposes all reachable host interfaces; add --allow-all-interfaces only if you intend that exposure.' >&2; exit 1; }
  printf '%s\n' 'EXPOSURE ACKNOWLEDGED: HTTPS will listen on all IPv4 interfaces. No firewall rule or public tunnel is created.'
fi
stage='local prerequisites'
[[ $(uname -s) == Linux && $(id -u) != 0 ]] || { echo 'Use an ordinary nonroot Linux account.' >&2; exit 1; }
for command in podman sha256sum stat timeout mktemp openssl; do command -v "$command" >/dev/null || { printf 'Required local command is unavailable: %s\n' "$command" >&2; exit 1; }; done
broker_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)
stage='private directory creation';lab=$(mktemp -d "$HOME/broker-lan-test.XXXXXXXX");lab=$(cd -- "$lab" && pwd -P)
printf 'Private HTTPS broker directory: %s\n' "$lab"
stage='isolated runtime copy (maximum 180 seconds)'
timeout --kill-after=5s 180s bash "$broker_root/scripts/copy-image-node.sh" "$image" "$lab/node"
args=(--directory "$lab/state" --bind "$bind" --hostname "$hostname" --port "$port")
[[ "$allow_all" != true ]] || args+=(--allow-all-interfaces)
stage='HTTPS broker startup'
exec "$lab/node" "$broker_root/scripts/lan-broker.mjs" "${args[@]}"
