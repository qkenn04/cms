import { describe, expect, it } from 'vitest'

import { inventoryMarkdown, parseFrontMatter, stripDecisionNote } from '@/scripts/lib/draftMarkdown'

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
