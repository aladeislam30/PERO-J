#!/usr/bin/env bash
#
# Backup restore / PITR verification test.
#
# Two modes:
#
#   1. Logical dump mode (default)
#      Restores the most recent local dump (or a specific DUMP_FILE path) into a
#      temporary database, verifies row counts for key tables, and drops the
#      test database on exit.
#
#   2. PITR mode (TARGET_TIME / PITR_TARGET_TIMESTAMP set)
#      Restores a physical base backup (BASE_BACKUP_DIR) into a temporary data
#      directory, replays archived WAL from WAL_ARCHIVE_DIR up to the target
#      timestamp using recovery.signal, starts a throwaway PostgreSQL instance on
#      a private port, verifies the restored database reaches the expected
#      state, then shuts the instance down and removes the temporary directory.
#
# Usage:
#   ./scripts/backup-restore-test.sh                # auto-finds newest dump
#   DUMP_FILE=./backups/my.dump ./scripts/backup-restore-test.sh
#   TARGET_TIME='2024-01-01 12:00:00+00' \
#     BASE_BACKUP_DIR=./backups/base WAL_ARCHIVE_DIR=./backups/wal \
#     ./scripts/backup-restore-test.sh
#
# Environment variables (same connection vars as backup.sh):
#   PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE
#   DATABASE_URL  — parsed when individual PG* vars are unset
#   DUMP_FILE     — path to the dump to restore (default: newest in BACKUP_DIR)
#   BACKUP_DIR    — directory containing dumps (default: ./backups)
#   TEST_DB       — name of the temporary restore target (default: <PGDATABASE>_restore_test)
#
# PITR-mode environment variables:
#   TARGET_TIME / PITR_TARGET_TIMESTAMP — recovery target (any format accepted by
#                                         PostgreSQL recovery_target_time)
#   BASE_BACKUP_DIR — directory containing the physical base backup (default: ./backups/base)
#   WAL_ARCHIVE_DIR — directory containing archived WAL segments (default: ./backups/wal)
#   PITR_DATA_DIR   — temporary data directory for the restored cluster
#                     (default: mktemp -d)
#   PITR_PORT       — port for the throwaway instance (default: 55432)
#   PITR_EXPECTED_EVENTS — minimum number of rows expected in `events` after
#                          recovery (default: 0, i.e. only schema presence checked)
#
# RPO / RTO targets (see docs/backup.md):
#   RPO ≤ 24 h with nightly base backups; ≤ 5 min with WAL archiving enabled.
#   RTO ≤ 1 h for a full restore on typical indexer database sizes (< 50 GB).
#   PITR RTO ≤ 2 h including WAL replay to the target timestamp.
#
# Exit codes:
#   0 — restore succeeded and all checks passed
#   1 — prerequisite missing, restore failed, or row-count check failed

set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-./backups}"

# ── Derive connection settings ────────────────────────────────────────────────
if [[ -n "${DATABASE_URL:-}" ]]; then
  : "${PGHOST:=$(printf '%s' "$DATABASE_URL" | sed -E 's#^[a-z]+://([^:@/]+)(:[^@/]*)?@([^:/]+)(:([0-9]+))?/([^?]+).*#\3#')}"
  : "${PGPORT:=$(printf '%s' "$DATABASE_URL" | sed -nE 's#^[a-z]+://([^:@/]+)(:[^@/]*)?@([^:/]+):([0-9]+)/([^?]+).*#\4#p')}"
  : "${PGUSER:=$(printf '%s' "$DATABASE_URL" | sed -E 's#^[a-z]+://([^:@/]+)(:[^@/]*)?@.*#\1#')}"
  : "${PGPASSWORD:=$(printf '%s' "$DATABASE_URL" | sed -nE 's#^[a-z]+://[^:@/]+:([^@/]*)@.*#\1#p')}"
  : "${PGDATABASE:=$(printf '%s' "$DATABASE_URL" | sed -E 's#^[a-z]+://[^?]*/([^?]+).*#\1#')}"
fi

