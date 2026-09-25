#!/usr/bin/env bash
# Test scripts/deploy.sh (receiver qkenn-cms-deploy) + scripts/rollback.sh với docker/curl GIẢ.
# Chạy: bash scripts/test-deploy.sh      (cần bash, coreutils, flock, gzip)
# - docker/curl/sleep/git/ssh/wget giả nằm đầu PATH của script được test; docker giả chỉ ghi lại lệnh
#   + giả lập trạng thái trong thư mục tạm và TỪ CHỐI mọi compose ngoài thư mục tạm.
# - COMPOSE_DIR/backup/log/lock đều trong mktemp -d → không đụng /root/cms, /root/backups, /var/log.
# - Phần "SSH bỏ qua override" chạy trong container dùng-xong-bỏ (ubuntu:24.04, --network none)
#   nếu máy có sẵn image đó; không có thì SKIP. SKIP_DOCKER_TESTS=1 để bỏ hẳn.
# CI chạy file này trong job build; sửa deploy.sh/rollback.sh thì chạy lại trước khi cài lên VPS.
# SC2016: điều kiện kiểm tra cố ý để trong '…' cho eval đánh giá SAU khi chạy lệnh.
# SC2034: dump_b/n0 được đọc gián tiếp qua eval.
# shellcheck disable=SC2016,SC2034
set -euo pipefail
export LC_ALL=C
umask 022
unset SSH_CONNECTION SSH_CLIENT SSH_ORIGINAL_COMMAND IMAGE_TAG

HERE="$(cd "$(dirname "$0")" && pwd)"
DEPLOY="$HERE/deploy.sh"
ROLLBACK="$HERE/rollback.sh"
T="$(mktemp -d)"
HOLDER=""
cleanup() {
  if [ -n "$HOLDER" ]; then kill "$HOLDER" 2>/dev/null || true; fi
  rm -rf -- "$T"
}
trap cleanup EXIT

CD="$T/cms"       # COMPOSE_DIR giả
BK="$T/backups"   # BACKUP_DIR giả
S="$T/state"      # trạng thái docker giả
FB="$T/bin"       # lệnh giả
mkdir -p "$CD" "$S" "$FB"
printf 'name: cms\nservices:\n  cms:\n    image: ghcr.io/qkenn04/cms:${IMAGE_TAG:-latest}\n' >"$CD/docker-compose.yml"
printf 'POSTGRES_USER=cms\n' >"$CD/.env"
chmod 600 "$CD/.env"
export QKENN_CMS_COMPOSE_DIR="$CD" QKENN_CMS_BACKUP_DIR="$BK" QKENN_CMS_LOG="$T/deploy.log"
export QKENN_CMS_LOCK="$T/deploy.lock" QKENN_CMS_LOCK_WAIT=5
REPO=ghcr.io/qkenn04/cms

