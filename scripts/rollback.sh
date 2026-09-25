#!/usr/bin/env bash
# Lùi CMS về image của một commit đã deploy — vài giây, không build.
#   ./scripts/rollback.sh <commit-sha>
# Lưu ý: không đảo migration. Nếu schema đã đổi, restore dump /root/backups/cms/pre-deploy-*.sql.gz
set -euo pipefail
cd "$(dirname "$0")/.."
SHA="${1:?usage: rollback.sh <commit-sha>}"
FULL=$(git rev-parse --verify "$SHA^{commit}" 2>/dev/null) || { echo "❌ không tìm thấy commit $SHA"; exit 1; }
echo "→ lùi CMS về $(git log -1 --format='%h %s' "$FULL")"
export IMAGE_TAG="$FULL"
docker compose pull cms 2>&1 | tail -1
docker compose up -d cms 2>&1 | tail -1
for i in $(seq 1 30); do
  curl -fsS --max-time 3 http://127.0.0.1:3002/api/health 2>/dev/null | grep -q '"status":"ok"' && { echo "✅ CMS đang chạy image $FULL"; exit 0; }
  sleep 2
done
echo "❌ health check thất bại sau rollback"; exit 1
