#!/usr/bin/env bash
# Copy only the runtime from an operator-selected existing image, never install it globally.
set -euo pipefail
umask 077
[[ $# == 2 ]] || { echo 'Usage: bash scripts/copy-image-node.sh EXISTING_IMAGE NEW_PRIVATE_PATH' >&2; exit 1; }
image=$1
destination=$2
[[ $(uname -s) == Linux && $(id -u) != 0 ]] || { echo 'Use an ordinary nonroot Linux account.' >&2; exit 1; }
for command in podman sha256sum stat; do command -v "$command" >/dev/null; done
[[ $(podman info --format '{{.Host.Security.Rootless}}') == true ]] || { echo 'Existing rootless Podman is required; do not change host security.' >&2; exit 1; }
[[ "$destination" == /* && ! -e "$destination" && ! -L "$destination" ]] || { echo 'Choose a new absolute private runtime path.' >&2; exit 1; }
parent=$(dirname -- "$destination")
[[ -d "$parent" && ! -L "$parent" && $(cd -- "$parent" && pwd -P) == "$parent" \
  && $(stat -c '%a:%u' -- "$parent") == "700:$(id -u)" ]] || { echo 'The runtime parent must be your own canonical mode-0700 directory.' >&2; exit 1; }
image_id=$(podman image inspect --format '{{.Id}}' "$image")
[[ "$image_id" =~ ^(sha256:)?[a-f0-9]{64}$ ]] || { echo 'The reviewed local image is unavailable.' >&2; exit 1; }
case $(uname -m) in x86_64) architecture=x64 ;; aarch64) architecture=arm64 ;; *) echo 'This bootstrap supports Linux x64 or arm64 only.' >&2; exit 1 ;; esac
container_options=(--rm --pull=never --network=none --user=node --read-only --cap-drop=ALL --security-opt=no-new-privileges)
# Resolve the image ID once, then compare the copied bytes against that SAME image.
read -r expected_sha image_arch < <(podman run "${container_options[@]}" "$image_id" node --input-type=module -e \
  "import{readFileSync}from'node:fs';import{createHash}from'node:crypto';console.log(createHash('sha256').update(readFileSync(process.execPath)).digest('hex'),process.arch)")
[[ "$expected_sha" =~ ^[a-f0-9]{64}$ && "$image_arch" == "$architecture" ]] || { echo 'Runtime hash/architecture check failed.' >&2; exit 1; }
(set -o noclobber; podman run "${container_options[@]}" "$image_id" node --input-type=module -e \
  "import{readFileSync}from'node:fs';process.stdout.write(readFileSync(process.execPath))" > "$destination")
printf '%s  %s\n' "$expected_sha" "$destination" | sha256sum --check --status
chmod 0700 "$destination"
"$destination" --input-type=module -e \
  "import{DatabaseSync}from'node:sqlite';if(process.versions.node!=='24.19.0'||process.platform!=='linux'||process.arch!==process.argv[1])process.exit(1);const db=new DatabaseSync(':memory:');if(db.prepare('SELECT sqlite_version() AS v').get().v!=='3.53.3')process.exit(1);db.close();console.log('Isolated Node 24.19.0 / SQLite 3.53.3 verified; host global Node unchanged.')" "$architecture"
