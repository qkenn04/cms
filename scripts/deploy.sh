#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# qkenn-cms-deploy — nhận lệnh deploy Payload CMS từ GitHub Actions (SSH forced command).
#
# Cài (bản chạy thật là BẢN SAO root sở hữu, KHÔNG chạy thẳng từ repo — xem CLAUDE.md "Deploy"):
#   install -o root -g root -m 0755 scripts/deploy.sh /usr/local/bin/qkenn-cms-deploy
# Gọi: forced command của khoá deploy trong /root/.ssh/authorized_keys:
#   restrict,command="/usr/local/bin/qkenn-cms-deploy" ssh-ed25519 AAAA… github-actions-cms-deploy
# Lệnh lấy từ SSH_ORIGINAL_COMMAND; root chạy tay trên VPS thì truyền làm tham số:
#   qkenn-cms-deploy deploy <sha40>
#
# Lệnh (khớp CHÍNH XÁC, mọi thứ khác bị từ chối, không bao giờ eval):
#   deploy <sha40>   chạy image ghcr.io/qkenn04/cms:<sha40> (CI đã build + đẩy lên GHCR)
#
# Các bước (giữ khoá flock suốt quá trình):
#   1. docker compose pull cms  (lỗi → DỪNG, container cũ vẫn chạy, chưa đụng gì)
#   2. pg_dump cms-db → $BACKUP_DIR/pre-deploy-*.sql.gz (chmod 600, giữ KEEP_DUMPS bản mới nhất)
#   3. docker compose up -d     (migration chạy lúc app khởi động)
#   4. health check $HEALTH_URL + container chạy đúng image vừa deploy
#   Hỏng ở 3/4 → lùi về tag image đang chạy trước đó, exit 1. Migration KHÔNG tự đảo — cần thì
#   restore dump ở bước 2.
#
# KHÔNG git pull/fetch, KHÔNG chạy file nào lấy từ repo: dùng docker-compose.yml + .env ĐÃ CÓ ở
# $COMPOSE_DIR (mặc định /root/cms). Đổi compose = admin review rồi `git -C /root/cms pull` tay.
# stdout hiện trong log GitHub Actions (repo public) → log container chỉ ghi vào $LOG_FILE.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail
export LC_ALL=C
umask 077
trap '' HUP PIPE # CI đứt kết nối giữa chừng vẫn chạy nốt (kể cả bước lùi image)
exec </dev/null
# Không để môi trường đổi file compose / project mà docker compose dùng
unset COMPOSE_FILE COMPOSE_PROJECT_NAME COMPOSE_PROFILES COMPOSE_ENV_FILES COMPOSE_PATH_SEPARATOR

IMAGE_REPO=ghcr.io/qkenn04/cms
SERVICE=cms
APP_CONTAINER=cms-app
DB_CONTAINER=cms-db
COMPOSE_DIR=/root/cms
BACKUP_DIR=/root/backups/cms
LOG_FILE=/var/log/qkenn-cms-deploy.log
LOCK_FILE=/run/qkenn-cms-deploy.lock # /run chỉ root ghi được (khác /run/lock ai cũng ghi được)
LOCK_WAIT=600                        # giây chờ deploy/rollback khác xong
KEEP_DUMPS=10
HEALTH_URL=http://127.0.0.1:3002/api/health
HEALTH_TRIES=30
HEALTH_DELAY=2

# Override CHỈ dành cho test cục bộ (scripts/test-deploy.sh). Chạy qua SSH (có SSH_CONNECTION)
# thì luôn dùng giá trị cố định ở trên — client không thể đổi thư mục compose / backup / log.
if [ -z "${SSH_CONNECTION:-}${SSH_CLIENT:-}" ]; then
  COMPOSE_DIR="${QKENN_CMS_COMPOSE_DIR:-$COMPOSE_DIR}"
  BACKUP_DIR="${QKENN_CMS_BACKUP_DIR:-$BACKUP_DIR}"
  LOG_FILE="${QKENN_CMS_LOG:-$LOG_FILE}"
  LOCK_FILE="${QKENN_CMS_LOCK:-$LOCK_FILE}"
  LOCK_WAIT="${QKENN_CMS_LOCK_WAIT:-$LOCK_WAIT}"
fi
COMPOSE_FILE_PATH="$COMPOSE_DIR/docker-compose.yml"
ENV_FILE="$COMPOSE_DIR/.env"
CLIENT="${SSH_CONNECTION:-local}"
CLIENT="${CLIENT%% *}"
WORK=""
DUMP=""

# ── Tiện ích ────────────────────────────────────────────────────────────────
log() {
  printf '%s\n' "$*" 2>/dev/null || true
  printf '%s [%s %s] %s\n' "$(date -u +%FT%TZ)" "$$" "$CLIENT" "$*" 2>/dev/null >>"$LOG_FILE" || true
}

