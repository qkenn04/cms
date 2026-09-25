# cms — Payload CMS 3.90.2 (headless cho qkenn.cloud)

## Commands
Mọi lệnh chạy trong Docker `node:22-alpine` (Node trên host là 18):
`docker run --rm --network host -v "$PWD":/app -w /app node:22-alpine sh -c "corepack enable pnpm && <lệnh>"`

- DB dev: `DEV_DB_PASSWORD=$(cut -d= -f2 /root/.cms-dev-secrets) docker compose -f docker-compose.dev.yml up -d` (Postgres 127.0.0.1:5433)
- Dev server: `pnpm dev -p 3003 -H 127.0.0.1` (3002 dành cho production)
- Tạo migration: `pnpm migrate:create <tên>` — KHÔNG gọi thẳng `payload migrate:create` (xem bên dưới)
- Áp migration: `pnpm migrate`; sau đó `pnpm generate:types` và `pnpm payload generate:importmap`
- Test: `pnpm exec vitest run --config ./vitest.config.mts tests/int/triggerSiteRebuild.int.spec.ts`
- Type check: `pnpm exec tsc --noEmit`
- Seed dev: `pnpm payload run src/seed.ts`

## Conventions
- `payload` và mọi `@payloadcms/*` cùng đúng 1 version, không `^`
- Postgres `push: false`; mọi đổi schema phải có file migration commit kèm
- Access function nằm ở `src/access`, không viết inline
- Localization vi (mặc định) + en; chốt `localized` trước khi có dữ liệu thật
- Secret chỉ ở `.env` (gitignore); `.env.example` ghi tên biến

## Architecture
- `src/collections` (posts, pages, categories, media, users), `src/globals` (site-settings), `src/hooks`, `src/access`, `src/migrations`
- Media trên Cloudflare R2 (`@payloadcms/storage-s3`), prefix theo `R2_PREFIX` (production `qkenn`, dev `dev`)
- `posts`, `pages` afterChange/afterDelete → GitHub `repository_dispatch` sang `SITE_REPO` → build site Astro
- Production: `/root/cms` (clone repo + `.env`), `scripts/deploy.sh` do GitHub Actions gọi qua SSH forced command

## Things Claude gets wrong
- `migrate:create` phải chạy với `R2_PREFIX=qkenn` (script `pnpm migrate:create` đã ép) — nếu không, default của cột `media.prefix` trong migration thành `dev`
- drizzle hỏi tương tác "created or renamed" khi đổi cột → cần TTY; kiểm tra migration không có `RENAME` ngoài ý muốn
- Quên `output: 'standalone'` trong next.config.ts → Dockerfile hỏng
- `NEXT_PUBLIC_SERVER_URL` bị inline lúc build → CI phải truyền `--build-arg`
- `jobs.autoRun` chỉ chạy sau `getPayload({ cron: true })` → `src/instrumentation.ts`
- Thêm `packageManager` / đổi version pnpm → phải `pnpm install` lại để cập nhật lockfile
- `formatOptions` của upload chỉ áp cho ảnh gốc; từng image size phải khai báo riêng
- Lưu nháp từ admin gửi `?draft=true`; hook rebuild dựa vào đó để bỏ qua autosave
