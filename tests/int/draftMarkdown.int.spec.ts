import { describe, expect, it } from 'vitest'

import {
  extractImageParagraphs,
  filenameStem,
  hashedFilename,
  inventoryMarkdown,
  parseFrontMatter,
  parseImageLine,
  sniffImage,
  stripDecisionNote,
  validateImagePath,
} from '@/scripts/lib/draftMarkdown'

describe('parseFrontMatter', () => {
  it('đọc chuỗi có nháy, giá trị trần, list, bỏ comment', () => {
    const { data, body } = parseFrontMatter(
      [
        '---',
        'title: "Tiêu đề \\"trích\\": a # không phải comment"',
        'slug: xin-chao',
        "excerpt: 'It''s'",
        '# ghi chú',
        'estimatedReadingMinutes: 11 # comment',
        'notes:',
        '  - "một"',
        '  - hai',
        '---',
        '',
        'Thân bài',
      ].join('\n'),
    )
    expect(data).toEqual({
      title: 'Tiêu đề "trích": a # không phải comment',
      slug: 'xin-chao',
      excerpt: "It's",
      estimatedReadingMinutes: '11',
      notes: ['một', 'hai'],
    })
    expect(body).toBe('\nThân bài')
  })

  it('không có front matter → data rỗng; cú pháp lạ → throw', () => {
    expect(parseFrontMatter('# Hi').data).toEqual({})
    expect(() => parseFrontMatter('---\na: |\n  x\n---\n')).toThrow()
    expect(() => parseFrontMatter('---\n  - lẻ\n---\n')).toThrow()
    expect(() => parseFrontMatter('---\na: "chưa đóng\n---\n')).toThrow()
    expect(() => parseFrontMatter('---\na: 1\n')).toThrow()
  })
})

describe('stripDecisionNote', () => {
  it('bỏ blockquote "Quyết định mặc định" đầu bài (cả dạng in đậm, nhiều dòng)', () => {
    const md = '\n> **Quyết định mặc định (tác giả sửa):** a\n> b\n\n**TL;DR**\n\n> [SƠ ĐỒ] giữ'
    expect(stripDecisionNote(md)).toEqual({ body: '**TL;DR**\n\n> [SƠ ĐỒ] giữ', removed: true })
  })

  it('blockquote khác ở đầu bài → giữ nguyên', () => {
    const md = '> [SƠ ĐỒ] x\n\nText'
    expect(stripDecisionNote(md)).toEqual({ body: md, removed: false })
  })
})

describe('inventoryMarkdown', () => {
  it('đếm fence (giữ nguyên code), bảng, heading, link, quote, list; bỏ qua cú pháp trong code', () => {
    const inv = inventoryMarkdown(
      [
        '## H',
        '',
        'Xem [a](https://a.example) và `[b](c)`.',
        '',
        '```bash',
        '# không phải heading',
        '  | không phải bảng |',
        '```',
        '',
        '| A | B |',
        '|---|---|',
        '| 1 | 2 |',
        '',
        '> q1',
        '> q2',
        '',
        '- x',
        '- [ ] y',
        '1. z',
      ].join('\n'),
    )
    expect(inv.fences).toEqual([
      { language: 'bash', code: '# không phải heading\n  | không phải bảng |' },
    ])
    expect(inv.tables).toEqual([
      [
        ['A', 'B'],
        ['1', '2'],
      ],
    ])
    expect(inv).toMatchObject({
      headings: 1,
      links: 1,
      quoteBlocks: 1,
      listItems: 2,
      checkItems: 1,
      unsupported: [],
    })
  })
})

describe('ảnh markdown: parseImageLine / validateImagePath', () => {
  it('hợp lệ: alt + đường dẫn assets/, caption tuỳ chọn', () => {
    expect(parseImageLine('![Sơ đồ luồng](assets/flow-01.png)')).toEqual({
      alt: 'Sơ đồ luồng',
      src: 'assets/flow-01.png',
    })
    expect(parseImageLine('![Sơ đồ](assets/sub/a_b.v2.WEBP "Hình 1: luồng deploy")  ')).toEqual({
      alt: 'Sơ đồ',
      src: 'assets/sub/a_b.v2.WEBP',
      caption: 'Hình 1: luồng deploy',
    })
    for (const ext of ['png', 'jpg', 'jpeg', 'webp', 'avif'])
      expect(validateImagePath(`assets/x.${ext}`)).toBeNull()
    // caption rỗng → không có caption
    expect(parseImageLine('![a](assets/x.png "  ")')).toEqual({ alt: 'a', src: 'assets/x.png' })
  })

  it('alt/caption: bỏ escape markdown, giữ nguyên ký tự HTML (converter escape lúc render)', () => {
    expect(
      parseImageLine(String.raw`![a \[b\] <c> & "d" \*e\*](assets/x.png "Cap \"trích\" <i>")`),
    ).toEqual({
      alt: 'a [b] <c> & "d" *e*',
      src: 'assets/x.png',
      caption: 'Cap "trích" <i>',
    })
  })

  it('từ chối URL, đường dẫn tuyệt đối, .., ngoài assets/, đuôi lạ, ký tự lạ, alt rỗng', () => {
    const bad = [
      'https://cdn.example/x.png',
      '//cdn.example/x.png',
      'data:image/png;base64,AAAA',
      'file:///etc/x.png',
      '/abs/assets/x.png',
      'C:/x/assets/x.png',
      'assets/../secret.png',
      'assets/./x.png',
      '../assets/x.png',
      'assets\\x.png',
      'images/x.png',
      'x.png',
      'assets/x.svg',
      'assets/x.gif',
      'assets/x.png.txt',
      'assets/.hidden.png',
      'assets/tên có dấu.png',
      'assets/ảnh.png',
      'assets/',
      '',
    ]
    for (const src of bad) expect(validateImagePath(src), src).not.toBeNull()
    expect(parseImageLine('![a](https://x.example/a.png)')).toEqual({
      error: 'ảnh "https://x.example/a.png": không nhận URL',
    })
    expect(parseImageLine('![a](assets/../x.png)')).toMatchObject({
      error: expect.stringContaining('..'),
    })
    expect(parseImageLine('![](assets/x.png)')).toMatchObject({
      error: expect.stringContaining('alt'),
    })
    expect(parseImageLine('![  ](assets/x.png)')).toMatchObject({
      error: expect.stringContaining('alt'),
    })
    // không khớp cú pháp (không phải cả dòng)
    expect(parseImageLine('![a](assets/x.png) và chữ')).toBeNull()
    expect(parseImageLine('Chữ ![a](assets/x.png)')).toBeNull()
  })
})

