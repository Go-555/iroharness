#!/usr/bin/env sh
set -eu

APP_PORT="${IROHARNESS_PORT:-4178}"
TAILSCALE_HOST="${IROHARNESS_TAILSCALE_HOST:-iroharness}"

tailscale serve --bg --https=443 "http://127.0.0.1:${APP_PORT}"
printf 'IroHarness is available on your tailnet as https://%s\n' "${TAILSCALE_HOST}"
