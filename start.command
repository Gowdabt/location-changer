#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT_DIR"
export USE_EXTERNAL_TUNNEL="${USE_EXTERNAL_TUNNEL:-1}"
exec bash "$ROOT_DIR/start.sh"
