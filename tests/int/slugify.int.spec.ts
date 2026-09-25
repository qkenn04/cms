import { describe, expect, it } from 'vitest'

import { NUMERIC_SLUG_ERROR, isNumericSlug, slugFrom, toSlug, validateSlug } from '@/hooks/slugify'

// Tối thiểu cho validator `text` mặc định của Payload (đọc req.payload.config, req.t)
const validateOptions = { req: { payload: { config: {} }, t: (key: string) => key } } as never

const runHook = (
  hook: ReturnType<typeof slugFrom>,
  value: unknown,
  data: Record<string, unknown>,
) => hook({ value, data } as never)

describe('toSlug', () => {
  it('bỏ dấu tiếng Việt, đ → d, chữ thường, nối bằng "-"', () => {
    expect(toSlug('Ra mắt Sản phẩm Đẹp!')).toBe('ra-mat-san-pham-dep')
    expect(toSlug('Đường đi  của   nước')).toBe('duong-di-cua-nuoc')
  })

  it('cắt "-" ở hai đầu và gộp ký tự lạ', () => {
    expect(toSlug('  --Hello, World!--  ')).toBe('hello-world')
    expect(toSlug('a/b?c#d')).toBe('a-b-c-d')
  })

  it('giữ nguyên chữ số', () => {
    expect(toSlug('2026')).toBe('2026')
    expect(toSlug('Top 10 mẹo')).toBe('top-10-meo')
  })
})

describe('isNumericSlug', () => {
  it('chỉ đúng với slug toàn chữ số', () => {
    expect(isNumericSlug('2')).toBe(true)
    expect(isNumericSlug('2026')).toBe(true)
    expect(isNumericSlug('bai-2026')).toBe(false)
    expect(isNumericSlug('2-3')).toBe(false)
    expect(isNumericSlug('')).toBe(false)
  })
})

describe('validateSlug', () => {
  it('chặn slug toàn chữ số (trùng /blog/2) với thông báo Việt + Anh', () => {
    const result = validateSlug('2', validateOptions)
    expect(result).toBe(NUMERIC_SLUG_ERROR)
    expect(result).toContain('Slug không được chỉ gồm chữ số')
    expect(result).toContain('Slug cannot be digits only')
    expect(validateSlug('2026', validateOptions)).toBe(NUMERIC_SLUG_ERROR)
  })

  it('cho qua slug thường và slug trống (field không required)', () => {
    expect(validateSlug('bai-2026', validateOptions)).toBe(true)
    expect(validateSlug('xin-chao', validateOptions)).toBe(true)
    expect(validateSlug(undefined, validateOptions)).toBe(true)
    expect(validateSlug(null, validateOptions)).toBe(true)
  })
})

describe('slugFrom', () => {
  // như Posts; Pages dùng tiền tố 'trang'
  const fromTitle = slugFrom('title', 'bai')

  it('slug trống → sinh từ tiêu đề', () => {
    expect(runHook(fromTitle, '', { title: 'Xin chào thế giới' })).toBe('xin-chao-the-gioi')
    expect(runHook(fromTitle, undefined, { title: 'Xin chào' })).toBe('xin-chao')
  })

  it('tiêu đề toàn số → thêm tiền tố thay vì báo lỗi', () => {
    expect(runHook(fromTitle, '', { title: '2026' })).toBe('bai-2026')
    expect(runHook(slugFrom('title', 'trang'), '', { title: '404' })).toBe('trang-404')
    // sau khi thêm tiền tố thì qua được validateSlug
    expect(validateSlug(runHook(fromTitle, '', { title: '2026' }) as string, validateOptions)).toBe(
      true,
    )
  })

  it('slug editor tự nhập chỉ được chuẩn hoá — slug toàn số để validateSlug báo lỗi', () => {
    expect(runHook(fromTitle, 'Bài Viết Mới', { title: 'khác' })).toBe('bai-viet-moi')
    const typed = runHook(fromTitle, '2', { title: 'blog post' })
    expect(typed).toBe('2')
    expect(validateSlug(typed as string, validateOptions)).toBe(NUMERIC_SLUG_ERROR)
  })

  it('không có slug lẫn tiêu đề → giữ nguyên giá trị', () => {
    expect(runHook(fromTitle, undefined, {})).toBeUndefined()
  })

  it('không truyền tiền tố (categories) → giữ hành vi cũ', () => {
    expect(runHook(slugFrom('title'), '', { title: '2026' })).toBe('2026')
  })
})
