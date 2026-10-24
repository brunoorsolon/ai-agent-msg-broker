#!/usr/bin/env bash
# Disposable CI-only published-port/persistent-volume smoke. No credentials or proxy setup.
set -euo pipefail
image=${1:?Provide the already built runtime image}
work=$(mktemp -d)
volume="broker-ci-$(basename "$work" | tr '[:upper:]' '[:lower:]')"
cid=''
cleanup() {
  if [[ -n "$cid" ]]; then docker rm -f "$cid" >/dev/null 2>&1 || true; fi
  docker volume rm "$volume" >/dev/null 2>&1 || true
  rm -r -- "$work"
}
trap cleanup EXIT
command -v curl >/dev/null
docker volume create "$volume" >/dev/null
cid=$(docker run -d --read-only --cap-drop ALL --security-opt no-new-privileges \
  -p 127.0.0.1::8787 -v "$volume:/data" "$image")
port=$(docker inspect --format '{{(index (index .NetworkSettings.Ports "8787/tcp") 0).HostPort}}' "$cid")
[[ "$port" =~ ^[0-9]+$ ]]
base="http://127.0.0.1:$port"
wait_health() {
  for ((attempt=0; attempt<40; attempt++)); do
    if curl --silent --show-error --fail --max-time 1 "$base/healthz" >"$work/health" 2>/dev/null; then return; fi
    sleep .25
  done
  echo 'Published Docker health did not become available.' >&2
  docker logs "$cid" >&2
  return 1
}
wait_health
[[ $(cat "$work/health") == '{"status":"ok"}' ]]
[[ $(curl --silent --show-error --max-time 2 -o /dev/null -w '%{http_code}' "$base/readyz") == 503 ]]
for path in /v1/clients /v1/sessions /v1/unknown; do
  [[ $(curl --silent --show-error --max-time 2 -o /dev/null -w '%{http_code}' "$base$path") == 401 ]]
  [[ $(curl --silent --show-error --max-time 2 -H 'Authorization: Bearer 123' -o /dev/null -w '%{http_code}' "$base$path") == 401 ]]
done
docker exec "$cid" node scripts/container-health.mjs
# Actual SQLite exists in the named volume and ownership survives a normal restart.
docker exec "$cid" node --input-type=module -e "import{statSync,writeFileSync}from'node:fs';if(process.getuid()===0||!statSync('/data/broker.sqlite').isFile())process.exit(1);writeFileSync('/data/ci-retention-marker','retained',{flag:'wx',mode:0o600})"
docker restart --time 5 "$cid" >/dev/null
wait_health
docker exec "$cid" node --input-type=module -e "import{readFileSync}from'node:fs';if(readFileSync('/data/ci-retention-marker','utf8')!=='retained')process.exit(1)"
docker exec "$cid" node scripts/container-health.mjs
echo 'Docker published-port and persistent-volume smoke passed: host health200, readiness503, API401, restart retained data.'
