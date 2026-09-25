import type {
  CollectionAfterChangeHook,
  CollectionAfterDeleteHook,
  GlobalAfterChangeHook,
  PayloadRequest,
} from 'payload'

type Status = 'draft' | 'published' | null | undefined
type PostLike = { _status?: Status; slug?: string | null; site?: string | null }
type Logger = Pick<PayloadRequest['payload']['logger'], 'info' | 'warn' | 'error'>

// Repo site tĩnh cho từng giá trị field `site`; site chưa có repo thì bỏ qua
const repoForSite = (site: string | null | undefined): string | undefined => {
  if (site === 'qkenn') return process.env.SITE_REPO
  if (site === 'other') return process.env.OTHER_SITE_REPO
  return undefined
}

const isEnabled = () =>
  Boolean(process.env.GITHUB_DISPATCH_TOKEN) &&
  (process.env.NODE_ENV === 'production' || process.env.SITE_REBUILD_ENABLED === 'true')

/**
 * Chỉ rebuild khi nội dung PUBLIC thay đổi.
 * Lưu nháp / autosave không đụng bản public (kể cả khi bài đang published) → bỏ qua.
 */
export const decideRebuild = ({
  doc,
  previousDoc,
  isDraftWrite,
}: {
  doc: PostLike
  previousDoc?: PostLike
  isDraftWrite: boolean
}): boolean => {
  if (isDraftWrite) return false
  const nowPublic = doc._status === 'published'
  const wasPublic = previousDoc?._status === 'published'
  return nowPublic || wasPublic
}

export const dispatchSiteRebuild = async ({
  logger,
  site,
  slug,
  reason,
}: {
  logger: Logger
  site: string | null | undefined
  slug: string | null | undefined
  reason: 'publish' | 'unpublish' | 'delete' | 'settings'
}): Promise<boolean> => {
  if (!isEnabled()) return false
  const repo = repoForSite(site)
  if (!repo) return false

  // workflow_dispatch thay cho repository_dispatch: PAT fine-grained chỉ cần quyền Actions: write
  // (repository_dispatch đòi Contents: write). GitHub trả 204 khi nhận.
  const workflow = process.env.SITE_WORKFLOW || 'deploy.yml'
  const url = `https://api.github.com/repos/${repo}/actions/workflows/${encodeURIComponent(workflow)}/dispatches`

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.GITHUB_DISPATCH_TOKEN}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ref: 'main', inputs: { reason, slug: slug ?? '' } }),
    })
    if (!res.ok) {
      logger.error(`site rebuild dispatch thất bại: ${repo} HTTP ${res.status}`)
      return false
    }
    logger.info(`site rebuild dispatched: ${repo} ${workflow} (${reason} ${slug})`)
    return true
  } catch (err) {
    // Publish vẫn thành công; lỗi GitHub chỉ ghi log để chạy tay workflow_dispatch
    logger.error({ err }, `site rebuild dispatch lỗi mạng: ${repo}`)
    return false
  }
}

const isTruthy = (v: unknown) => v === true || v === 'true'

export const rebuildSiteAfterChange: CollectionAfterChangeHook = async ({ doc, previousDoc, req }) => {
  // Admin UI gửi ?draft=true (và autosave=true) khi lưu nháp
  const isDraftWrite = isTruthy(req.query?.draft) || isTruthy(req.query?.autosave)
  if (!decideRebuild({ doc, previousDoc, isDraftWrite })) return doc

  const reason = doc._status === 'published' ? 'publish' : 'unpublish'
  // Không await: không bắt editor chờ GitHub
  void dispatchSiteRebuild({ logger: req.payload.logger, site: doc.site, slug: doc.slug, reason })
  return doc
}

export const rebuildSiteAfterDelete: CollectionAfterDeleteHook = async ({ doc, req }) => {
  if (doc?._status === 'published') {
    void dispatchSiteRebuild({ logger: req.payload.logger, site: doc.site, slug: doc.slug, reason: 'delete' })
  }
  return doc
}

// site-settings (menu, footer, tagline…) không có nháp: mỗi lần lưu là đổi nội dung public → build lại site qkenn
export const rebuildSiteAfterGlobalChange: GlobalAfterChangeHook = async ({ doc, req }) => {
  void dispatchSiteRebuild({ logger: req.payload.logger, site: 'qkenn', slug: 'site-settings', reason: 'settings' })
  return doc
}
