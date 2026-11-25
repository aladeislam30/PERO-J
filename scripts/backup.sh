#!/usr/bin/env bash
#
# Automated PostgreSQL backup using pg_dump.
#
# Produces a custom-format dump (-Fc), optionally uploads it to S3 using
# server-side AES-256 encryption (SSE-S3), and prunes old local dumps.
#
# Configurable via environment variables (see .env.example):
#   PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE
#   BACKUP_DIR       directory to write dumps into (default: ./backups)
#   RETENTION_DAYS   delete local dumps older than N days (default: 7)
#   BACKUP_S3_BUCKET S3 bucket name for remote upload (optional)
#   BACKUP_S3_PREFIX key prefix inside the bucket (default: postgres-backups)
#   BACKUP_S3_REGION AWS region (default: us-east-1)
#   AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY — standard AWS env vars
#                    (or use an IAM instance role / profile)
#
# WAL archiving (point-in-time recovery) note:
#   This script produces the daily base backup. Continuous WAL archiving is
#   configured on the PostgreSQL server (postgresql.conf), e.g.:
#     wal_level = replica
#     archive_mode = on
#     archive_command = 'aws s3 cp %p s3://$BACKUP_S3_BUCKET/wal/%f --sse aws:kms'
#   Together, base backups + WAL archiving provide PITR with RPO as low as the
#   WAL shipping interval (~5 min on a busy testnet node).
#
#   When BACKUP_S3_BUCKET is set, this script validates that archive_mode is
#   enabled and that archive_command is configured, and (unless
#   BACKUP_SKIP_WAL_UPLOAD=1) uploads any pending WAL segments from the local
#   archive directory to the encrypted S3 bucket as a safety net.
#   See docs/backup.md for the full PITR setup and recovery runbook.
#
# Cron (daily at 02:00 UTC):
#   0 2 * * * cd /path/to/repo && ./scripts/backup.sh >> /var/log/pg-backup.log 2>&1
#
# Any failure exits non-zero so cron/schedulers can alert.
#
# Restore procedure: see docs/backup.md

set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-./backups}"
RETENTION_DAYS="${RETENTION_DAYS:-7}"
BACKUP_S3_BUCKET="${BACKUP_S3_BUCKET:-}"
BACKUP_S3_PREFIX="${BACKUP_S3_PREFIX:-postgres-backups}"
BACKUP_S3_REGION="${BACKUP_S3_REGION:-us-east-1}"
BACKUP_SKIP_WAL_UPLOAD="${BACKUP_SKIP_WAL_UPLOAD:-0}"
MIN_DUMP_BYTES=512

# Derive connection settings from DATABASE_URL when individual PG* vars are unset.
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

export PGHOST PGPORT PGUSER PGDATABASE
[[ -n "${PGPASSWORD:-}" ]] && export PGPASSWORD

mkdir -p "$BACKUP_DIR"

TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DUMP_FILE="${BACKUP_DIR}/${PGDATABASE}_${TIMESTAMP}.dump"

if ! command -v pg_dump >/dev/null 2>&1; then
  echo "ERROR: pg_dump not found in PATH" >&2
  exit 1
fi

echo "[backup] dumping ${PGDATABASE}@${PGHOST}:${PGPORT} -> ${DUMP_FILE}"

# Custom format (-Fc) supports selective restore via pg_restore.
if ! pg_dump -Fc -f "$DUMP_FILE"; then
  echo "ERROR: pg_dump failed" >&2
  rm -f "$DUMP_FILE"
  exit 1
fi

# Validate the dump is non-trivial (>512 bytes).
DUMP_SIZE="$(wc -c < "$DUMP_FILE" | tr -d ' ')"
if [[ "$DUMP_SIZE" -le "$MIN_DUMP_BYTES" ]]; then
  echo "ERROR: dump ${DUMP_FILE} is only ${DUMP_SIZE} bytes (expected > ${MIN_DUMP_BYTES})" >&2
  rm -f "$DUMP_FILE"
  exit 1
fi

echo "[backup] ok: ${DUMP_FILE} (${DUMP_SIZE} bytes)"

