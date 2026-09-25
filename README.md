# qkenn CMS

Headless [Payload CMS](https://payloadcms.com) 3 that holds the content of **qkenn.cloud**.
The public site is a static Astro build in a separate repository
([qkenn04/qkenn-site](https://github.com/qkenn04/qkenn-site)); this repository only provides the
admin UI and the REST/GraphQL API that the site build reads from.

## Stack

- Payload 3.90.2 on Next.js 16 (`output: 'standalone'`), Node 22, pnpm
- PostgreSQL 16 (`@payloadcms/db-postgres`, `push: false`: every schema change ships as a committed
  migration, applied automatically when the production container boots)
- Lexical rich-text editor with code blocks and tables; HTML is rendered server-side into a virtual
  `contentHtml` field
- Media on Cloudflare R2 through `@payloadcms/storage-s3` (WebP image sizes), SEO plugin
- Localization: Vietnamese (default) and English
- Production: Docker image on GHCR, Docker Compose on a single VPS behind a reverse proxy

## Local development

Run Node tooling inside `node:22-alpine` if your host Node is older than 22.

```sh
cp .env.example .env    # fill in PAYLOAD_SECRET and the DATABASE_URL password
DEV_DB_PASSWORD='<same password>' docker compose -f docker-compose.dev.yml up -d   # Postgres on 127.0.0.1:5433
docker run --rm -it --network host -v "$PWD":/app -w /app node:22-alpine \
  sh -c "corepack enable pnpm && pnpm i && pnpm migrate && pnpm dev -p 3003 -H 127.0.0.1"
```

The admin UI is then at <http://127.0.0.1:3003/admin>. Port 3002 is reserved for production.

| Task | Command |
| --- | --- |
| Dev server | `pnpm dev -p 3003 -H 127.0.0.1` |
| Apply migrations | `pnpm migrate`, then `pnpm generate:types` and `pnpm payload generate:importmap` |
| Create a migration | `pnpm migrate:create <name>` (not `payload migrate:create` directly: the script pins the production media prefix) |
| Type check | `pnpm exec tsc --noEmit` |
| Unit tests | `pnpm exec vitest run --config ./vitest.config.mts tests/int/triggerSiteRebuild.int.spec.ts tests/int/slugify.int.spec.ts tests/int/htmlConverters.int.spec.ts tests/int/draftMarkdown.int.spec.ts` |
| Seed dev data | `pnpm payload run src/seed.ts` |
| Import Markdown drafts | `pnpm payload run src/scripts/import-drafts.ts -- <dir>` (`IMPORT_DRY=1` converts and validates without writing) |
| Deploy script tests | `bash scripts/test-deploy.sh` (fake `docker`/`curl`, temporary directories only) |

## Content model

| Collection / global | Contents |
| --- | --- |
| `posts` | Blog posts: localized title, excerpt and rich-text content, slug, cover image, categories, author, `publishedAt`. Drafts with autosave, version history and scheduled publishing. |
| `pages` | Static pages such as About: localized title and content, one slug shared by both locales, drafts. |
| `categories` | Localized title and slug. |
| `media` | Uploads stored on R2, localized `alt`/`caption`, WebP sizes `thumbnail`, `card`, `hero`, `og`. |
| `users` | Admin login; roles `admin`, `editor` and `service` (API key for automation). |
| `site-settings` (global) | Site name, tagline, description, navigation, social links, footer text. |

Access rules live in `src/access`. Anonymous API requests only see published posts and pages. Slugs that
consist only of digits are rejected because they would collide with the site's pagination URLs
(`/blog/2`).

## Publishing triggers a site build

When public content changes (publishing, unpublishing or deleting a post or page, or saving
`site-settings`), an `afterChange`/`afterDelete` hook calls GitHub's `workflow_dispatch` API for the
site repository's deploy workflow (`SITE_REPO`, `SITE_WORKFLOW`, inputs `reason` and `slug`). Draft
saves and autosaves never trigger a build.

The token is a fine-grained personal access token scoped to the site repository with a single
permission, **Actions: read and write**. It can start workflows but cannot read or push code. A
failed dispatch is logged and the publish itself still succeeds. Scheduled publishing runs on
Payload's job queue; a host cron job calling `/api/payload-jobs/run` with `CRON_SECRET` is the
fallback.

## Deployment

```text
push to main
  └─ CI build job: type check, unit tests, deploy-script tests
       └─ docker build ─▶ ghcr.io/qkenn04/cms:<commit-sha>
            └─ CI deploy job: ssh <server> "deploy <commit-sha>"   (pinned host key)
                 └─ server receiver (forced command):
                      compose pull ─▶ pg_dump ─▶ compose up -d ─▶ health check
                                                   (migrations)   └─ fails ─▶ previous image tag
```

- **Images by SHA.** CI builds and pushes one image per commit. The server never builds anything.
- **Forced-command receiver.** The deploy key in `authorized_keys` is limited with
  `restrict,command="…"` to a receiver script (`scripts/deploy.sh`) that the administrator installs
  as a root-owned copy outside the repository. It accepts exactly `deploy <40-hex sha>`, rejects
  everything else, and serializes runs with a lock.
- **No `git pull` on the server.** The receiver uses the `docker-compose.yml` and `.env` that are
  already on the server. Changes to the compose file, and new versions of the receiver itself, only
  reach the server when the administrator reviews them and pulls/installs them by hand.
- **Backups and rollback.** A `pg_dump` is taken before each new image starts (mode 600, the last 10
  are kept). If the new container fails its health check, the receiver switches back to the
  previously running image tag. Migrations are not reversed automatically; restoring the dump is a
  manual step. `scripts/rollback.sh <sha>` switches to any earlier image without git.
- **Host key pinning.** The deploy job requires the `SSH_KNOWN_HOSTS` secret and connects with
  `StrictHostKeyChecking=yes`. If the secret is missing the job fails; host key verification is never
  skipped.

GitHub Actions secrets:

| Secret | Purpose |
| --- | --- |
| `SSH_KEY_B64` | Base64-encoded private deploy key (deploy is skipped with a warning if unset) |
| `SSH_HOST` | Server address (deploy is skipped with a warning if unset) |
| `SSH_USER` | Optional, defaults to `root` |
| `SSH_KNOWN_HOSTS` | Server host key line, `<SSH_HOST> ssh-ed25519 AAAA…` (required once deploy is configured) |
| `DISCORD_WEBHOOK` | Optional, deploy result notifications |

## Security notes

- Secrets live only in the server's `.env` (gitignored) and in GitHub Actions secrets.
  `.env.example` lists variable names only.
- PostgreSQL sits on an internal Docker network with no published port. The app container runs as a
  non-root user and listens on loopback; it is reachable only through the reverse proxy.
- Someone who takes over the GitHub account or CI can change which image runs inside the CMS
  container, and therefore reach the CMS data. They cannot change the deploy logic or the compose
  configuration that root executes on the host.
- Actions logs of this public repository show deploy output, so the receiver writes container logs
  and database errors only to a root-only log file on the server.
- Tokens are least-privilege: the rebuild token only has Actions access to the site repository, and
  the CI workflow grants `packages: write` to the build job only.
