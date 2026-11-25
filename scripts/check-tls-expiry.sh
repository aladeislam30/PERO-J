#!/usr/bin/env bash
# scripts/check-tls-expiry.sh
#
# Checks the TLS certificate expiry date for one or more HTTPS endpoints.
# Exits non-zero (and prints an error) if any certificate expires within
# WARN_DAYS (default 15) days.
#
# Usage:
#   ./scripts/check-tls-expiry.sh [HOST:PORT …]
#
# Environment variables:
#   WARN_DAYS          – days-remaining threshold before alerting (default: 15)
#   ALERT_WEBHOOK_URL  – optional Slack/Discord/generic webhook URL for alerts
#   NOTIFY_EMAIL       – optional e-mail address to receive alerts (requires
#                        the `mail` command to be available in PATH)
#   PROMETHEUS_MODE    – set to 1 to emit Prometheus textfile metrics to stdout
#                        (equivalent to passing --prometheus)
#   CERTBOT_CHECK      – set to 1 to run `certbot renew --dry-run` and fail if
#                        automated renewal is broken (default: 0)
#   CERTBOT_LOG        – optional path to the certbot renewal log; if set and
#                        CERTBOT_CHECK is not 1, the log is inspected for
#                        renewal failures instead of running a dry-run
#
# Flags:
#   --prometheus       – emit Prometheus metrics to stdout
#   --certbot-check    – run certbot renewal dry-run / inspect renewal log
#
# Examples:
#   # Check two endpoints:
#   WARN_DAYS=30 ./scripts/check-tls-expiry.sh api.example.com:443 app.example.com:443
#
#   # Emit Prometheus metrics (for node/textfile exporter):
#   ./scripts/check-tls-expiry.sh --prometheus api.example.com:443
#
#   # Used by CI (reads HOSTS_TO_CHECK from the environment):
#   ./scripts/check-tls-expiry.sh
=======

set -euo pipefail

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
WARN_DAYS="${WARN_DAYS:-15}"
ALERT_WEBHOOK_URL="${ALERT_WEBHOOK_URL:-}"
NOTIFY_EMAIL="${NOTIFY_EMAIL:-}"
PROMETHEUS_MODE="${PROMETHEUS_MODE:-0}"
CERTBOT_CHECK="${CERTBOT_CHECK:-0}"
CERTBOT_LOG="${CERTBOT_LOG:-}"

# Parse flags; remaining positional args are hosts.
POSITIONAL=()
for arg in "$@"; do
  case "$arg" in
    --prometheus)    PROMETHEUS_MODE=1 ;;
    --certbot-check) CERTBOT_CHECK=1 ;;
    -h|--help)
      echo "Usage: $0 [--prometheus] [--certbot-check] [HOST:PORT …]"
      exit 0
      ;;
    *)
      POSITIONAL+=("$arg")
      ;;
  esac
done

# Hosts passed as arguments; fall back to HOSTS_TO_CHECK env var (space-separated).
if [ "${#POSITIONAL[@]}" -gt 0 ]; then
  HOSTS=("${POSITIONAL[@]}")
else
  IFS=' ' read -r -a HOSTS <<< "${HOSTS_TO_CHECK:-}"
fi

# In Prometheus mode we may run with zero hosts (e.g. only certbot check),
# so only require hosts when not emitting metrics.
if [ "${#HOSTS[@]}" -eq 0 ] && [ "$PROMETHEUS_MODE" != "1" ] && [ "$CERTBOT_CHECK" != "1" ]; then
  echo "Usage: $0 [--prometheus] [--certbot-check] HOST:PORT [HOST:PORT …]"
  echo "       or set HOSTS_TO_CHECK='host1:443 host2:443'"
  exit 1
fi

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
send_alert() {
  local message="$1"

  # In Prometheus mode, keep stdout clean for metrics; send alerts to stderr.
  if [ "$PROMETHEUS_MODE" = "1" ]; then
    echo "ALERT: $message" >&2
  else
    echo "ALERT: $message" >&2
  fi

  if [ -n "$ALERT_WEBHOOK_URL" ]; then
    curl -s -X POST "$ALERT_WEBHOOK_URL" \
      -H 'Content-Type: application/json' \
      -d "{\"text\": \"🔐 TLS Expiry Alert: ${message}\"}" || true
  fi

  if [ -n "$NOTIFY_EMAIL" ] && command -v mail &>/dev/null; then
    echo "$message" | mail -s "TLS Certificate Expiry Warning" "$NOTIFY_EMAIL" || true
  fi
}

