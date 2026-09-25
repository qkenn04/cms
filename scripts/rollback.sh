#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Lùi CMS về image của một commit đã build — không git, không build (root chạy tay trên VPS).
#   rollback.sh <sha>    sha đủ 40 ký tự hex (kéo từ GHCR nếu máy chưa có), hoặc ≥7 ký tự đầu
#                        nếu image đó còn trong máy (docker image ls ghcr.io/qkenn04/cms)
# Nên cài như bản sao root giống receiver deploy (xem CLAUDE.md "Deploy"):
#   install -o root -g root -m 0755 scripts/rollback.sh /usr/local/bin/qkenn-cms-rollback
# Dùng chung khoá flock + file log với qkenn-cms-deploy; compose/.env có sẵn ở /root/cms.
# Lưu ý: KHÔNG đảo migration. Schema đã đổi → restore /root/backups/cms/pre-deploy-*.sql.gz
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail
export LC_ALL=C
umask 077
exec </dev/null
unset COMPOSE_FILE COMPOSE_PROJECT_NAME COMPOSE_PROFILES COMPOSE_ENV_FILES COMPOSE_PATH_SEPARATOR

IMAGE_REPO=ghcr.io/qkenn04/cms
SERVICE=cms
APP_CONTAINER=cms-app
COMPOSE_DIR=/root/cms
LOG_FILE=/var/log/qkenn-cms-deploy.log
LOCK_FILE=/run/qkenn-cms-deploy.lock
LOCK_WAIT=600
HEALTH_URL=http://127.0.0.1:3002/api/health
HEALTH_TRIES=30
HEALTH_DELAY=2

# Override CHỈ dành cho test cục bộ (scripts/test-deploy.sh); phiên SSH luôn dùng giá trị cố định
if [ -z "${SSH_CONNECTION:-}${SSH_CLIENT:-}" ]; then
  COMPOSE_DIR="${QKENN_CMS_COMPOSE_DIR:-$COMPOSE_DIR}"
  LOG_FILE="${QKENN_CMS_LOG:-$LOG_FILE}"
  LOCK_FILE="${QKENN_CMS_LOCK:-$LOCK_FILE}"
  LOCK_WAIT="${QKENN_CMS_LOCK_WAIT:-$LOCK_WAIT}"
fi
COMPOSE_FILE_PATH="$COMPOSE_DIR/docker-compose.yml"
ENV_FILE="$COMPOSE_DIR/.env"

log() {
  printf '%s\n' "$*" 2>/dev/null || true
  printf '%s [%s rollback] %s\n' "$(date -u +%FT%TZ)" "$$" "$*" 2>/dev/null >>"$LOG_FILE" || true
}

die() {
  printf '✗ LỖI: %s\n' "$*" >&2 2>/dev/null || true
  printf '%s [%s rollback] ✗ LỖI: %s\n' "$(date -u +%FT%TZ)" "$$" "$*" 2>/dev/null >>"$LOG_FILE" || true
  exit 1
}

