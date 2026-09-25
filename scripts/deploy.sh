#!/usr/bin/env bash
# Deploy Payload CMS bằng 1 lệnh (GitHub Actions gọi qua SSH forced command):
#   pull repo → dump DB → PULL image từ GHCR → up (migration tự chạy lúc boot) → health check
#   Health check hỏng: tự lùi về image cũ. Migration KHÔNG tự đảo — cần thì restore dump ở bước 2.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BACKUP_DIR="/root/backups/cms"
HEALTH_URL="http://127.0.0.1:3002/api/health"
KEEP_DUMPS=10

cd "$REPO_DIR"
set -a; . ./.env; set +a

echo "═══ 1/5 Lấy code mới ═══"
if git pull --ff-only; then echo "  ✓ repo cập nhật"; else echo "  ⚠️ không pull được — deploy commit hiện có"; fi

echo "═══ 2/5 Dump DB trước deploy ═══"
mkdir -p "$BACKUP_DIR"
DUMP="$BACKUP_DIR/pre-deploy-$(date +%Y%m%d-%H%M%S).sql.gz"
if docker inspect cms-db >/dev/null 2>&1; then
  docker exec cms-db pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" | gzip > "$DUMP"
  chmod 600 "$DUMP"
  echo "  ✓ $DUMP ($(du -h "$DUMP" | cut -f1))"
  ls -1t "$BACKUP_DIR"/pre-deploy-*.sql.gz 2>/dev/null | tail -n +$((KEEP_DUMPS+1)) | xargs -r rm -f
else
  echo "  – chưa có cms-db (lần deploy đầu) — bỏ qua"
fi

echo "═══ 3/5 Kéo image từ GHCR ═══"
PREV_IMAGE=$(docker inspect cms-app --format '{{.Config.Image}}' 2>/dev/null || echo "")
export IMAGE_TAG
IMAGE_TAG=$(git rev-parse HEAD)
echo "  image : ghcr.io/qkenn04/cms:${IMAGE_TAG:0:12}…"
[ -n "$PREV_IMAGE" ] && echo "  đang chạy: ${PREV_IMAGE##*:}" | cut -c1-60
if ! docker compose pull cms 2>&1 | tail -1; then
  echo "❌ Không kéo được image — CI chưa build xong hoặc chưa login ghcr.io. DỪNG, bản cũ vẫn chạy."; exit 1
fi

echo "═══ 4/5 Khởi động (migration chạy lúc boot) ═══"
docker compose up -d 2>&1 | tail -2

echo "═══ 5/5 Health check ═══"
ok=0
for i in $(seq 1 30); do
  if curl -fsS --max-time 3 "$HEALTH_URL" 2>/dev/null | grep -q '"status":"ok"'; then ok=1; break; fi
  sleep 2
done

if [ "$ok" = "1" ]; then
  echo "✅ DEPLOY THÀNH CÔNG — $(git rev-parse --short HEAD) $(git log -1 --pretty=%s)"
else
  echo "❌ HEALTH CHECK THẤT BẠI"
  docker compose logs --tail=30 cms || true
  if [ -n "$PREV_IMAGE" ]; then
    IMAGE_TAG="${PREV_IMAGE##*:}" docker compose up -d cms 2>&1 | tail -1
    echo "  ↩️ đã lùi về image: ${PREV_IMAGE##*:}" | cut -c1-80
    echo "  → nếu migration mới làm hỏng dữ liệu: restore $DUMP"
  fi
  exit 1
fi
