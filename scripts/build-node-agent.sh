#!/usr/bin/env bash
# Builds the x-node single-file binaries with Bun. Usage: scripts/build-node-agent.sh [target ...]
# Targets default to linux x64 and arm64; pass e.g. bun-darwin-arm64 for a local test build.
set -euo pipefail
cd "$(dirname "$0")/../node-agent"
command -v bun >/dev/null || { echo "需要安装 bun：https://bun.sh"; exit 1; }
mkdir -p dist
TARGETS=("$@")
[ ${#TARGETS[@]} -eq 0 ] && TARGETS=(bun-linux-x64 bun-linux-arm64)
for target in "${TARGETS[@]}"; do
  out="dist/x-node-${target#bun-}"
  echo ">>> 构建 $out"
  bun build --compile --target="$target" --minify ./src/index.ts --outfile "$out"
done
ls -la dist/x-node-*