: "${PGHOST:=localhost}"
: "${PGPORT:=5432}"
: "${PGUSER:=postgres}"
: "${PGDATABASE:=soroban_explorer}"
TEST_DB="${TEST_DB:-${PGDATABASE}_restore_test}"

export PGHOST PGPORT PGUSER PGDATABASE
[[ -n "${PGPASSWORD:-}" ]] && export PGPASSWORD

# PITR mode is active when a target timestamp is supplied.
PITR_TARGET="${TARGET_TIME:-${PITR_TARGET_TIMESTAMP:-}}"
PITR_MODE=0
[[ -n "$PITR_TARGET" ]] && PITR_MODE=1

BASE_BACKUP_DIR="${BASE_BACKUP_DIR:-./backups/base}"
WAL_ARCHIVE_DIR="${WAL_ARCHIVE_DIR:-./backups/wal}"
PITR_PORT="${PITR_PORT:-55432}"
PITR_EXPECTED_EVENTS="${PITR_EXPECTED_EVENTS:-0}"
PITR_DATA_DIR="${PITR_DATA_DIR:-}"
PITR_STARTED=0
PITR_OWN_DATA_DIR=0

# ── Prerequisite checks ───────────────────────────────────────────────────────
if [[ "$PITR_MODE" -eq 1 ]]; then
  for cmd in pg_ctl initdb psql tar; do
    if ! command -v "$cmd" >/dev/null 2>&1; then
      echo "ERROR: '$cmd' not found in PATH (required for PITR mode)" >&2
      exit 1
    fi
  done
else
  for cmd in pg_restore createdb dropdb psql; do
    if ! command -v "$cmd" >/dev/null 2>&1; then
      echo "ERROR: '$cmd' not found in PATH" >&2
      exit 1
    fi
  done
fi

# ── PITR mode ─────────────────────────────────────────────────────────────────
if [[ "$PITR_MODE" -eq 1 ]]; then
  echo "[pitr-test] PITR mode — target time: ${PITR_TARGET}"

  if [[ ! -d "$BASE_BACKUP_DIR" ]]; then
    echo "ERROR: base backup directory not found: ${BASE_BACKUP_DIR}" >&2
    exit 1
  fi
  if [[ ! -d "$WAL_ARCHIVE_DIR" ]]; then
    echo "ERROR: WAL archive directory not found: ${WAL_ARCHIVE_DIR}" >&2
    exit 1
  fi

  # Locate the newest base backup archive (or use a plain data directory).
  BASE_BACKUP_ARCHIVE="$(ls -1t "${BASE_BACKUP_DIR}"/base_*.tar.gz 2>/dev/null | head -n1 || true)"
  if [[ -z "$BASE_BACKUP_ARCHIVE" && ! -f "${BASE_BACKUP_DIR}/PG_VERSION" ]]; then
    echo "ERROR: no base backup found in ${BASE_BACKUP_DIR}/ (expected base_*.tar.gz or a data directory)" >&2
    exit 1
  fi

  if [[ -z "$PITR_DATA_DIR" ]]; then
    PITR_DATA_DIR="$(mktemp -d "${TMPDIR:-/tmp}/pitr-restore.XXXXXX")"
    PITR_OWN_DATA_DIR=1
  fi
  mkdir -p "$PITR_DATA_DIR"

  pitr_cleanup() {
    if [[ "$PITR_STARTED" -eq 1 ]]; then
      echo "[pitr-test] stopping throwaway instance ..."
      pg_ctl -D "$PITR_DATA_DIR" -m immediate stop >/dev/null 2>&1 || true
    fi
    if [[ "$PITR_OWN_DATA_DIR" -eq 1 ]]; then
      echo "[pitr-test] removing temporary data directory ${PITR_DATA_DIR} ..."
      rm -rf "$PITR_DATA_DIR"
    fi
  }
  trap pitr_cleanup EXIT

  # Restore the physical base backup.
  if [[ -n "$BASE_BACKUP_ARCHIVE" ]]; then
    echo "[pitr-test] extracting base backup: ${BASE_BACKUP_ARCHIVE}"
    if ! tar -xzf "$BASE_BACKUP_ARCHIVE" -C "$PITR_DATA_DIR" --strip-components=1; then
      echo "ERROR: failed to extract base backup" >&2
      exit 1
    fi
  else
    echo "[pitr-test] copying base backup data directory: ${BASE_BACKUP_DIR}"
    if ! cp -a "${BASE_BACKUP_DIR}/." "$PITR_DATA_DIR/"; then
      echo "ERROR: failed to copy base backup data directory" >&2
      exit 1
    fi
  fi

  if [[ ! -f "${PITR_DATA_DIR}/PG_VERSION" ]]; then
    echo "ERROR: restored data directory is missing PG_VERSION — base backup invalid" >&2
    exit 1
  fi

  # Configure WAL restore from the archive and the recovery target.
  cat >> "${PITR_DATA_DIR}/postgresql.auto.conf" <<EOF