describe('extractImageParagraphs', () => {
  const token = (i: number) => `TOKEN${i}X`

  it('thay đoạn ảnh bằng token theo thứ tự, bỏ qua code fence, giữ phần còn lại', () => {
    const md = [
      '![Ảnh 1](assets/a.png)',
      '',
      'Đoạn văn.',
      '',
      '```md',
      '![trong code](https://không-xử-lý.png)',
      '```',
      '',
      '![Ảnh 2](assets/b.jpg "Chú thích 2")',
    ].join('\n')
    const r = extractImageParagraphs(md, token)
    expect(r.errors).toEqual([])
    expect(r.images).toEqual([
      { line: 1, alt: 'Ảnh 1', src: 'assets/a.png' },
      { line: 9, alt: 'Ảnh 2', src: 'assets/b.jpg', caption: 'Chú thích 2' },
    ])
    expect(r.markdown).toBe(
      md
        .replace('![Ảnh 1](assets/a.png)', 'TOKEN0X')
        .replace('![Ảnh 2](assets/b.jpg "Chú thích 2")', 'TOKEN1X'),
    )
    // markdown sau khi thay không còn bị inventory coi là ảnh chưa hỗ trợ
    expect(inventoryMarkdown(r.markdown).unsupported).toEqual([])
  })

  it('lỗi: không đứng riêng đoạn, thụt lề, cú pháp sai, đường dẫn sai — không thay dòng lỗi', () => {
    const md = [
      'Chữ liền trên',
      '![a](assets/a.png)',
      '',
      '  ![b](assets/b.png)',
      '',
      '![c](assets/c.png) chữ sau',
      '',
      '![d](/etc/d.png)',
      '',
      '![e](assets/e.png)',
    ].join('\n')
    const r = extractImageParagraphs(md, token)
    expect(r.images).toEqual([{ line: 10, alt: 'e', src: 'assets/e.png' }])
    expect(r.errors).toHaveLength(4)
    expect(r.errors[0]).toMatch(/^dòng 2: .*đoạn riêng/)
    expect(r.errors[1]).toMatch(/^dòng 4: .*thụt lề/)
    expect(r.errors[2]).toMatch(/^dòng 6: cú pháp ảnh không hợp lệ/)
    expect(r.errors[3]).toMatch(/^dòng 8: .*tuyệt đối/)
    expect(r.markdown.split('\n')[1]).toBe('![a](assets/a.png)')
  })
})

describe('hashedFilename / filenameStem / sniffImage', () => {
  it('tên lưu = <tên>-<16 hex sha256>.<ext thường>; stem bỏ đuôi', () => {
    const sha = 'ab'.repeat(32)
    expect(hashedFilename('assets/sub/Flow-01.PNG', sha)).toBe('Flow-01-abababababababab.png')
    expect(filenameStem('Flow-01-abababababababab.webp')).toBe('Flow-01-abababababababab')
  })

  it('magic bytes phải khớp đuôi file', () => {
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])
    const jpg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0])
    const enc = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0))
    expect(sniffImage(png, 'assets/a.png')).toBeNull()
    expect(sniffImage(jpg, 'assets/a.jpg')).toBeNull()
    expect(sniffImage(jpg, 'assets/a.jpeg')).toBeNull()
    expect(sniffImage(enc('RIFF\0\0\0\0WEBPVP8 '), 'assets/a.webp')).toBeNull()
    expect(sniffImage(enc('\0\0\0\x1cftypavif'), 'assets/a.avif')).toBeNull()
    expect(sniffImage(png, 'assets/a.jpg')).toMatch(/png.*\.jpg/)
    expect(sniffImage(enc('<svg xmlns="x">'), 'assets/a.png')).toMatch(/không phải ảnh/)
  })
})