check_trusted() {
  local p="$1" kind="$2" owner mode
  if [ -L "$p" ]; then die "$p là symlink — từ chối"; fi
  if [ "$kind" = dir ] && [ ! -d "$p" ]; then die "không có thư mục $p"; fi
  if [ "$kind" = file ] && [ ! -f "$p" ]; then die "không có file $p"; fi
  owner="$(stat -c %u -- "$p")"
  mode="$(stat -c %a -- "$p")"
  if [ "$owner" != "$(id -u)" ]; then die "$p thuộc uid $owner, không phải uid $(id -u) — từ chối"; fi
  if (((8#$mode & 8#022) != 0)); then die "$p ghi được bởi group/other (mode $mode) — từ chối"; fi
}

compose() {
  local tag="$1"
  shift
  IMAGE_TAG="$tag" docker compose --project-directory "$COMPOSE_DIR" \
    -f "$COMPOSE_FILE_PATH" --env-file "$ENV_FILE" "$@" 2>&1 | tail -n 3
}

health_ok() {
  local i body
  for ((i = 1; i <= HEALTH_TRIES; i++)); do
    body="$(curl -fsS --max-time 3 "$HEALTH_URL" 2>/dev/null)" || body=""
    if [[ $body == *'"status":"ok"'* ]]; then return 0; fi
    if [ "$i" -lt "$HEALTH_TRIES" ]; then sleep "$HEALTH_DELAY"; fi
  done
  return 1
}

# ── Tham số: đúng 1 sha hex, không bao giờ eval ─────────────────────────────
if [ "$#" -ne 1 ]; then die "cách dùng: rollback.sh <sha>  (40 ký tự hex, hoặc ≥7 ký tự đầu nếu image còn trong máy)"; fi
WANT="${1,,}"
if [[ ! $WANT =~ ^[0-9a-f]{7,40}$ ]]; then
  die "sha không hợp lệ: $(printf '%q' "${1:0:80}") — cần 7–40 ký tự hex"
fi

check_trusted "$COMPOSE_DIR" dir
check_trusted "$COMPOSE_FILE_PATH" file
check_trusted "$ENV_FILE" file
if [[ ! $LOCK_WAIT =~ ^[0-9]+$ ]]; then die "LOCK_WAIT không hợp lệ: $LOCK_WAIT"; fi
exec 9>>"$LOCK_FILE"
waited=0
until flock -n 9; do # flock -n + chờ từng giây: chạy được với cả util-linux lẫn busybox flock
  if [ "$waited" -ge "$LOCK_WAIT" ]; then
    die "đang có deploy/rollback khác chạy — chờ ${LOCK_WAIT}s vẫn chưa lấy được khoá"
  fi
  sleep 1
  waited=$((waited + 1))
done

# sha ngắn → tìm trong các tag (40 hex) của image đã có trong máy; phải khớp đúng 1
if [ "${#WANT}" -eq 40 ]; then
  TAG="$WANT"
else
  mapfile -t matches < <(docker image ls --format '{{.Tag}}' "$IMAGE_REPO" 2>/dev/null |
    grep -E '^[0-9a-f]{40}$' | awk -v p="$WANT" 'index($0, p) == 1' | sort -u || true)
  if [ "${#matches[@]}" -eq 0 ]; then
    die "không có image $IMAGE_REPO:$WANT… trong máy — truyền đủ 40 ký tự sha để kéo từ GHCR"
  fi
  if [ "${#matches[@]}" -gt 1 ]; then
    die "sha $WANT khớp ${#matches[@]} image (${matches[*]}) — cần thêm ký tự"
  fi
  TAG="${matches[0]}"
fi

PREV="$(docker inspect --type container --format '{{.Config.Image}}' "$APP_CONTAINER" 2>/dev/null || true)"
log "→ lùi CMS về $IMAGE_REPO:$TAG (đang chạy: ${PREV:-không có})"
if ! compose "$TAG" pull "$SERVICE"; then
  if docker image inspect "$IMAGE_REPO:$TAG" >/dev/null 2>&1; then
    log "  ⚠ không kéo được từ GHCR — dùng image có sẵn trong máy"
  else
    die "không kéo được $IMAGE_REPO:$TAG và máy không có sẵn — không đổi gì"
  fi
fi
compose "$TAG" up -d "$SERVICE" || die "docker compose up lỗi"
if ! health_ok; then
  die "health check thất bại sau rollback (xem: docker logs --tail 60 $APP_CONTAINER)"
fi
NOW="$(docker inspect --type container --format '{{.Config.Image}}' "$APP_CONTAINER" 2>/dev/null || true)"
if [ "$NOW" != "$IMAGE_REPO:$TAG" ]; then
  die "health OK nhưng $APP_CONTAINER đang chạy '$NOW', không phải $IMAGE_REPO:$TAG — kiểm tra image: trong $COMPOSE_FILE_PATH"
fi
log "✅ CMS đang chạy $IMAGE_REPO:$TAG"
log "RESULT=rolled-back IMAGE=$TAG"
