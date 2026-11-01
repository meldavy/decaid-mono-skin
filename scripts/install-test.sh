#!/usr/bin/env bash
# Installs the packaged zip into the running (simulated) Decaid, makes it the served skin,
# runs the end-to-end suite against the installed copy, then restores the previous skin.
set -euo pipefail
cd "$(dirname "$0")/.."
API="${DECAID_URL:-http://localhost:8080}"

zip="$(scripts/package.sh | tail -1)"
previous="$(curl -fsS "$API/api/v1/webui/skins/default" | jq -r .id)"
# The served skin only changes when Decaid's web server restarts.
serve() {
  curl -fsS -X PUT "$API/api/v1/webui/skins/default" -H 'content-type: application/json' -d "{\"skinId\":\"$1\"}" > /dev/null
  curl -fsS -X POST "$API/api/v1/webui/server/stop" > /dev/null
  curl -fsS -X POST "$API/api/v1/webui/server/start" > /dev/null
}
restore() { serve "$previous" && echo "Restored default skin: $previous"; }
# Decaid installs from an HTTP URL only, so serve the zip briefly.
zip_port="${ZIP_PORT:-8765}"
python3 -m http.server "$zip_port" --bind 127.0.0.1 --directory "$(dirname "$zip")" > /dev/null 2>&1 &
server=$!
cleanup() { kill "$server" 2> /dev/null || true; restore; }
trap cleanup EXIT
for _ in $(seq 1 20); do curl -fsS -o /dev/null "http://127.0.0.1:$zip_port/$(basename "$zip")" 2> /dev/null && break; sleep 0.2; done

curl -fsS -X POST "$API/api/v1/webui/skins/install/url" -H 'content-type: application/json' \
  -d "{\"url\":\"http://127.0.0.1:$zip_port/$(basename "$zip")\"}" | jq -c .
serve mono

port=""
for _ in $(seq 1 20); do
  status="$(curl -fsS "$API/api/v1/webui/server/status")"
  if echo "$status" | jq -e '.path | endswith("/mono")' > /dev/null; then
    port="$(echo "$status" | jq -r .port)"
    break
  fi
  sleep 0.5
done
[ -n "$port" ] || { echo "Mono is not being served" >&2; exit 1; }
echo "Mono installed and served on http://localhost:$port"

MONO_URL="http://localhost:$port" npx playwright test "$@"
