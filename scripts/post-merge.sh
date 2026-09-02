#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

# Keep dependency setup deterministic and safe when stdin is closed by the merge hook.
npm ci --no-audit --no-fund
npm test