restore_command = 'cp "${WAL_ARCHIVE_DIR}/%f" "%p"'
recovery_target_time = '${PITR_TARGET}'
recovery_target_action = 'promote'
EOF

  # PostgreSQL ≥ 12 uses recovery.signal; older versions use recovery.conf.
  PG_MAJOR="$(cut -d. -f1 "${PITR_DATA_DIR}/PG_VERSION" 2>/dev/null || echo 12)"
  if [[ "${PG_MAJOR:-12}" -ge 12 ]]; then
    touch "${PITR_DATA_DIR}/recovery.signal"
  else
    cat >> "${PITR_DATA_DIR}/recovery.conf" <<EOF
restore_command = 'cp "${WAL_ARCHIVE_DIR}/%f" "%p"'
recovery_target_time = '${PITR_TARGET}'
recovery_target_action = 'promote'
EOF
  fi

  # Start the throwaway instance on a private port.
  echo "[pitr-test] starting throwaway instance on port ${PITR_PORT} ..."
  if ! pg_ctl -D "$PITR_DATA_DIR" \
      -o "-p ${PITR_PORT} -c listen_addresses='' -c unix_socket_directories='${PITR_DATA_DIR}'" \
      -w -t 300 start; then
    echo "ERROR: failed to start restored instance (WAL replay failed?)" >&2
    exit 1
  fi
  PITR_STARTED=1

  # Verify the instance reached the recovery target and is accepting queries.
  echo "[pitr-test] verifying recovery target reached ..."
  if ! psql -h "$PITR_DATA_DIR" -p "$PITR_PORT" -U "$PGUSER" -d postgres \
      -tAc "SELECT pg_is_in_recovery();" | grep -qx 'f'; then
    echo "ERROR: instance is still in recovery — target time not reached" >&2
    exit 1
  fi

  # Row-count sanity checks against the recovered database.
  pitr_query() {
    psql -h "$PITR_DATA_DIR" -p "$PITR_PORT" -U "$PGUSER" -d "$PGDATABASE" \
      -tAc "$1" 2>/dev/null
  }

  EVENTS_COUNT="$(pitr_query "SELECT COUNT(*) FROM events;" || echo "MISSING")"
  CONTRACTS_COUNT="$(pitr_query "SELECT COUNT(*) FROM contracts;" || echo "MISSING")"

  if [[ "$EVENTS_COUNT" == "MISSING" ]]; then
    echo "ERROR: 'events' table is missing from the recovered database" >&2
    exit 1
  fi
  if [[ "$CONTRACTS_COUNT" == "MISSING" ]]; then
    echo "ERROR: 'contracts' table is missing from the recovered database" >&2
    exit 1
  fi
  if ! [[ "$EVENTS_COUNT" =~ ^[0-9]+$ ]]; then
    echo "ERROR: unexpected events count value: '${EVENTS_COUNT}'" >&2
    exit 1
  fi

  echo "[pitr-test] events table:    ${EVENTS_COUNT} rows"
  echo "[pitr-test] contracts table: ${CONTRACTS_COUNT} rows"

  if [[ "$EVENTS_COUNT" -lt "$PITR_EXPECTED_EVENTS" ]]; then
    echo "ERROR: expected at least ${PITR_EXPECTED_EVENTS} events after PITR, got ${EVENTS_COUNT}" >&2
    exit 1
  fi

  echo "[pitr-test] PASS — PITR to ${PITR_TARGET} verified successfully"
  echo "[pitr-test] RPO target: ≤ 24 h (nightly base backup) / ≤ 5 min (with WAL archiving)"
  echo "[pitr-test] RTO target: ≤ 1 h (full restore) / ≤ 2 h (PITR incl. WAL replay)"
  exit 0
