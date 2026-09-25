// Hàm thuần (không đụng Payload/DB) cho src/scripts/import-drafts.ts — test được riêng.

export type FrontMatterValue = string | string[]
export type FrontMatter = Record<string, FrontMatterValue>

/**
 * Parser YAML tối giản, chỉ nhận đúng dạng dùng trong blog-drafts:
 *   key: "chuỗi"   | key: 'chuỗi' | key: giá-trị-trần
 *   key:            (theo sau là các dòng "  - item")
 *   # comment
 * Gặp cú pháp khác (block scalar |, >, map lồng…) → throw, không đoán.
 */
export const parseFrontMatter = (source: string): { data: FrontMatter; body: string } => {
  const text = source.replace(/^﻿/, '').replace(/\r\n?/g, '\n')
  const lines = text.split('\n')
  if (lines[0]?.trim() !== '---') return { data: {}, body: text }
  const end = lines.findIndex((line, i) => i > 0 && line.trim() === '---')
  if (end < 0) throw new Error('front matter: thiếu dòng --- đóng')

  const data: FrontMatter = {}
  let listKey: string | null = null
  for (let i = 1; i < end; i++) {
    const line = lines[i]
    if (!line.trim() || /^\s*#/.test(line)) continue
    const item = line.match(/^\s+-\s+(.*)$/)
    if (item) {
      if (!listKey) throw new Error(`front matter dòng ${i + 1}: item list không thuộc key nào`)
      ;(data[listKey] as string[]).push(parseScalar(item[1], i + 1))
      continue
    }
    const kv = line.match(/^([A-Za-z_][\w-]*):(?:\s+(.*))?$/)
    if (!kv) throw new Error(`front matter dòng ${i + 1}: cú pháp không hỗ trợ`)
    const [, key, raw] = kv
    if (key in data) throw new Error(`front matter: key "${key}" lặp lại`)
    if (raw === undefined || raw.trim() === '') {
      data[key] = []
      listKey = key
      continue
    }
    if (/^[|>]/.test(raw.trim()))
      throw new Error(`front matter "${key}": block scalar không hỗ trợ`)
    data[key] = parseScalar(raw, i + 1)
    listKey = null
  }
  return { data, body: lines.slice(end + 1).join('\n') }
}

const parseScalar = (raw: string, lineNo: number): string => {
  const value = raw.trim()
  if (value.startsWith('"')) {
    const m = value.match(/^"((?:[^"\\]|\\.)*)"\s*(?:#.*)?$/)
    if (!m) throw new Error(`front matter dòng ${lineNo}: chuỗi "…" không đóng`)
    return m[1].replace(/\\(u[0-9a-fA-F]{4}|.)/g, (_, e: string) => {
      if (e.startsWith('u') && e.length === 5) return String.fromCharCode(parseInt(e.slice(1), 16))
      return (
        ({ n: '\n', t: '\t', '"': '"', '\\': '\\', '/': '/' } as Record<string, string>)[e] ?? e
      )
    })
  }
  if (value.startsWith("'")) {
    const m = value.match(/^'((?:[^']|'')*)'\s*(?:#.*)?$/)
    if (!m) throw new Error(`front matter dòng ${lineNo}: chuỗi '…' không đóng`)
    return m[1].replace(/''/g, "'")
  }
  return value.replace(/\s+#.*$/, '')
}

/** Field front matter KHÔNG bao giờ đưa vào CMS (dangSauKhi/canTacGiaXacNhan: ghi chú riêng của tác giả) */
export const PRIVATE_FRONT_MATTER_KEYS = [
  'dangSauKhi',
  'canTacGiaXacNhan',
  'series',
  'estimatedReadingMinutes',
  'status',
] as const

