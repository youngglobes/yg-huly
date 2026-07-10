#!/usr/bin/env bash
#
# Nightly Huly DR backup -> S3.
# Incremental workspace backup (DB only; blobs are durable in the versioned live
# S3 bucket, so --skip blob keeps the backup small/fast) into a local dir, then
# mirror to the S3 backup bucket (scoped to our prefix). Retention: keepSnapshots
# 30d (tool-managed) + sync --delete. Age-based S3 lifecycle would corrupt the set.
#
# Deploy: lives at /home/developer/huly-selfhost/s3-backup.sh on the server.
# Cron (developer user):
#   30 2 * * *  /home/developer/huly-selfhost/s3-backup.sh          # nightly backup+sync
#   0  4 * * 0  /home/developer/huly-selfhost/s3-backup.sh compact  # weekly compaction
#
# Credentials: read at runtime from .mail.env (the SES IAM user, now with S3 access).
# No secrets are stored in this file.
#
# See migration/docs/2026-07-10-s3-storage-and-backup-design.md
set -uo pipefail

DIR=/home/developer/huly-selfhost
BACKUP_ROOT=/home/developer/backup
WS=yg
BUCKET="s3://ygs-sites-backup/backup/yg-huly/"
REGION=ap-southeast-1
LOG=/home/developer/s3-backup.log

cd "$DIR" || exit 1
exec >>"$LOG" 2>&1

AK=$(grep -oE '^#?SES_ACCESS_KEY=.*' .mail.env | tail -1 | cut -d= -f2- | tr -d '\r')
SK=$(grep -oE '^#?SES_SECRET_KEY=.*' .mail.env | tail -1 | cut -d= -f2- | tr -d '\r')

awscli() {
  docker run --rm \
    -e AWS_ACCESS_KEY_ID="$AK" -e AWS_SECRET_ACCESS_KEY="$SK" \
    -v "$BACKUP_ROOT/$WS:/data" amazon/aws-cli "$@"
}

if [ "${1:-}" = "compact" ]; then
  echo "===== compact $(date -u +%FT%TZ) ====="
  RUN_TOOL_DOCKER_ARGS="-v $BACKUP_ROOT:/backup" ./run-tool.sh backup-compact "/backup/$WS"
  echo "===== compact done $(date -u +%FT%TZ) rc=$? ====="
  exit 0
fi

echo "===== backup $(date -u +%FT%TZ) ====="
mkdir -p "$BACKUP_ROOT/$WS"

# 1. incremental workspace backup (DB only; blobs live in versioned S3)
RUN_TOOL_DOCKER_ARGS="-v $BACKUP_ROOT:/backup" ./run-tool.sh backup "/backup/$WS" "$WS" --skip blob --keepSnapshots 30
rc=$?
if [ "$rc" -ne 0 ]; then echo "backup FAILED rc=$rc — skipping sync"; exit "$rc"; fi

# 2. mirror to S3 (scoped to our prefix; --delete prunes what compact removed)
awscli s3 sync /data "$BUCKET" --region "$REGION" --delete
echo "===== done $(date -u +%FT%TZ) sync-rc=$? ====="