fi

# ── Locate dump file ──────────────────────────────────────────────────────────
if [[ -z "${DUMP_FILE:-}" ]]; then
  # Auto-select the newest dump in BACKUP_DIR.
  DUMP_FILE="$(ls -1t "${BACKUP_DIR}/${PGDATABASE}_"*.dump 2>/dev/null | head -n1 || true)"
  if [[ -z "$DUMP_FILE" ]]; then
    echo "ERROR: no dump files found in ${BACKUP_DIR}/ — run scripts/backup.sh first" >&2
    exit 1
  fi
fi

if [[ ! -f "$DUMP_FILE" ]]; then
  echo "ERROR: dump file not found: ${DUMP_FILE}" >&2
  exit 1
fi

echo "[restore-test] using dump: ${DUMP_FILE}"

# ── Cleanup trap ──────────────────────────────────────────────────────────────
cleanup() {
  echo "[restore-test] dropping test database ${TEST_DB} ..."
  dropdb -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" --if-exists "$TEST_DB" 2>/dev/null || true
}
trap cleanup EXIT

# ── Create fresh test database ────────────────────────────────────────────────
echo "[restore-test] creating test database: ${TEST_DB}"
dropdb -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" --if-exists "$TEST_DB"
createdb -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" "$TEST_DB"

# ── Restore ───────────────────────────────────────────────────────────────────
echo "[restore-test] restoring ..."
if ! pg_restore \
    -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" \
    -d "$TEST_DB" \
    --no-owner --no-privileges \
    --exit-on-error \
    "$DUMP_FILE"; then
  echo "ERROR: pg_restore failed" >&2
  exit 1
fi

echo "[restore-test] restore complete"

# ── Row-count sanity checks ───────────────────────────────────────────────────
# These checks confirm the schema and data were actually restored.
run_query() {
  psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$TEST_DB" \
    -tAc "$1" 2>/dev/null
}

echo "[restore-test] verifying tables ..."

EVENTS_COUNT="$(run_query "SELECT COUNT(*) FROM events;" 2>/dev/null || echo "MISSING")"
CONTRACTS_COUNT="$(run_query "SELECT COUNT(*) FROM contracts;" 2>/dev/null || echo "MISSING")"

if [[ "$EVENTS_COUNT" == "MISSING" ]]; then
  echo "ERROR: 'events' table is missing from the restored database" >&2
  exit 1
fi

if [[ "$CONTRACTS_COUNT" == "MISSING" ]]; then
  echo "ERROR: 'contracts' table is missing from the restored database" >&2
  exit 1
fi

echo "[restore-test] events table:    ${EVENTS_COUNT} rows"
echo "[restore-test] contracts table: ${CONTRACTS_COUNT} rows"

# Verify at least one sequence counter is sensible (non-negative integer).
if ! [[ "$EVENTS_COUNT" =~ ^[0-9]+$ ]]; then
  echo "ERROR: unexpected events count value: '${EVENTS_COUNT}'" >&2
  exit 1
fi

echo "[restore-test] PASS — restore verified successfully"
echo "[restore-test] RPO target: ≤ 24 h (nightly base backup) / ≤ 5 min (with WAL archiving)"
echo "[restore-test] RTO target: ≤ 1 h (typical indexer database < 50 GB)"
echo "[restore-test] RTO target: ≤ 2 h (PITR incl. WAL replay)"
