# cms — Payload CMS 3.90.2 (headless cho qkenn.cloud)

## Commands
Mọi lệnh chạy trong Docker `node:22-alpine` (Node trên host là 18):
`docker run --rm --network host -v "$PWD":/app -w /app node:22-alpine sh -c "corepack enable pnpm && <lệnh>"`

- DB dev: `DEV_DB_PASSWORD=$(cut -d= -f2 <dev-secrets-file>) docker compose -f docker-compose.dev.yml up -d` (Postgres 127.0.0.1:5433)
- Dev server: `pnpm dev -p 3003 -H 127.0.0.1` (3002 dành cho production)
- Tạo migration: `pnpm migrate:create <tên>` — KHÔNG gọi thẳng `payload migrate:create` (xem bên dưới)
- Áp migration: `pnpm migrate`; sau đó `pnpm generate:types` và `pnpm payload generate:importmap`
- Test: `pnpm exec vitest run --config ./vitest.config.mts tests/int/triggerSiteRebuild.int.spec.ts tests/int/slugify.int.spec.ts tests/int/htmlConverters.int.spec.ts tests/int/draftMarkdown.int.spec.ts`
- Type check: `pnpm exec tsc --noEmit`
- Seed dev: `pnpm payload run src/seed.ts`
- Import bài nháp markdown: `pnpm payload run src/scripts/import-drafts.ts -- <dir>` (hoặc `IMPORT_DIR=<dir>`; trong Docker mount thư mục drafts vào container, vd `-v <drafts-dir>:/drafts:ro` rồi `-- /drafts`). Lấy `<dir>/0[1-8]-*.md`, danh mục từ `<dir>/_brief/series-plan.json` (`categoriesForCms`, đổi bằng `IMPORT_CATEGORIES_FILE`). `IMPORT_DRY=1` = chỉ chuyển đổi + kiểm tra, không ghi DB

## Conventions
- `payload` và mọi `@payloadcms/*` cùng đúng 1 version, không `^`
- Postgres `push: false`; mọi đổi schema phải có file migration commit kèm
- Access function nằm ở `src/access`, không viết inline
- Localization vi (mặc định) + en; chốt `localized` trước khi có dữ liệu thật
- Secret chỉ ở `.env` (gitignore); `.env.example` ghi tên biến

## Architecture
- `src/collections` (posts, pages, categories, media, users), `src/globals` (site-settings), `src/hooks`, `src/access`, `src/migrations`
- Media trên Cloudflare R2 (`@payloadcms/storage-s3`), prefix theo `R2_PREFIX` (production `qkenn`, dev `dev`)
- `posts`, `pages` afterChange/afterDelete + global `site-settings` afterChange → GitHub `workflow_dispatch` (`.github/workflows/$SITE_WORKFLOW` của `SITE_REPO`, inputs reason/slug) → build site Astro. PAT fine-grained chỉ cần **Actions: write** trên repo site
- Editor không có link nội bộ (LinkFeature enabledCollections: []): site tĩnh không biết locale → dùng URL tương đối như `/blog/<slug>/`
- Ảnh chèn trong bài: converter riêng `src/lexical/htmlConverters.ts` (1 `<img>`, srcset chỉ gồm size cùng tỉ lệ)
- Editor (lexicalEditor mặc định, trừ link nội bộ) + code block `CodeBlock` qua `BlocksFeature` (block slug `Code`, fields `language`/`code`; danh sách ngôn ngữ `src/lexical/codeLanguages.ts`) + bảng `EXPERIMENTAL_TableFeature`. Cả hai nằm trong JSON richText → thêm/bớt KHÔNG cần migration. HTML: code → `<pre><code class="language-x">` (escape, giữ khoảng trắng), bảng → `<div class="table-wrap"><table><thead>/<tbody>` không style inline
- Import drafts (`src/scripts/import-drafts.ts`): upsert theo slug, luôn DRAFT (không publishedAt → không rebuild site); bài đã published thì bỏ qua. KHÔNG đưa `dangSauKhi`/`canTacGiaXacNhan`/`series`/`estimatedReadingMinutes`/`status` vào CMS; bỏ blockquote "Quyết định mặc định" đầu bài. Markdown → Lexical bằng `convertMarkdownToLexical` + editor config của `posts.content`
- Production: `/root/cms` (clone repo + `.env`, chỉ admin cập nhật tay) — xem mục Deploy

## Deploy
- Luồng: push `main` → CI (`.github/workflows/deploy.yml`): tsc + vitest + `bash scripts/test-deploy.sh` → image `ghcr.io/qkenn04/cms:<sha>` lên GHCR → `ssh <SSH_HOST> "deploy <sha40>"` → forced command `/usr/local/bin/qkenn-cms-deploy` (BẢN SAO root của `scripts/deploy.sh`): pull → pg_dump (`/root/backups/cms`, 600, giữ 10) → `up -d` (migration lúc boot) → health `127.0.0.1:3002/api/health` → hỏng thì lùi về tag đang chạy trước đó. Log: `/var/log/qkenn-cms-deploy.log`
- VPS KHÔNG `git pull`, không chạy file nào lấy từ repo: receiver dùng `/root/cms/docker-compose.yml` + `/root/cms/.env` có sẵn. Đổi `docker-compose.yml` → admin review rồi tự kéo (có hiệu lực ở lần deploy sau):
  `git -C /root/cms fetch && git -C /root/cms diff HEAD origin/main -- docker-compose.yml scripts/ && git -C /root/cms pull --ff-only`
