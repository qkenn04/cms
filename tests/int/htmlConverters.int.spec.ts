import { describe, expect, it, vi } from 'vitest'
import { convertLexicalToHTMLAsync } from '@payloadcms/richtext-lexical/html-async'

import { buildSrcset, htmlConverters } from '@/lexical/htmlConverters'
import type { Media } from '@/payload-types'

const base = 'https://cms.example/api/media/file'
const size = (name: string, width: number, height: number) => ({
  url: `${base}/${name}-${width}x${height}.webp`,
  width,
  height,
  mimeType: 'image/webp',
  filesize: 1000,
  filename: `${name}-${width}x${height}.webp`,
})

// Ảnh gốc 16:9: thumbnail (4:3) và og (1.91:1) phải bị loại khỏi srcset
const wide: Media = {
  id: 7,
  alt: 'Ảnh "rộng" <16:9>',
  url: `${base}/wide.webp`,
  filename: 'wide.webp',
  mimeType: 'image/webp',
  width: 2400,
  height: 1350,
  updatedAt: '',
  createdAt: '',
  sizes: {
    thumbnail: size('wide', 400, 300),
    card: size('wide', 800, 450),
    hero: size('wide', 1600, 900),
    og: size('wide', 1200, 630),
  },
}

// Ảnh nhỏ: card/hero không sinh (withoutEnlargement) → không có srcset
const small: Media = {
  id: 8,
  alt: 'nhỏ',
  url: `${base}/small.webp`,
  filename: 'small.webp',
  mimeType: 'image/webp',
  width: 600,
  height: 400,
  updatedAt: '',
  createdAt: '',
  sizes: {
    thumbnail: size('small', 400, 300),
    card: { url: null, width: null, height: null },
    hero: { url: null, width: null, height: null },
    og: size('small', 1200, 630),
  },
}

const editorState = (value: Media | number) =>
  ({
    root: {
      type: 'root',
      version: 1,
      direction: null,
      format: '',
      indent: 0,
      children: [
        {
          type: 'paragraph',
          version: 1,
          direction: null,
          format: '',
          indent: 0,
          textFormat: 0,
          children: [
            {
              type: 'text',
              version: 1,
              text: 'Mở đầu',
              format: 0,
              style: '',
              mode: 'normal',
              detail: 0,
            },
          ],
        },
        {
          type: 'upload',
          version: 3,
          format: '',
          id: 'u1',
          fields: {},
          relationTo: 'media',
          value,
        },
      ],
    },
  }) as never

describe('buildSrcset (giống buildSrcset của site)', () => {
  it('chỉ lấy size cùng tỉ lệ, trùng width giữ size đầu, sắp theo width', () => {
    expect(buildSrcset(wide, { url: wide.url!, width: 2400, height: 1350 })).toBe(
      `${base}/wide-800x450.webp 800w, ${base}/wide-1600x900.webp 1600w, ${base}/wide.webp 2400w`,
    )
  })

  it('ít hơn 2 ứng viên → undefined', () => {
    expect(buildSrcset(small, { url: small.url!, width: 600, height: 400 })).toBeUndefined()
  })
})

describe('htmlConverters: upload trong contentHtml', () => {
  it('render đúng 1 <img> (không <picture>/<source>) với src gốc, kích thước, alt, lazy, srcset cùng tỉ lệ', async () => {
    const html = await convertLexicalToHTMLAsync({
      converters: htmlConverters,
      data: editorState(wide),
    })

    expect(html).not.toMatch(/<picture|<source/)
    expect(html.match(/<img\b/g)).toHaveLength(1)
    const img = html.match(/<img\b[^>]*>/)![0]
    expect(img).toContain(`src="${base}/wide.webp"`)
    expect(img).toContain('width="2400"')
    expect(img).toContain('height="1350"')
    expect(img).toContain('alt="Ảnh &quot;rộng&quot; &lt;16:9&gt;"')
    expect(img).toContain('loading="lazy"')
    expect(img).toContain('decoding="async"')
    expect(img).toContain(
      `srcset="${base}/wide-800x450.webp 800w, ${base}/wide-1600x900.webp 1600w, ${base}/wide.webp 2400w"`,
    )
    expect(img).toContain('sizes="')
    expect(img).not.toContain('400x300')
    expect(img).not.toContain('1200x630')
    // các node khác vẫn dùng converter mặc định
    expect(html).toContain('<p>Mở đầu</p>')
  })

  it('không đủ size cùng tỉ lệ → <img> không srcset/sizes', async () => {
    const html = await convertLexicalToHTMLAsync({
      converters: htmlConverters,
      data: editorState(small),
    })
    const img = html.match(/<img\b[^>]*>/)![0]
    expect(img).toContain(`src="${base}/small.webp"`)
    expect(img).toContain('width="600"')
    expect(img).not.toContain('srcset=')
    expect(img).not.toContain('sizes=')
  })

  it('node chỉ có id → populate media rồi render; không tìm thấy → bỏ ảnh', async () => {
    const populate = vi.fn().mockResolvedValue(wide)
    const html = await convertLexicalToHTMLAsync({
      converters: htmlConverters,
      data: editorState(7),
      populate,
    })
    expect(populate).toHaveBeenCalledWith({ id: 7, collectionSlug: 'media' })
    expect(html).toContain(`src="${base}/wide.webp"`)

    const missing = await convertLexicalToHTMLAsync({
      converters: htmlConverters,
      data: editorState(99),
      populate: vi.fn().mockResolvedValue(undefined),
    })
    expect(missing).not.toContain('<img')
  })
})
