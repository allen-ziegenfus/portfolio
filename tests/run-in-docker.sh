#!/usr/bin/env bash
# Run the visual-regression suite inside the Playwright container so local
# renders match CI exactly (same OS/fonts → no false diffs).
#
#   bash tests/run-in-docker.sh           # compare against committed baselines
#   bash tests/run-in-docker.sh update    # rewrite baselines (review the PNG diff)
set -euo pipefail

MODE="${1:-test}"
IMAGE="mcr.microsoft.com/playwright:v1.60.0-noble"
HUGO_VERSION="0.162.1"

docker run --rm -v "$PWD":/work -w /work \
  -e MODE="$MODE" -e HUGO_VERSION="$HUGO_VERSION" \
  -e HOST_UID="$(id -u)" -e HOST_GID="$(id -g)" \
  "$IMAGE" bash -c '
    set -e
    apt-get update -qq && apt-get install -y -qq wget
    wget -qO /tmp/hugo.deb "https://github.com/gohugoio/hugo/releases/download/v${HUGO_VERSION}/hugo_extended_${HUGO_VERSION}_linux-amd64.deb"
    dpkg -i /tmp/hugo.deb || apt-get install -y -f -qq
    npm ci
    if [ "$MODE" = update ]; then npx playwright test --update-snapshots; else npx playwright test; fi
    # files written by root in the bind mount → hand them back to the host user
    chown -R "${HOST_UID}:${HOST_GID}" tests node_modules package-lock.json 2>/dev/null || true
  '