days_until_expiry() {
  # Returns the number of days until the certificate on HOST:PORT expires.
  # Prints a negative number if already expired.
  local host_port="$1"
  local host="${host_port%%:*}"
  local port="${host_port##*:}"

  local expiry_date
  expiry_date=$(echo \
    | openssl s_client -servername "$host" -connect "${host}:${port}" 2>/dev/null \
    | openssl x509 -noout -enddate 2>/dev/null \
    | sed 's/notAfter=//')

  if [ -z "$expiry_date" ]; then
    echo "-1"
    return
  fi

  local expiry_epoch now_epoch
  expiry_epoch=$(date -d "$expiry_date" +%s 2>/dev/null \
    || date -j -f "%b %d %T %Y %Z" "$expiry_date" +%s 2>/dev/null)
  now_epoch=$(date +%s)

  echo $(( (expiry_epoch - now_epoch) / 86400 ))
}

# Emit a Prometheus metric line. Args: metric_name labels value
emit_metric() {
  local name="$1" labels="$2" value="$3"
  if [ -n "$labels" ]; then
    echo "${name}{${labels}} ${value}"
  else
    echo "${name} ${value}"
  fi
}

# Check automated certbot renewal. Returns 0 on success, 1 on failure.
# Sets CERTBOT_FAILED=1 when renewal is broken.
check_certbot_renewal() {
  CERTBOT_FAILED=0

  if [ "$CERTBOT_CHECK" = "1" ]; then
    if ! command -v certbot &>/dev/null; then
      send_alert "certbot not found; cannot verify automated renewal."
      CERTBOT_FAILED=1
      return 1
    fi
    if ! certbot renew --dry-run --quiet; then
      send_alert "certbot renew --dry-run FAILED; automated renewal is broken."
      CERTBOT_FAILED=1
      return 1
    fi
    return 0
  fi

  # Fall back to inspecting the renewal log if provided.
  if [ -n "$CERTBOT_LOG" ] && [ -f "$CERTBOT_LOG" ]; then
    if grep -qiE 'renewal (failure|failed)|error.*renew' "$CERTBOT_LOG"; then
      send_alert "certbot renewal log ${CERTBOT_LOG} reports a renewal failure."
      CERTBOT_FAILED=1
      return 1
    fi
  fi

  return 0
}

# ---------------------------------------------------------------------------
# Main loop
# ---------------------------------------------------------------------------
FAILED=0

# Prometheus metric header (only in metrics mode).
if [ "$PROMETHEUS_MODE" = "1" ]; then
  echo "# HELP tls_certificate_expiry_days Days until the TLS certificate expires (negative if expired)."
  echo "# TYPE tls_certificate_expiry_days gauge"
  echo "# HELP tls_certificate_renewal_failed Whether automated certbot renewal failed (1 = failed)."
  echo "# TYPE tls_certificate_renewal_failed gauge"
fi

for HOST_PORT in "${HOSTS[@]}"; do
  # Normalise: if no port given, default to 443
  if [[ "$HOST_PORT" != *:* ]]; then
    HOST_PORT="${HOST_PORT}:443"
  fi

  if [ "$PROMETHEUS_MODE" != "1" ]; then
    echo -n "Checking ${HOST_PORT} … "
  fi

  DAYS=$(days_until_expiry "$HOST_PORT")

  if [ "$PROMETHEUS_MODE" = "1" ]; then
    emit_metric "tls_certificate_expiry_days" "host=\"${HOST_PORT}\"" "$DAYS"
  fi

  if [ "$DAYS" -lt 0 ]; then
    send_alert "Certificate for ${HOST_PORT} has ALREADY EXPIRED."
    FAILED=1
  elif [ "$DAYS" -lt "$WARN_DAYS" ]; then
    send_alert "Certificate for ${HOST_PORT} expires in ${DAYS} day(s) (threshold: ${WARN_DAYS})."
    FAILED=1
  else
    if [ "$PROMETHEUS_MODE" != "1" ]; then
      echo "OK – expires in ${DAYS} day(s)."
    fi
  fi
done

# Verify automated renewal when requested (or when a renewal log is provided).
CERTBOT_FAILED=0
if [ "$CERTBOT_CHECK" = "1" ] || [ -n "$CERTBOT_LOG" ]; then
  if ! check_certbot_renewal; then
    FAILED=1
  fi
fi

if [ "$PROMETHEUS_MODE" = "1" ]; then
  emit_metric "tls_certificate_renewal_failed" "" "$CERTBOT_FAILED"
fi

exit "$FAILED"