# ── Optional S3 upload with SSE-S3 server-side encryption ────────────────────
if [[ -n "$BACKUP_S3_BUCKET" ]]; then
  if ! command -v aws >/dev/null 2>&1; then
    echo "ERROR: aws CLI not found in PATH; cannot upload to S3" >&2
    exit 1
  fi

  S3_KEY="${BACKUP_S3_PREFIX}/${PGDATABASE}_${TIMESTAMP}.dump"
  S3_URI="s3://${BACKUP_S3_BUCKET}/${S3_KEY}"

  echo "[backup] uploading to ${S3_URI} (SSE-S3)"
  if ! aws s3 cp "$DUMP_FILE" "$S3_URI" \
       --region "$BACKUP_S3_REGION" \
       --sse aws:kms \
       --storage-class STANDARD_IA \
       --no-progress; then
    echo "ERROR: S3 upload failed" >&2
    # Keep the local dump so an operator can retry or recover manually.
    exit 1
  fi

  echo "[backup] S3 upload complete: ${S3_URI}"

  # Verify the object is reachable (ensures the upload is fully committed).
  if ! aws s3 ls "$S3_URI" --region "$BACKUP_S3_REGION" >/dev/null 2>&1; then
    echo "ERROR: S3 object not visible after upload — treating as upload failure" >&2
    exit 1
  fi

  echo "[backup] S3 object verified"

  # ── WAL archiving validation + safety-net upload ──────────────────────────
  if [[ "$BACKUP_SKIP_WAL_UPLOAD" != "1" ]]; then
    echo "[backup] validating WAL archiving configuration"

    ARCHIVE_MODE="$(psql -tAc 'SHOW archive_mode' 2>/dev/null | tr -d '[:space:]' || true)"
    if [[ -z "$ARCHIVE_MODE" ]]; then
      echo "ERROR: could not query archive_mode; is psql available and the server reachable?" >&2
      exit 1
    fi
    if [[ "$ARCHIVE_MODE" != "on" && "$ARCHIVE_MODE" != "always" ]]; then
      echo "ERROR: archive_mode is '${ARCHIVE_MODE}', expected 'on' or 'always' for PITR" >&2
      exit 1
    fi

    ARCHIVE_COMMAND="$(psql -tAc 'SHOW archive_command' 2>/dev/null | tr -d '\r' || true)"
    if [[ -z "$ARCHIVE_COMMAND" || "$ARCHIVE_COMMAND" == "(disabled)" ]]; then
      echo "ERROR: archive_command is not configured; PITR WAL archiving is disabled" >&2
      exit 1
    fi
    echo "[backup] WAL archiving ok (archive_mode=${ARCHIVE_MODE})"

    # Upload any pending WAL segments from the local archive directory.
    WAL_ARCHIVE_DIR="$(psql -tAc 'SHOW archive_command' 2>/dev/null \
      | sed -nE 's#.*%p.*#&#p' >/dev/null; psql -tAc 'SHOW data_directory' 2>/dev/null | tr -d '[:space:]' || true)"
    if [[ -n "$WAL_ARCHIVE_DIR" && -d "${WAL_ARCHIVE_DIR}/pg_wal/archive_status" ]]; then
      shopt -s nullglob
      PENDING_WAL=("${WAL_ARCHIVE_DIR}/pg_wal/"*.ready)
      shopt -u nullglob
      if [[ "${#PENDING_WAL[@]}" -gt 0 ]]; then
        echo "[backup] uploading ${#PENDING_WAL[@]} pending WAL segment(s) to s3://${BACKUP_S3_BUCKET}/wal/"
        for ready in "${PENDING_WAL[@]}"; do
          wal_seg="${ready%.ready}"
          if ! aws s3 cp "$wal_seg" "s3://${BACKUP_S3_BUCKET}/wal/$(basename "$wal_seg")" \
               --region "$BACKUP_S3_REGION" \
               --sse aws:kms \
               --storage-class STANDARD_IA \
               --no-progress; then
            echo "ERROR: WAL segment upload failed for ${wal_seg}" >&2
            exit 1
          fi
        done
        echo "[backup] pending WAL segments uploaded"
      else
        echo "[backup] no pending WAL segments to upload"
      fi
    else
      echo "[backup] WAL archive directory not accessible locally; skipping safety-net upload"
    fi
  else
    echo "[backup] BACKUP_SKIP_WAL_UPLOAD=1; skipping WAL validation/upload"
  fi
fi

# ── Prune old local dumps ─────────────────────────────────────────────────────
if [[ "$RETENTION_DAYS" -gt 0 ]]; then
  find "$BACKUP_DIR" -maxdepth 1 -name "${PGDATABASE}_*.dump" -type f \
    -mtime "+${RETENTION_DAYS}" -print -delete
fi

echo "[backup] done"