- Cài / cập nhật receiver (+ rollback) sau khi review, trên VPS:
  `cd /root/cms && bash scripts/test-deploy.sh && install -o root -g root -m 0755 scripts/deploy.sh /usr/local/bin/qkenn-cms-deploy && install -o root -g root -m 0755 scripts/rollback.sh /usr/local/bin/qkenn-cms-rollback`
- `/root/.ssh/authorized_keys`: thay dòng cũ `command="/root/cms/scripts/deploy.sh",no-agent-forwarding,…` bằng (giữ nguyên public key):
  `restrict,command="/usr/local/bin/qkenn-cms-deploy" ssh-ed25519 AAAA… github-actions-cms-deploy`
  Receiver chỉ nhận đúng `deploy <sha40 hex thường>`; lệnh cũ `trigger-deploy` bị từ chối
- Secret `SSH_KNOWN_HOSTS` BẮT BUỘC (thiếu → job deploy FAIL, không bỏ qua xác minh host key): 1 dòng `<SSH_HOST> ssh-ed25519 AAAA…`, cột đầu đúng bằng giá trị `SSH_HOST`. Lấy trên VPS: `printf '%s %s\n' '<SSH_HOST>' "$(cut -d' ' -f1,2 /etc/ssh/ssh_host_ed25519_key.pub)"` rồi `gh secret set SSH_KNOWN_HOSTS -R qkenn04/cms`. Không ghi host key/IP vào repo
- Thứ tự chuyển đổi: đặt `SSH_KNOWN_HOSTS` → cài receiver + đổi authorized_keys → push. Push trước bước 2 vẫn deploy được (forced command cũ chạy `/root/cms/scripts/deploy.sh`), nhưng root vẫn chạy code từ git cho tới khi làm bước 2
- Rollback tay: `qkenn-cms-rollback <sha>` (40 hex, hoặc ≥7 ký tự đầu nếu image còn trong máy) — không cần git, dùng chung khoá + log với receiver. Không đảo migration → cần thì restore dump
- Kiểm tra script: `bash scripts/test-deploy.sh` (docker/curl/git giả, thư mục tạm; phần "SSH bỏ qua override" chạy trong container `ubuntu:24.04` dùng xong bỏ nếu máy có image) và `docker run --rm -v "$PWD/scripts:/mnt:ro" -w /mnt koalaman/shellcheck:stable deploy.sh rollback.sh test-deploy.sh`

## Things Claude gets wrong
- Slug toàn chữ số bị chặn (trùng URL phân trang `/blog/2` của site); slug tự sinh từ tiêu đề số được thêm tiền tố
- `migrate:create` phải chạy với `R2_PREFIX=qkenn` (script `pnpm migrate:create` đã ép) — nếu không, default của cột `media.prefix` trong migration thành `dev`
- drizzle hỏi tương tác "created or renamed" khi đổi cột → cần TTY; kiểm tra migration không có `RENAME` ngoài ý muốn
- Quên `output: 'standalone'` trong next.config.ts → Dockerfile hỏng
- `NEXT_PUBLIC_SERVER_URL` bị inline lúc build → CI phải truyền `--build-arg`
- Sửa `scripts/deploy.sh`/`rollback.sh`/`docker-compose.yml` KHÔNG tự lên VPS (không git pull) → admin phải review + `install`/`git pull` tay
- stdout của receiver hiện trong log Actions CÔNG KHAI → log container, lỗi pg_dump chỉ ghi file log trên VPS (`log_private`), không `echo`
- `jobs.autoRun` chỉ chạy sau `getPayload({ cron: true })` → `src/instrumentation.ts`
- Thêm `packageManager` / đổi version pnpm → phải `pnpm install` lại để cập nhật lockfile
- `formatOptions` của upload chỉ áp cho ảnh gốc; từng image size phải khai báo riêng
- Lưu nháp từ admin gửi `?draft=true`; hook rebuild dựa vào đó để bỏ qua autosave
- Thêm feature/block Lexical có component admin → chạy `pnpm payload generate:importmap` (nếu không admin báo thiếu component)
- `payload run` thoát ngay khi import module xong → script phải top-level `await`, không `run().catch()` trơn
- Select `language` của code block chỉ nhận key trong `CODE_LANGUAGES`; fence lạ (vd `cron`) importer đổi về `text`. Markdown import sinh id ngẫu nhiên cho link/block → importer đặt id cố định để chạy lại không tạo version thừa
