# cms — Payload CMS 3.90.2 (headless cho qkenn.cloud)

## Commands
Mọi lệnh chạy trong Docker `node:22-alpine` (Node trên host là 18):
`docker run --rm --network host -v "$PWD":/app -w /app node:22-alpine sh -c "corepack enable pnpm && <lệnh>"`

- DB dev: `DEV_DB_PASSWORD=$(cut -d= -f2 /root/.cms-dev-secrets) docker compose -f docker-compose.dev.yml up -d` (Postgres 127.0.0.1:5433)
- Dev server: `pnpm dev -p 3003 -H 127.0.0.1` (3002 dành cho production)
- Tạo migration: `pnpm migrate:create <tên>` — KHÔNG gọi thẳng `payload migrate:create` (xem bên dưới)
- Áp migration: `pnpm migrate`; sau đó `pnpm generate:types` và `pnpm payload generate:importmap`
- Test: `pnpm exec vitest run --config ./vitest.config.mts tests/int/triggerSiteRebuild.int.spec.ts tests/int/slugify.int.spec.ts tests/int/htmlConverters.int.spec.ts tests/int/draftMarkdown.int.spec.ts`
- Type check: `pnpm exec tsc --noEmit`
- Seed dev: `pnpm payload run src/seed.ts`
- Import bài nháp markdown: `pnpm payload run src/scripts/import-drafts.ts -- <dir>` (hoặc `IMPORT_DIR=<dir>`; trong Docker mount thư mục drafts vào container, vd `-v /home/projects/blog-drafts:/drafts:ro` rồi `-- /drafts`). Lấy `<dir>/0[1-8]-*.md`, danh mục từ `<dir>/_brief/series-plan.json` (`categoriesForCms`, đổi bằng `IMPORT_CATEGORIES_FILE`). `IMPORT_DRY=1` = chỉ chuyển đổi + kiểm tra, không ghi DB

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
- Production: `/root/cms` (clone repo + `.env`), `scripts/deploy.sh` do GitHub Actions gọi qua SSH forced command

## Things Claude gets wrong
- Slug toàn chữ số bị chặn (trùng URL phân trang `/blog/2` của site); slug tự sinh từ tiêu đề số được thêm tiền tố
- `migrate:create` phải chạy với `R2_PREFIX=qkenn` (script `pnpm migrate:create` đã ép) — nếu không, default của cột `media.prefix` trong migration thành `dev`
- drizzle hỏi tương tác "created or renamed" khi đổi cột → cần TTY; kiểm tra migration không có `RENAME` ngoài ý muốn
- Quên `output: 'standalone'` trong next.config.ts → Dockerfile hỏng
- `NEXT_PUBLIC_SERVER_URL` bị inline lúc build → CI phải truyền `--build-arg`
- `jobs.autoRun` chỉ chạy sau `getPayload({ cron: true })` → `src/instrumentation.ts`
- Thêm `packageManager` / đổi version pnpm → phải `pnpm install` lại để cập nhật lockfile
- `formatOptions` của upload chỉ áp cho ảnh gốc; từng image size phải khai báo riêng
- Lưu nháp từ admin gửi `?draft=true`; hook rebuild dựa vào đó để bỏ qua autosave
- Thêm feature/block Lexical có component admin → chạy `pnpm payload generate:importmap` (nếu không admin báo thiếu component)
- `payload run` thoát ngay khi import module xong → script phải top-level `await`, không `run().catch()` trơn
- Select `language` của code block chỉ nhận key trong `CODE_LANGUAGES`; fence lạ (vd `cron`) importer đổi về `text`. Markdown import sinh id ngẫu nhiên cho link/block → importer đặt id cố định để chạy lại không tạo version thừa
