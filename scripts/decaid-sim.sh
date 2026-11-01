#!/usr/bin/env bash
# Starts Decaid in simulate mode (mock DE1 + mock scale) for Mono's end-to-end tests.
#
#   DECAID_DIR=/path/to/decaid scripts/decaid-sim.sh start|stop|status
#
# DECAID_DIR must be a checkout with LF line endings (sb-dev.sh fails on CRLF).
# Before starting it marks Decaid's first-run wizard as done in the desktop app's
# shared preferences, so nothing waits on a person clicking through it. This also
# skips the account step, which crashes on Linux setups without an unlocked keyring.
set -euo pipefail

: "${DECAID_DIR:?set DECAID_DIR to a Decaid checkout}"
PREFS="${DECAID_PREFS:-$HOME/.local/share/net.tadel.reaprime/shared_preferences.json}"
SB="$DECAID_DIR/scripts/sb-dev.sh"

seed_prefs() {
  mkdir -p "$(dirname "$PREFS")"
  [ -s "$PREFS" ] || echo '{}' > "$PREFS"
  local tmp
  tmp="$(mktemp)"
  jq '. + {onboardingCompleted: true, accountStepSeen: true}' "$PREFS" > "$tmp" && mv "$tmp" "$PREFS"
}

case "${1:-start}" in
  start)
    seed_prefs
    (cd "$DECAID_DIR" && "$SB" start --connect-machine MockDe1 --connect-scale MockScale)
    for _ in $(seq 1 30); do
      if curl -fsS http://localhost:8080/api/v1/devices | jq -e 'any(.[]; .name == "Mock Scale" and .state == "connected")' > /dev/null; then
        echo "Mock scale connected"
        exit 0
      fi
      sleep 1
    done
    echo "Mock scale did not connect" >&2
    exit 1
    ;;
  stop | status | logs)
    (cd "$DECAID_DIR" && "$SB" "$1")
    ;;
  *)
    echo "usage: $0 start|stop|status|logs" >&2
    exit 2
    ;;
esac
