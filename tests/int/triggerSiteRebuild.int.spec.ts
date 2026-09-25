import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { decideRebuild, dispatchSiteRebuild } from '@/hooks/triggerSiteRebuild'

const published = { _status: 'published', slug: 'xin-chao', site: 'qkenn' } as const
const draft = { _status: 'draft', slug: 'xin-chao', site: 'qkenn' } as const

describe('decideRebuild', () => {
  it('bỏ qua autosave / lưu nháp (không đổi nội dung public)', () => {
    expect(decideRebuild({ doc: draft, previousDoc: draft, isDraftWrite: true })).toBe(false)
    // sửa nháp trên bài đang published: bản public vẫn giữ nguyên
    expect(decideRebuild({ doc: draft, previousDoc: published, isDraftWrite: true })).toBe(false)
  })

  it('rebuild khi publish lần đầu', () => {
    expect(decideRebuild({ doc: published, previousDoc: draft, isDraftWrite: false })).toBe(true)
  })

  it('rebuild khi publish lại bài đã published', () => {
    expect(decideRebuild({ doc: published, previousDoc: published, isDraftWrite: false })).toBe(true)
  })

  it('rebuild khi unpublish', () => {
    expect(decideRebuild({ doc: draft, previousDoc: published, isDraftWrite: false })).toBe(true)
  })

  it('không rebuild khi tạo bài nháp mới', () => {
    expect(decideRebuild({ doc: draft, previousDoc: undefined, isDraftWrite: false })).toBe(false)
  })
})

describe('dispatchSiteRebuild', () => {
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  const fetchMock = vi.fn()

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock)
    vi.stubEnv('SITE_REBUILD_ENABLED', 'true')
    vi.stubEnv('GITHUB_DISPATCH_TOKEN', 'test-token')
    vi.stubEnv('SITE_REPO', 'qkenn04/qkenn-site')
    fetchMock.mockReset()
    logger.info.mockReset()
    logger.warn.mockReset()
    logger.error.mockReset()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it('gọi đúng endpoint repository_dispatch với event cms-publish', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }))
    const ok = await dispatchSiteRebuild({ logger, site: 'qkenn', slug: 'xin-chao', reason: 'publish' })

    expect(ok).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.github.com/repos/qkenn04/qkenn-site/dispatches')
    expect(init.method).toBe('POST')
    expect(init.headers.Authorization).toBe('Bearer test-token')
    expect(JSON.parse(init.body)).toEqual({
      event_type: 'cms-publish',
      client_payload: { site: 'qkenn', slug: 'xin-chao', reason: 'publish' },
    })
  })

  it('không gọi khi chưa bật (dev mặc định)', async () => {
    vi.stubEnv('SITE_REBUILD_ENABLED', '')
    vi.stubEnv('NODE_ENV', 'development')
    const ok = await dispatchSiteRebuild({ logger, site: 'qkenn', slug: 'x', reason: 'publish' })
    expect(ok).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('không gọi khi thiếu token', async () => {
    vi.stubEnv('GITHUB_DISPATCH_TOKEN', '')
    const ok = await dispatchSiteRebuild({ logger, site: 'qkenn', slug: 'x', reason: 'publish' })
    expect(ok).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('không gọi cho site chưa cấu hình repo (vd nail)', async () => {
    const ok = await dispatchSiteRebuild({ logger, site: 'nail', slug: 'x', reason: 'publish' })
    expect(ok).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('GitHub lỗi: không throw, chỉ log', async () => {
    fetchMock.mockResolvedValue(new Response('bad', { status: 401 }))
    await expect(
      dispatchSiteRebuild({ logger, site: 'qkenn', slug: 'x', reason: 'publish' }),
    ).resolves.toBe(false)
    expect(logger.error).toHaveBeenCalled()
  })

  it('mạng lỗi: không throw, chỉ log', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNRESET'))
    await expect(
      dispatchSiteRebuild({ logger, site: 'qkenn', slug: 'x', reason: 'publish' }),
    ).resolves.toBe(false)
    expect(logger.error).toHaveBeenCalled()
  })
})