# ── Lệnh giả ────────────────────────────────────────────────────────────────
cat >"$FB/docker" <<'EOF'
#!/usr/bin/env bash
# docker GIẢ: ghi lại lệnh (IMAGE_TAG|args) vào $FAKE_STATE/calls, giả lập trạng thái bằng file
set -u
S="${FAKE_STATE:?}"
printf '%s|%s\n' "${IMAGE_TAG-}" "$*" >>"$S/calls"
REPO=ghcr.io/qkenn04/cms
last="${!#}"
case "${1:-}" in
  inspect)
    case "$last" in
      cms-app)
        if [ ! -s "$S/app_image" ]; then echo "Error: No such container: cms-app" >&2; exit 1; fi
        case "$*" in *--format*) cat "$S/app_image" ;; *) echo '[{}]' ;; esac ;;
      cms-db)
        if [ ! -e "$S/db" ]; then echo "Error: No such container: cms-db" >&2; exit 1; fi
        echo '[{}]' ;;
      *) echo "fake docker: inspect lạ: $*" >&2; exit 64 ;;
    esac ;;
  exec)
    if [ "${2:-}" != cms-db ]; then echo "fake docker: exec lạ: $*" >&2; exit 64; fi
    if [ -e "$S/dump_fail" ]; then echo 'pg_dump: error: connection to server failed' >&2; exit 1; fi
    echo '-- fake dump' ;;
  logs) echo 'FAKE-CONTAINER-LOG DATABASE_URL=postgresql://cms:TOPSECRET@db:5432/cms' ;;
  image)
    case "${2:-}" in
      ls) if [ -e "$S/local_tags" ]; then sort -u "$S/local_tags"; fi ;;
      inspect) grep -qxF -- "${last##*:}" "$S/local_tags" 2>/dev/null ;;
      *) echo "fake docker: image lạ: $*" >&2; exit 64 ;;
    esac ;;
  compose)
    shift
    pd=""
    while [ $# -gt 0 ]; do
      case "$1" in
        --project-directory) pd="$2"; shift 2 ;;
        -f | --env-file) shift 2 ;;
        *) break ;;
      esac
    done
    case "$pd" in
      "${FAKE_ROOT:?}"/*) ;;
      *) echo "fake docker: TỪ CHỐI compose ngoài thư mục test: '$pd'" >&2; exit 1 ;;
    esac
    tag="${IMAGE_TAG:-latest}"
    case "${1:-}" in
      pull)
        if [ -e "$S/pull_fail" ]; then echo 'Error response from daemon: manifest unknown' >&2; exit 1; fi
        echo "$tag" >>"$S/local_tags"
        echo ' cms Pulled' ;;
      up)
        if grep -qxF -- "$tag" "$S/up_fail_tags" 2>/dev/null; then
          echo 'Error response from daemon: container cms-app failed to start' >&2; exit 1
        fi
        if [ -s "$S/pin_image" ]; then cp "$S/pin_image" "$S/app_image"; else echo "$REPO:$tag" >"$S/app_image"; fi
        touch "$S/db"
        echo ' Container cms-app  Started' ;;
      *) echo "fake docker: compose lạ: $*" >&2; exit 64 ;;
    esac ;;
  *) echo "fake docker: lệnh lạ: $*" >&2; exit 64 ;;
esac
EOF
cat >"$FB/curl" <<'EOF'
#!/usr/bin/env bash
# curl GIẢ: health OK trừ khi tag đang chạy nằm trong $FAKE_STATE/unhealthy_tags
set -u
S="${FAKE_STATE:?}"
printf '%s\n' "$*" >>"$S/curl_calls"
case " $* " in
  *" http://127.0.0.1:3002/api/health "*) ;;
  *) echo "fake curl: URL lạ: $*" >&2; exit 99 ;;
esac
img="$(cat "$S/app_image" 2>/dev/null || true)"
if [ -z "$img" ]; then echo 'curl: (7) Failed to connect' >&2; exit 7; fi
if grep -qxF -- "${img##*:}" "$S/unhealthy_tags" 2>/dev/null; then
  echo 'curl: (22) The requested URL returned error: 503' >&2; exit 22
fi
printf '{"status":"ok"}'
EOF
cat >"$FB/sleep" <<'EOF'
#!/bin/sh
# sleep GIẢ: health check lặp ngay, không chờ
echo "$*" >>"${FAKE_STATE:?}/sleep_calls"
EOF
for c in git ssh scp wget; do
  cat >"$FB/$c" <<EOF
#!/bin/sh
# $c GIẢ: KHÔNG ĐƯỢC GỌI — ghi dấu và báo lỗi to
echo "$c \$*" >>"\${FAKE_STATE:?}/forbidden_called"
echo "FAKE $c: $c KHÔNG được phép gọi trong deploy/rollback" >&2
exit 97
EOF
done
chmod 755 "$FB"/*

# ── Khung test ──────────────────────────────────────────────────────────────
PASS=0
FAIL=0
SKIP=0
RC=0
OUT=""
ok() { PASS=$((PASS + 1)); printf '  ✓ %s\n' "$1"; }
ko() { FAIL=$((FAIL + 1)); printf '  ✗ %s\n' "$1"; printf '      rc=%s out: %s\n' "$RC" "$(printf '%s' "$OUT" | tail -n 4 | tr '\n' '|')"; }
check() { local d="$1"; shift; if "$@"; then ok "$d"; else ko "$d"; fi; }
section() { printf '\n== %s\n' "$1"; }

h() { printf '%s' "$1" | sha1sum | cut -c1-40; } # sha 40 hex chữ thường (có chữ a-f)
A=$(h A) B=$(h B) C=$(h C) D=$(h D) E=$(h E) F=$(h F) G=$(h G) H=$(h H) J=$(h J) K=$(h K)
TENV=(PATH="$FB:$PATH" FAKE_STATE="$S" FAKE_ROOT="$T")

# Chạy receiver như SSH forced command: $1 = SSH_ORIGINAL_COMMAND
run() { RC=0; env "${TENV[@]}" SSH_ORIGINAL_COMMAND="$1" bash "$DEPLOY" >"$T/out" 2>&1 || RC=$?; OUT="$(cat "$T/out")"; }
# Chạy tay (root trên VPS): lệnh qua tham số, không có SSH_ORIGINAL_COMMAND
run_args() { RC=0; env "${TENV[@]}" bash "$DEPLOY" "$@" >"$T/out" 2>&1 || RC=$?; OUT="$(cat "$T/out")"; }
run_rb() { RC=0; env "${TENV[@]}" bash "$ROLLBACK" "$@" >"$T/out" 2>&1 || RC=$?; OUT="$(cat "$T/out")"; }

has() { grep -qF -- "$1" <<<"$OUT"; }
lacks() { ! grep -qF -- "$1" <<<"$OUT"; }
rejected() { [ "$RC" -ne 0 ] && has "$1"; }
reset_calls() { : >"$S/calls"; }
no_calls() { [ ! -s "$S/calls" ]; }
called() { grep -qE -- "$1" "$S/calls"; }            # $1 = regex trên dòng "IMAGE_TAG|args"
line_of() { grep -nE -- "$1" "$S/calls" | head -n 1 | cut -d: -f1; }
running() { [ "$(cat "$S/app_image" 2>/dev/null)" = "$REPO:$1" ]; }
set_running() { echo "$REPO:$1" >"$S/app_image"; touch "$S/db"; }
ndumps() { find "$BK" -maxdepth 1 -name 'pre-deploy-*.sql.gz' 2>/dev/null | wc -l; }
no_forbidden() { [ ! -e "$S/forbidden_called" ]; }
compose_re() { printf '^%s\\|compose --project-directory %s -f %s/docker-compose.yml --env-file %s/.env %s$' "$1" "$CD" "$CD" "$CD" "$2"; }

# An toàn: receiver chỉ dùng override khi KHÔNG có SSH_CONNECTION → xác nhận bằng một lệnh bị từ chối
# (không có tác dụng phụ ngoài ghi log) rằng log THẬT SỰ vào file tạm, trước mọi deploy.
run "trigger-deploy"
if ! grep -qF 'từ chối' "$T/deploy.log" 2>/dev/null; then
  echo "✗ DỪNG: deploy.sh không ghi log vào $T/deploy.log — override không có hiệu lực, không chạy test" >&2
  exit 1
fi
reset_calls

section "Lệnh sai bị từ chối (không gọi docker, không đổi gì)"
set_running "$A"
LONG="deploy $A$(printf ' %.0s' {1..100})"
bad_cmds=(
  "" "deploy" "deploy " "trigger-deploy" "deploy abc" "deploy ${A:0:7}" "deploy ${A:0:39}" "deploy ${A}0"
  "deploy ${A:0:39}g" "deploy ${A^^}" "DEPLOY $A" "Deploy $A" " deploy $A" "deploy  $A" "deploy $A "
  "deploy $A extra" "deploy $A $B" "deploy $A; rm -rf /" "deploy $A && id" "deploy $A | sh" "deploy $A #"
  "deploy \$(id)" "deploy \`id\`" "deploy ${A:0:30}\$(id)" $'deploy\t'"$A" $'deploy '"$A"$'\n'
  $'deploy '"$A"$'\nid' "deploy $A"$'\r' "deploy=$A" "deploy:$A" "deploy -- $A" "deploy --help"
  "deploy ../../../etc/passwd" "deploy $A/../x" "rollback $A" "bash" "sh -c id" "scp -t /tmp"
  "rsync --server -e.LsfxC . /tmp" "git-upload-pack '/root/cms'" "$LONG"
)
for c in "${bad_cmds[@]}"; do
  run "$c"
  check "từ chối: $(printf '%q' "${c:0:60}")" rejected "từ chối"
done
RC=0; env -u SSH_ORIGINAL_COMMAND "${TENV[@]}" bash "$DEPLOY" >"$T/out" 2>&1 || RC=$?; OUT="$(cat "$T/out")"
check "từ chối: SSH không kèm lệnh (SSH_ORIGINAL_COMMAND unset, không tham số)" rejected "từ chối"
run_args deploy "$A" extra
check "từ chối: chạy tay 'deploy <sha> extra'" rejected "từ chối"
run_args "deploy $A;id"
check "từ chối: chạy tay 'deploy <sha>;id'" rejected "từ chối"
check "sau ${#bad_cmds[@]}+3 lệnh sai: không có lệnh docker nào" no_calls
check "sau các lệnh sai: container vẫn là A, không có dump" eval 'running "$A" && [ "$(ndumps)" -eq 0 ]'
exp_log="lệnh bị từ chối: $(printf '%q' $'deploy '"$A"$'\nid')"
check "lệnh bị từ chối được ghi log trên 1 dòng (escape bằng %q)" grep -qF -- "$exp_log" "$T/deploy.log"

section "Deploy lần đầu (chưa có cms-app, cms-db)"
rm -f "$S/app_image" "$S/db"
reset_calls
run "deploy $A"
check "deploy A thành công (rc=0, RESULT=deployed)" eval '[ "$RC" -eq 0 ] && has "RESULT=deployed IMAGE=$A"'
check "container chạy $REPO:A" running "$A"
check "pull cms với IMAGE_TAG=A, đúng compose + .env của COMPOSE_DIR" called "$(compose_re "$A" "pull cms")"
check "up -d với IMAGE_TAG=A" called "$(compose_re "$A" "up -d")"
check "chưa có cms-db → bỏ qua dump, không docker exec" eval '! called "\|exec " && has "bỏ qua dump" && [ "$(ndumps)" -eq 0 ]'
check "health check gọi đúng URL cố định" eval 'grep -qF "http://127.0.0.1:3002/api/health" "$S/curl_calls"'

section "Deploy thường: pull → dump (chmod 600, giữ 10) → up → health"
mkdir -p "$BK"
for i in 01 02 03 04 05 06 07 08 09 10 11 12; do printf 'old' | gzip >"$BK/pre-deploy-202501$i-000000.sql.gz"; done
: >"$BK/pre-deploy-20250113-000000-deadbeef0000.sql.gz.partial"
set_running "$A"
reset_calls
run "deploy $B"
check "deploy B thành công" eval '[ "$RC" -eq 0 ] && has "RESULT=deployed IMAGE=$B" && running "$B"'
dump_b="$(find "$BK" -maxdepth 1 -name "pre-deploy-*-${B:0:12}.sql.gz" | head -n 1)"
check "có dump pre-deploy-<ts>-<sha12>.sql.gz" eval '[ -n "$dump_b" ] && [ -f "$dump_b" ]'
check "dump mode 600" eval '[ "$(stat -c %a "$dump_b")" = 600 ]'
check "dump là gzip của pg_dump" eval '[ "$(gzip -dc "$dump_b")" = "-- fake dump" ]'
check "pg_dump lấy user/db từ env của container (không source .env)" \
  called '\|exec cms-db sh -c exec pg_dump -U "\$POSTGRES_USER" -d "\$POSTGRES_DB"$'
check "giữ đúng 10 dump: xoá 3 bản cũ nhất, còn bản mới" \
  eval '[ "$(ndumps)" -eq 10 ] && [ ! -e "$BK/pre-deploy-20250101-000000.sql.gz" ] && [ ! -e "$BK/pre-deploy-20250103-000000.sql.gz" ] && [ -e "$BK/pre-deploy-20250104-000000.sql.gz" ]'
check "dọn file .partial sót lại" eval '[ -z "$(find "$BK" -name "*.partial")" ]'
check "thứ tự: pull < docker exec (dump) < up" eval \
  '[ "$(line_of "pull cms$")" -lt "$(line_of "\|exec cms-db")" ] && [ "$(line_of "\|exec cms-db")" -lt "$(line_of "up -d$")" ]'
check "ghi log trên VPS (RESULT=deployed IMAGE=B)" eval 'grep -qF "RESULT=deployed IMAGE=$B" "$T/deploy.log"'
run_args deploy "$C"
check "chạy tay 2 tham số 'deploy <sha>' → OK" eval '[ "$RC" -eq 0 ] && running "$C"'
run_args "deploy $D"
check "chạy tay 1 tham số \"deploy <sha>\" → OK" eval '[ "$RC" -eq 0 ] && running "$D"'
check "vẫn giữ tối đa 10 dump" eval '[ "$(ndumps)" -eq 10 ]'

section "docker pull lỗi → exit 1, container cũ không bị đụng"
set_running "$D"
touch "$S/pull_fail"
n0="$(ndumps)"
reset_calls
run "deploy $E"
check "pull lỗi → rc=1, báo bản cũ vẫn chạy" eval '[ "$RC" -eq 1 ] && has "bản cũ vẫn chạy" && has "RESULT=failed"'
check "đã thử pull đúng tag E" called "$(compose_re "$E" "pull cms")"
check "KHÔNG up/exec/logs/stop/rm/down/restart/kill" \
  eval '! grep -qE "\|(compose .* (up|down|stop|rm|restart)( |$)|exec |logs |stop |rm |restart |kill )" "$S/calls"'
check "container vẫn chạy D, không tạo dump mới" eval 'running "$D" && [ "$(ndumps)" -eq "$n0" ]'
rm -f "$S/pull_fail"

section "Health check hỏng → lùi về tag trước đó"
set_running "$D"
echo "$E" >"$S/unhealthy_tags"
reset_calls
: >"$S/sleep_calls"
run "deploy $E"
check "rc=1, RESULT=rolled-back IMAGE=D FAILED=E" eval '[ "$RC" -eq 1 ] && has "RESULT=rolled-back IMAGE=$D FAILED=$E"'
check "up -d (E) rồi up -d cms (D)" eval \
  'l1="$(line_of "$(compose_re "$E" "up -d")")"; l2="$(line_of "$(compose_re "$D" "up -d cms")")"; [ -n "$l1" ] && [ -n "$l2" ] && [ "$l1" -lt "$l2" ]'
check "container quay lại D, health sau khi lùi OK" eval 'running "$D" && has "health OK"'
check "health thử 30 lần (29 lần sleep 2) trước khi lùi" eval '[ "$(grep -cx 2 "$S/sleep_calls")" -eq 29 ] && [ "$(grep -c . "$S/sleep_calls")" -eq 29 ]'
check "log container ghi vào file log VPS" eval 'grep -qF "FAKE-CONTAINER-LOG" "$T/deploy.log"'
check "log container KHÔNG in ra stdout (log CI công khai)" eval 'lacks "TOPSECRET" && lacks "FAKE-CONTAINER-LOG"'
check "nhắc restore dump vừa tạo" eval 'has "restore $BK/pre-deploy-"'

set_running "$D"
printf '%s\n%s\n' "$D" "$F" >"$S/unhealthy_tags"
run "deploy $F"
check "lùi về D nhưng D cũng hỏng → rc=1, báo VẪN lỗi" eval '[ "$RC" -eq 1 ] && has "VẪN lỗi" && running "$D"'
: >"$S/unhealthy_tags"

set_running "$D"
echo "$G" >"$S/up_fail_tags"
reset_calls
run "deploy $G"
check "compose up lỗi → lùi về D" eval '[ "$RC" -eq 1 ] && has "RESULT=rolled-back IMAGE=$D FAILED=$G" && called "$(compose_re "$D" "up -d cms")" && running "$D"'
: >"$S/up_fail_tags"

rm -f "$S/app_image"
echo "$H" >"$S/unhealthy_tags"
reset_calls
run "deploy $H"
check "lần đầu (không có image trước) mà hỏng → rc=1, RESULT=failed, không lùi" \
  eval '[ "$RC" -eq 1 ] && has "RESULT=failed IMAGE=$H" && ! called "up -d cms$"'
set_running "$H"
reset_calls
run "deploy $H"
check "deploy lại đúng sha đang chạy mà hỏng → không 'lùi' về chính nó" \
  eval '[ "$RC" -eq 1 ] && has "không có gì để lùi" && ! called "up -d cms$"'
: >"$S/unhealthy_tags"

section "pg_dump lỗi / container chạy sai image"
set_running "$D"
touch "$S/dump_fail"
n0="$(ndumps)"
reset_calls
run "deploy $J"
check "pg_dump lỗi → rc=1, KHÔNG up, container vẫn D" eval '[ "$RC" -eq 1 ] && has "pg_dump lỗi" && ! called "up -d" && running "$D"'
check "pg_dump lỗi → không để lại dump/partial" eval '[ "$(ndumps)" -eq "$n0" ] && [ -z "$(find "$BK" -name "*.partial")" ]'
check "stderr của pg_dump chỉ vào log VPS" eval 'grep -qF "connection to server failed" "$T/deploy.log" && lacks "connection to server failed"'
rm -f "$S/dump_fail"

set_running "$D"
echo "$REPO:latest" >"$S/pin_image"
run "deploy $K"
check "compose bỏ qua IMAGE_TAG (image cứng) → rc=1, báo sai image" eval '[ "$RC" -eq 1 ] && has "không phải $REPO:$K"'
rm -f "$S/pin_image"

section "Kiểm tra cấu hình trước khi chạy (không gọi docker)"
set_running "$D"
reset_calls
mv "$CD/.env" "$CD/.env.bak"
run "deploy $K"
check "thiếu .env → từ chối" eval 'rejected "không có file $CD/.env" && no_calls'
mv "$CD/.env.bak" "$CD/.env"
chmod 664 "$CD/docker-compose.yml"
run "deploy $K"
check "docker-compose.yml group ghi được → từ chối" eval 'rejected "ghi được bởi group/other" && no_calls'
chmod 644 "$CD/docker-compose.yml"
mv "$CD/docker-compose.yml" "$T/real-compose.yml"
ln -s "$T/real-compose.yml" "$CD/docker-compose.yml"
run "deploy $K"
check "docker-compose.yml là symlink → từ chối" eval 'rejected "là symlink" && no_calls'
rm "$CD/docker-compose.yml"
mv "$T/real-compose.yml" "$CD/docker-compose.yml"
if [ "$(id -u)" -eq 0 ]; then
  chown 12345 "$CD/.env"
  run "deploy $K"
  check "(root) .env không thuộc root → từ chối" eval 'rejected "thuộc uid 12345" && no_calls'
  chown 0 "$CD/.env"
fi
RC=0; env "${TENV[@]}" QKENN_CMS_LOCK_WAIT=abc SSH_ORIGINAL_COMMAND="deploy $K" bash "$DEPLOY" >"$T/out" 2>&1 || RC=$?; OUT="$(cat "$T/out")"
check "LOCK_WAIT không phải số → từ chối" eval 'rejected "LOCK_WAIT không hợp lệ" && no_calls'

section "flock: không chạy song song"
(
  flock 8
  : >"$T/locked"
  while [ ! -e "$T/release" ]; do sleep 0.1; done
) 8>>"$T/deploy.lock" &
HOLDER=$!
for _ in $(seq 1 50); do if [ -e "$T/locked" ]; then break; fi; sleep 0.1; done
reset_calls
RC=0; env "${TENV[@]}" QKENN_CMS_LOCK_WAIT=1 SSH_ORIGINAL_COMMAND="deploy $K" bash "$DEPLOY" >"$T/out" 2>&1 || RC=$?; OUT="$(cat "$T/out")"
check "đang có deploy khác giữ khoá → chờ LOCK_WAIT rồi từ chối, không gọi docker" eval 'rejected "chưa lấy được khoá" && no_calls'
RC=0; env "${TENV[@]}" QKENN_CMS_LOCK_WAIT=1 bash "$ROLLBACK" "$A" >"$T/out" 2>&1 || RC=$?; OUT="$(cat "$T/out")"
check "rollback.sh dùng chung khoá → cũng bị chặn" eval 'rejected "chưa lấy được khoá" && no_calls'
: >"$T/release"
wait "$HOLDER" || true
HOLDER=""
run "deploy $K"
check "khoá được nhả → deploy K chạy bình thường" eval '[ "$RC" -eq 0 ] && running "$K"'

section "rollback.sh (không git)"
set_running "$K"
reset_calls
for a in "" "xyz" "abc12" "${A}0" "${A:0:10};id" "../x" "-h" "$A $B"; do
  run_rb "$a"
  check "rollback từ chối: $(printf '%q' "${a:0:50}")" eval '[ "$RC" -ne 0 ] && has "sha không hợp lệ"'
done
run_rb
check "rollback không tham số → cách dùng" rejected "cách dùng"
run_rb "$A" "$B"
check "rollback 2 tham số → cách dùng" rejected "cách dùng"
check "tham số sai: không gọi docker" no_calls
run_rb "$A"
check "rollback <sha40 A> → pull + up -d cms với IMAGE_TAG=A, health OK" eval \
  '[ "$RC" -eq 0 ] && running "$A" && called "$(compose_re "$A" "pull cms")" && called "$(compose_re "$A" "up -d cms")" && has "RESULT=rolled-back IMAGE=$A"'
run_rb "${B:0:8}"
check "rollback <sha ngắn B> → tìm tag trong image có sẵn" eval '[ "$RC" -eq 0 ] && running "$B"'
run_rb "${C^^}"
check "rollback <SHA40 chữ hoa> → chuẩn hoá về chữ thường" eval '[ "$RC" -eq 0 ] && running "$C"'
X1="abcdef01$(printf '0%.0s' {1..32})" X2="abcdef02$(printf '0%.0s' {1..32})"
printf '%s\n%s\n' "$X1" "$X2" >>"$S/local_tags"
run_rb abcdef0
check "sha ngắn khớp nhiều image → từ chối" eval 'rejected "khớp 2 image" && running "$C"'
run_rb "1234567"
check "sha ngắn không có image trong máy → từ chối" eval 'rejected "truyền đủ 40 ký tự" && running "$C"'
touch "$S/pull_fail"
run_rb "$A"
check "GHCR lỗi nhưng image A có sẵn → vẫn lùi được" eval '[ "$RC" -eq 0 ] && has "có sẵn trong máy" && running "$A"'
reset_calls
run_rb "$(h Z)"
check "GHCR lỗi và máy không có image → rc=1, không up" eval 'rejected "không đổi gì" && ! called "up -d" && running "$A"'
rm -f "$S/pull_fail"
echo "$B" >"$S/unhealthy_tags"
run_rb "$B"
check "rollback xong mà health hỏng → rc=1" eval 'rejected "health check thất bại"'
: >"$S/unhealthy_tags"

section "Không bao giờ gọi git (hay ssh/scp/wget), không eval"
check "git/ssh/scp/wget giả chưa từng bị gọi trong mọi lần chạy ở trên" no_forbidden
code_lines() { grep -vE '^[[:space:]]*#' "$1" | sed 's/[[:space:]]#.*$//'; }
check "deploy.sh: không có lệnh git ngoài comment" eval '! code_lines "$DEPLOY" | grep -qwE "git"'
check "rollback.sh: không có lệnh git ngoài comment" eval '! code_lines "$ROLLBACK" | grep -qwE "git"'
check "deploy.sh/rollback.sh: không eval, không source" eval '! code_lines "$DEPLOY" | grep -qwE "eval|source" && ! code_lines "$ROLLBACK" | grep -qwE "eval|source" && ! grep -qE "^[[:space:]]*\. " "$DEPLOY" "$ROLLBACK"'

section "Qua SSH (SSH_CONNECTION có giá trị) thì override QKENN_CMS_* bị bỏ qua"
if [ "${SKIP_DOCKER_TESTS:-}" = 1 ]; then
  SKIP=$((SKIP + 1)); echo "  – SKIP (SKIP_DOCKER_TESTS=1)"
elif ! command -v docker >/dev/null 2>&1 || ! docker image inspect ubuntu:24.04 >/dev/null 2>&1; then
  SKIP=$((SKIP + 1)); echo "  – SKIP (máy không có docker hoặc image ubuntu:24.04 — không tự pull)"
else
  # Container dùng-xong-bỏ, không mạng; ở trong đó /root/cms không tồn tại, /var/log là của container
  RC=0
  OUT="$(docker run --rm --network none -v "$HERE:/s:ro" -v "$FB:/fb:ro" -e A="$A" ubuntu:24.04 bash -c '
    set -u
    mkdir -p /tmp/c /tmp/st
    printf "name: cms\n" >/tmp/c/docker-compose.yml; : >/tmp/c/.env; chmod 600 /tmp/c/.env
    export PATH="/fb:$PATH" FAKE_STATE=/tmp/st FAKE_ROOT=/tmp
    export QKENN_CMS_COMPOSE_DIR=/tmp/c QKENN_CMS_LOG=/tmp/test.log QKENN_CMS_LOCK=/tmp/lock QKENN_CMS_BACKUP_DIR=/tmp/bk
    SSH_CONNECTION="203.0.113.7 40000 198.51.100.2 22" SSH_ORIGINAL_COMMAND="deploy $A" bash /s/deploy.sh >/tmp/o1 2>&1
    echo "ssh_rc=$?"
    echo "ssh_calls=$(cat /tmp/st/calls 2>/dev/null | wc -l)"
    echo "ssh_out=$(tr "\n" " " </tmp/o1)"
    echo "ssh_testlog=$([ -e /tmp/test.log ] && echo yes || echo no)"
    echo "ssh_deflog=$(grep -c "không có thư mục /root/cms" /var/log/qkenn-cms-deploy.log 2>/dev/null || echo 0)"
    SSH_CLIENT="203.0.113.7 40000 22" bash /s/rollback.sh "$A" >/tmp/o2 2>&1
    echo "rb_rc=$? rb_calls=$(cat /tmp/st/calls 2>/dev/null | wc -l) rb_out=$(tr "\n" " " </tmp/o2)"
    SSH_ORIGINAL_COMMAND="deploy $A" bash /s/deploy.sh >/tmp/o3 2>&1
    echo "ctl_rc=$? ctl_img=$(cat /tmp/st/app_image 2>/dev/null)"
  ' 2>&1)" || RC=$?
  check "container test chạy được" eval '[ "$RC" -eq 0 ] && has "ssh_rc="'
  check "SSH_CONNECTION + QKENN_CMS_COMPOSE_DIR → vẫn dùng /root/cms (không có trong container) → rc=1" \
    eval 'has "ssh_rc=1" && has "không có thư mục /root/cms"'
  check "… không gọi docker, không ghi log override, ghi vào /var/log/qkenn-cms-deploy.log" \
    eval 'has "ssh_calls=0" && has "ssh_testlog=no" && has "ssh_deflog=1"'
  check "rollback.sh với SSH_CLIENT → cũng bỏ qua override" eval 'has "rb_rc=1 rb_calls=0" && has "không có thư mục /root/cms"'
  check "đối chứng: không SSH → dùng thư mục override, deploy OK" eval 'has "ctl_rc=0 ctl_img=$REPO:$A"'
fi

printf '\n%s passed, %s failed, %s skipped\n' "$PASS" "$FAIL" "$SKIP"
[ "$FAIL" -eq 0 ]