# Chỉ ghi file log trên VPS — KHÔNG ra stdout (= log CI công khai)
log_private() {
  local ts line
  ts="$(date -u +%FT%TZ)"
  while IFS= read -r line; do
    printf '%s [%s %s]   | %s\n' "$ts" "$$" "$CLIENT" "$line"
  done <<<"$*" 2>/dev/null >>"$LOG_FILE" || true
}

die() {
  printf '✗ LỖI: %s\n' "$*" >&2 2>/dev/null || true
  printf '%s [%s %s] ✗ LỖI: %s\n' "$(date -u +%FT%TZ)" "$$" "$CLIENT" "$*" 2>/dev/null >>"$LOG_FILE" || true
  exit 1
}

cleanup() {
  if [ -n "$WORK" ] && [ -d "$WORK" ]; then rm -rf -- "$WORK"; fi
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# Thứ root sẽ dùng phải là file/thư mục thật (không symlink), thuộc user đang chạy (root trên VPS)
# và group/other không ghi được → không ai ngoài root đổi được cấu hình mà root sẽ chạy.
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

preflight() {
  local c
  if [[ ! $LOCK_WAIT =~ ^[0-9]+$ ]]; then die "LOCK_WAIT không hợp lệ: $LOCK_WAIT"; fi
  check_trusted "$COMPOSE_DIR" dir
  check_trusted "$COMPOSE_FILE_PATH" file
  check_trusted "$ENV_FILE" file
  for c in docker curl flock gzip; do
    command -v "$c" >/dev/null 2>&1 || die "thiếu lệnh '$c' trên PATH"
  done
  WORK="$(mktemp -d)"
}

# flock -n + chờ từng giây (thay vì flock -w): chạy được với cả util-linux lẫn busybox flock
acquire_lock() {
  local waited=0
  exec 9>>"$LOCK_FILE"
  until flock -n 9; do
    if [ "$waited" -ge "$LOCK_WAIT" ]; then
      die "đang có deploy/rollback khác chạy — chờ ${LOCK_WAIT}s vẫn chưa lấy được khoá"
    fi
    if [ "$waited" -eq 0 ]; then log "  … đang có deploy/rollback khác — chờ tối đa ${LOCK_WAIT}s"; fi
    sleep 1
    waited=$((waited + 1))
  done
}

# compose <tag> <args…>: docker compose với ĐÚNG file compose + .env có sẵn trên VPS, IMAGE_TAG=<tag>.
# Toàn bộ output vào $LOG_FILE; stdout chỉ in dòng cuối.
compose() {
  local tag="$1" rc=0 out last
  shift
  out="$(IMAGE_TAG="$tag" docker compose --project-directory "$COMPOSE_DIR" \
    -f "$COMPOSE_FILE_PATH" --env-file "$ENV_FILE" "$@" 2>&1)" || rc=$?
  log_private "docker compose $* (IMAGE_TAG=$tag) → rc=$rc"
  if [ -n "$out" ]; then log_private "$out"; fi
  last="$(printf '%s\n' "$out" | tail -n 1)"
  if [ -n "$last" ]; then log "    ${last:0:160}"; fi
  return "$rc"
}

# Image của container app đang chạy ("" nếu chưa có)
running_image() {
  docker inspect --type container --format '{{.Config.Image}}' "$APP_CONTAINER" 2>/dev/null || true
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

# Dump DB ngay trước khi image mới (có thể mang migration) khởi động
dump_db() {
  local sha="$1" dump tmp rc=0 n i
  local -a dumps=()
  if ! docker inspect --type container "$DB_CONTAINER" >/dev/null 2>&1; then
    log "  – chưa có container $DB_CONTAINER (lần deploy đầu) — bỏ qua dump"
    return 0
  fi
  mkdir -p -- "$BACKUP_DIR"
  rm -f -- "$BACKUP_DIR"/pre-deploy-*.partial # rác của lần chạy bị kill
  dump="$BACKUP_DIR/pre-deploy-$(date +%Y%m%d-%H%M%S)-${sha:0:12}.sql.gz"
  tmp="$dump.partial"
  # User/DB lấy từ env của chính container db (shell TRONG container mở rộng) → không source .env
  # shellcheck disable=SC2016
  docker exec "$DB_CONTAINER" sh -c 'exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB"' \
    2>"$WORK/pg_dump.err" | gzip >"$tmp" || rc=$?
  if [ "$rc" -ne 0 ]; then
    rm -f -- "$tmp"
    log_private "$(cat -- "$WORK/pg_dump.err" 2>/dev/null)"
    log "RESULT=failed IMAGE=$sha"
    die "pg_dump lỗi (rc=$rc) — DỪNG trước khi đổi container, bản cũ vẫn chạy (chi tiết: $LOG_FILE)"
  fi
  chmod 600 -- "$tmp"
  mv -f -- "$tmp" "$dump"
  DUMP="$dump"
  log "  ✓ $dump ($(du -h -- "$dump" | cut -f1))"
  # Tên bắt đầu bằng timestamp → thứ tự glob (LC_ALL=C) = thứ tự thời gian; xoá bản cũ nhất
  shopt -s nullglob
  dumps=("$BACKUP_DIR"/pre-deploy-*.sql.gz)
  shopt -u nullglob
  n=$((${#dumps[@]} - KEEP_DUMPS))
  for ((i = 0; i < n; i++)); do
    rm -f -- "${dumps[i]}"
    log_private "đã xoá dump cũ ${dumps[i]}"
  done
}

# Hỏng SAU khi đã đổi container → lùi về tag đang chạy trước đó (nếu có), rồi exit 1
fail_and_roll_back() {
  local reason="$1" sha="$2" prev_tag="$3"
  log "✗ $reason"
  log_private "── docker logs --tail 60 $APP_CONTAINER ──"
  log_private "$(docker logs --tail 60 "$APP_CONTAINER" 2>&1 || true)"
  log "  (log container ghi trong $LOG_FILE trên VPS — không in ra đây vì log CI công khai)"
  if [ -z "$prev_tag" ]; then
    log "  không có image trước đó hợp lệ để lùi về — CMS có thể đang KHÔNG chạy"
    log "RESULT=failed IMAGE=$sha"
    exit 1
  fi
  if [ "$prev_tag" = "$sha" ]; then
    log "  image trước đó cũng là $sha — không có gì để lùi"
    log "RESULT=failed IMAGE=$sha"
    exit 1
  fi
  log "↩ lùi về $IMAGE_REPO:$prev_tag"
  if compose "$prev_tag" up -d "$SERVICE" && health_ok; then
    log "  ✓ đã lùi về $prev_tag, health OK"
  else
    log "  ✗ đã lùi về $prev_tag nhưng health VẪN lỗi — cần xử lý tay"
  fi
  if [ -n "$DUMP" ]; then log "  → nếu migration mới đã đổi schema/dữ liệu: restore $DUMP"; fi
  log "RESULT=rolled-back IMAGE=$prev_tag FAILED=$sha"
  exit 1
}

# ── deploy <sha40> ──────────────────────────────────────────────────────────
cmd_deploy() {
  local sha="$1" prev prev_tag="" now
  preflight
  acquire_lock
  log "→ deploy $IMAGE_REPO:$sha (compose: $COMPOSE_FILE_PATH)"

  prev="$(running_image)"
  if [[ $prev == "$IMAGE_REPO:"* ]]; then
    prev_tag="${prev#"$IMAGE_REPO:"}"
    if [[ ! $prev_tag =~ ^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$ ]]; then prev_tag=""; fi
  fi
  if [ -n "$prev" ]; then log "  đang chạy: ${prev:0:100}"; fi

  log "═══ 1/4 Kéo image từ GHCR ═══"
  if ! compose "$sha" pull "$SERVICE"; then
    log "RESULT=failed IMAGE=$sha"
    die "không kéo được $IMAGE_REPO:$sha (CI chưa đẩy xong / chưa login ghcr.io?) — DỪNG, bản cũ vẫn chạy"
  fi

  log "═══ 2/4 Dump DB trước deploy ═══"
  dump_db "$sha"

  log "═══ 3/4 Khởi động (migration chạy lúc boot) ═══"
  if ! compose "$sha" up -d; then
    fail_and_roll_back "docker compose up lỗi" "$sha" "$prev_tag"
  fi

  log "═══ 4/4 Health check ═══"
  if ! health_ok; then
    fail_and_roll_back "HEALTH CHECK THẤT BẠI ($HEALTH_URL)" "$sha" "$prev_tag"
  fi
  now="$(running_image)"
  if [ "$now" != "$IMAGE_REPO:$sha" ]; then
    log "RESULT=failed IMAGE=$sha"
    die "health OK nhưng $APP_CONTAINER đang chạy '${now:0:100}', không phải $IMAGE_REPO:$sha — kiểm tra image: trong $COMPOSE_FILE_PATH"
  fi
  log "✅ DEPLOY THÀNH CÔNG — $IMAGE_REPO:$sha"
  log "RESULT=deployed IMAGE=$sha"
}

# ── Phân tích lệnh (khớp chính xác, không bao giờ eval) ─────────────────────
CMD_LINE="${SSH_ORIGINAL_COMMAND-$*}"
re_deploy='^deploy ([0-9a-f]{40})$'

if [ "${#CMD_LINE}" -gt 120 ]; then
  die "lệnh bị từ chối (quá dài: ${#CMD_LINE} ký tự)"
elif [[ $CMD_LINE =~ $re_deploy ]]; then
  cmd_deploy "${BASH_REMATCH[1]}"
else
  die "lệnh bị từ chối: $(printf '%q' "$CMD_LINE") — chỉ nhận: deploy <sha 40 ký tự hex chữ thường>"
fi
