import { describe, expect, it, vi } from 'vitest'
import { convertLexicalToHTMLAsync } from '@payloadcms/richtext-lexical/html-async'

import {
  buildSrcset,
  codeBlockToHTML,
  escapeHTML,
  htmlConverters,
  sanitizeCodeLanguage,
} from '@/lexical/htmlConverters'
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

// ---------- code block + bảng ----------

const root = (...children: unknown[]) =>
  ({
    root: { type: 'root', version: 1, direction: null, format: '', indent: 0, children },
  }) as never

const text = (t: string, format = 0) => ({
  type: 'text',
  version: 1,
  text: t,
  format,
  style: '',
  mode: 'normal',
  detail: 0,
})
const para = (...children: unknown[]) => ({
  type: 'paragraph',
  version: 1,
  direction: null,
  format: '',
  indent: 0,
  textFormat: 0,
  children,
})
const codeBlock = (code: string, language?: string) => ({
  type: 'block',
  version: 2,
  format: '',
  fields: { id: 'b1', blockName: '', blockType: 'Code', code, language },
})
const cell = (headerState: number, ...children: unknown[]) => ({
  type: 'tablecell',
  version: 1,
  direction: null,
  format: '',
  indent: 0,
  headerState,
  children,
})
const row = (...cells: unknown[]) => ({
  type: 'tablerow',
  version: 1,
  direction: null,
  format: '',
  indent: 0,
  children: cells,
})
const table = (...rows: unknown[]) => ({
  type: 'table',
  version: 1,
  direction: null,
  format: '',
  indent: 0,
  children: rows,
})

const toHTML = (data: never) =>
  convertLexicalToHTMLAsync({ converters: htmlConverters, data, disableContainer: true })

describe('htmlConverters: code block', () => {
  it('escape & < > " \' — code chứa </code><script> không thoát được khỏi <code>', async () => {
    const code = `</code><script>alert("x" & 'y')</script>`
    const html = await toHTML(root(codeBlock(code, 'html')))
    expect(html).toBe(
      '<pre><code class="language-html">&lt;/code&gt;&lt;script&gt;alert(&quot;x&quot; &amp; &#39;y&#39;)&lt;/script&gt;</code></pre>',
    )
    expect(html).not.toContain('<script')
    expect(html.match(/<\/code>/g)).toHaveLength(1)
  })

  it('giữ nguyên khoảng trắng, tab, dòng trống và xuống dòng cuối', async () => {
    const code = '  if (a) {\n\t\treturn  1\n\n  }\n'
    const html = await toHTML(root(codeBlock(code, 'ts')))
    expect(html).toBe(`<pre><code class="language-ts">${code}</code></pre>`)
  })

  it('ngôn ngữ: chỉ giữ [a-z0-9+#-], rỗng/không có → text', async () => {
    expect(sanitizeCodeLanguage('TypeScript')).toBe('typescript')
    expect(sanitizeCodeLanguage('c++')).toBe('c++')
    expect(sanitizeCodeLanguage('c#')).toBe('c#')
    expect(sanitizeCodeLanguage('objective-c')).toBe('objective-c')
    expect(sanitizeCodeLanguage('x" onmouseover="alert(1)')).toBe('xonmouseoveralert1')
    expect(sanitizeCodeLanguage('<>"\' ')).toBe('text')
    expect(sanitizeCodeLanguage('')).toBe('text')
    expect(sanitizeCodeLanguage(undefined)).toBe('text')
    expect(sanitizeCodeLanguage(42)).toBe('text')

    expect(await toHTML(root(codeBlock('echo hi', 'bash" onclick="x')))).toBe(
      '<pre><code class="language-bashonclickx">echo hi</code></pre>',
    )
    expect(await toHTML(root(codeBlock('plain')))).toBe(
      '<pre><code class="language-text">plain</code></pre>',
    )
  })

  it('codeBlockToHTML / escapeHTML dùng riêng được; code không phải chuỗi → rỗng', () => {
    expect(escapeHTML(`<a href="x">'&'</a>`)).toBe(
      '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;',
    )
    expect(codeBlockToHTML({ code: undefined, language: 'sh' })).toBe(
      '<pre><code class="language-sh"></code></pre>',
    )
  })

  it('không làm hỏng inline code và đoạn văn xung quanh', async () => {
    const html = await toHTML(root(para(text('Chạy '), text('<cmd>', 16)), codeBlock('ls', 'sh')))
    expect(html).toBe(
      '<p>Chạy <code>&lt;cmd&gt;</code></p><pre><code class="language-sh">ls</code></pre>',
    )
  })
})

describe('htmlConverters: bảng', () => {
  it('hàng header (headerState ROW) → <thead><th scope="col">, còn lại <tbody><td>, bọc .table-wrap, không style inline', async () => {
    const html = await toHTML(
      root(
        table(
          row(cell(1, para(text('Tên'))), cell(1, para(text('Giá trị')))),
          row(cell(0, para(text('a < b'))), cell(0, para(text('x'), text('y', 1)))),
          row(cell(0, para(text('c'))), cell(0)),
        ),
      ),
    )
    expect(html).toBe(
      '<div class="table-wrap"><table>' +
        '<thead><tr><th scope="col">Tên</th><th scope="col">Giá trị</th></tr></thead>' +
        '<tbody><tr><td>a &lt; b</td><td>x<strong>y</strong></td></tr><tr><td>c</td><td></td></tr></tbody>' +
        '</table></div>',
    )
    expect(html).not.toContain('style=')
  })

  it('bảng không có header → chỉ <tbody>; ô header cột (COLUMN) → <th scope="row">; colspan', async () => {
    const html = await toHTML(
      root(table(row({ ...cell(2, para(text('k'))), colSpan: 2 }, cell(0, para(text('v')))))),
    )
    expect(html).toBe(
      '<div class="table-wrap"><table><tbody><tr><th scope="row" colspan="2">k</th><td>v</td></tr></tbody></table></div>',
    )
  })
})