/** Bỏ blockquote đầu bài bắt đầu bằng "Quyết định mặc định" (ghi chú cho tác giả, không phải nội dung) */
export const stripDecisionNote = (body: string): { body: string; removed: boolean } => {
  const lines = body.split('\n')
  let i = 0
  while (i < lines.length && !lines[i].trim()) i++
  if (!/^\s*>/.test(lines[i] ?? '')) return { body, removed: false }
  let j = i
  while (j < lines.length && /^\s*>/.test(lines[j])) j++
  const text = lines
    .slice(i, j)
    .map((l) => l.replace(/^\s*>\s?/, ''))
    .join(' ')
    .replace(/[*_]/g, '')
    .trim()
  if (!text.startsWith('Quyết định mặc định')) return { body, removed: false }
  while (j < lines.length && !lines[j].trim()) j++
  return { body: lines.slice(j).join('\n'), removed: true }
}

export type FencedCode = { language: string; code: string }
export type MarkdownInventory = {
  fences: FencedCode[]
  /** Mỗi bảng GFM: các hàng (bỏ hàng ---), mỗi hàng là text thô của từng ô */
  tables: string[][][]
  headings: number
  links: number
  quoteBlocks: number
  listItems: number
  checkItems: number
  /** Cú pháp markdown ngoài code fence mà converter không hỗ trợ */
  unsupported: string[]
}

const FENCE_OPEN = /^[ \t]*```(\S*)\s*$/
const FENCE_CLOSE = /^[ \t]*```\s*$/
const TABLE_ROW = /^\|(.+)\|\s?$/
const TABLE_DIVIDER = /^(\| ?:?-*:? ?)+\|\s?$/

/** Kiểm kê markdown gốc (ngoài code fence) để so với kết quả Lexical */
export const inventoryMarkdown = (markdown: string): MarkdownInventory => {
  const inv: MarkdownInventory = {
    fences: [],
    tables: [],
    headings: 0,
    links: 0,
    quoteBlocks: 0,
    listItems: 0,
    checkItems: 0,
    unsupported: [],
  }
  const lines = markdown.split('\n')
  let fence: { language: string; lines: string[] } | null = null
  let table: string[][] | null = null
  let prevQuote = false
  for (let n = 0; n < lines.length; n++) {
    const line = lines[n]
    if (fence) {
      if (FENCE_CLOSE.test(line)) {
        inv.fences.push({ language: fence.language, code: fence.lines.join('\n') })
        fence = null
      } else fence.lines.push(line)
      continue
    }
    const open = line.match(FENCE_OPEN)
    if (open) {
      fence = { language: open[1], lines: [] }
      table = null
      prevQuote = false
      continue
    }
    if (TABLE_ROW.test(line)) {
      if (!table) {
        table = []
        inv.tables.push(table)
      }
      if (!TABLE_DIVIDER.test(line)) {
        table.push(
          line
            .match(TABLE_ROW)![1]
            .split('|')
            .map((c) => c.trim()),
        )
      }
      prevQuote = false
      continue
    }
    table = null
    if (/^#{1,6} /.test(line)) inv.headings++
    const isQuote = /^\s*>/.test(line)
    if (isQuote && !prevQuote) inv.quoteBlocks++
    prevQuote = isQuote
    if (/^\s*[-*+] \[[ xX]\] /.test(line)) inv.checkItems++
    else if (/^\s*([-*+]|\d+\.) /.test(line)) inv.listItems++
    // bỏ inline code trước khi đếm link / tìm cú pháp lạ
    const prose = line.replace(/`[^`]*`/g, '``')
    inv.links += (prose.match(/(?<!!)\[[^\]]*\]\([^)\s]+\)/g) ?? []).length
    if (/!\[[^\]]*\]\(/.test(prose)) inv.unsupported.push(`dòng ${n + 1}: ảnh markdown ![]()`)
    if (/\[\^[^\]]+\]/.test(prose)) inv.unsupported.push(`dòng ${n + 1}: footnote [^…]`)
    if (/^\s*<\/?[a-zA-Z][^>]*>/.test(prose)) inv.unsupported.push(`dòng ${n + 1}: HTML thô`)
    if (/^ {2,3}([-*+]|\d+\.) /.test(line))
      inv.unsupported.push(`dòng ${n + 1}: list lồng thụt 2–3 dấu cách (Lexical cần 4)`)
  }
  if (fence) inv.unsupported.push('code fence không đóng ở cuối bài')
  return inv
}
