#!/usr/bin/env bash
# Disposable CI product test; never an operator migration/setup script.
set -euo pipefail
exec node "$(dirname "$0")/approval-container-smoke.mjs" compose "${1:?Provide the already built runtime image}"
