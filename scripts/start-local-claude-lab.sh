#!/usr/bin/env bash
# User-invoked, private two-Claude experiment. No global install or permission bypass.
set -euo pipefail
umask 077
image='localhost/ai-agent-msg-broker-test:reviewed'
claude_binary=''
while (($#)); do
  case "$1" in
    --image) image="${2:?Supply the existing local image}"; shift 2 ;;
    --claude) claude_binary="${2:?Supply the installed Claude executable}"; shift 2 ;;
    *) printf '%s\n' 'Usage: bash scripts/start-local-claude-lab.sh [--image EXISTING_IMAGE] [--claude ABSOLUTE_BINARY]' >&2; exit 1 ;;
  esac
done
[[ $(uname -s) == Linux && $(id -u) != 0 ]] || { echo 'Use an ordinary nonroot Linux account.' >&2; exit 1; }
for command in podman git sha256sum readlink; do command -v "$command" >/dev/null; done
[[ $(podman info --format '{{.Host.Security.Rootless}}') == true ]] || { echo 'Existing rootless Podman is required; do not change host security.' >&2; exit 1; }
[[ -n "$claude_binary" ]] || claude_binary=$(command -v claude)
claude_binary=$(readlink -f -- "$claude_binary")
[[ -f "$claude_binary" && -x "$claude_binary" ]] || { echo 'Select an already installed Claude executable.' >&2; exit 1; }
broker_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)

lab=$(mktemp -d "$HOME/broker-local-test.XXXXXXXX")
lab=$(cd -- "$lab" && pwd -P)
printf 'Private test directory: %s\n' "$lab"
printf '%s\n' 'No global Node, native Claude settings, firewall, or installed service will be changed.'
bash "$broker_root/scripts/copy-image-node.sh" "$image" "$lab/node"

# This explicit clone is the only network preparation; no npm/vendor install runs.
git clone --quiet --no-checkout --single-branch --branch feat/lan-broker-adapter-foundation \
  https://github.com/brunoorsolon/claude-code-broker-connector.git "$lab/claude-code-broker-connector"
git -C "$lab/claude-code-broker-connector" checkout --quiet --detach a93d17a99d047ade19eb63146758a2434d2e65dd
[[ $(git -C "$lab/claude-code-broker-connector" rev-parse HEAD) == a93d17a99d047ade19eb63146758a2434d2e65dd ]]
printf '%s\n' 'Starting only a temporary loopback broker; creating two separate private test credentials valid for two hours.'
exec "$lab/node" "$broker_root/scripts/local-claude-lab.mjs" \
  --directory "$lab/state" --adapter "$lab/claude-code-broker-connector" --claude "$claude_binary"
