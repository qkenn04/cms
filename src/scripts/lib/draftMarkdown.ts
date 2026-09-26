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

// ---------- Ảnh: đoạn chỉ gồm `![alt](assets/<file> "chú thích")` ----------

export const IMAGE_MIME_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  avif: 'image/avif',
}

export type ImageRef = {
  /** Số dòng (1-based) trong thân bài đã bỏ front matter */
  line: number
  alt: string
  /** Đường dẫn tương đối thư mục drafts, đã kiểm tra: assets/… */
  src: string
  caption?: string
}

/** `![alt](đích)` hoặc `![alt](đích "title")`, cả dòng; alt/title cho phép ký tự escape `\x` */
const IMAGE_LINE = /^!\[((?:[^\\\]]|\\.)*)\]\(\s*([^\s"]*)(?:\s+"((?:[^"\\]|\\.)*)")?\s*\)$/
// Mỗi đoạn đường dẫn: ASCII an toàn, không bắt đầu bằng '.' (loại ., .., file ẩn)
const IMAGE_PATH =
  /^assets\/(?:[A-Za-z0-9_][A-Za-z0-9._-]*\/)*[A-Za-z0-9_][A-Za-z0-9._-]*\.(png|jpe?g|webp|avif)$/i

/** Bỏ escape markdown (backslash + dấu câu ASCII) — alt/caption lưu dạng text thô, HTML converter escape lúc render */
export const unescapeMarkdown = (s: string): string => s.replace(/\\([!-/:-@[-`{-~])/g, '$1')

/** null = hợp lệ; ngược lại là lý do từ chối */
export const validateImagePath = (src: string): string | null => {
  if (!src) return 'đường dẫn rỗng'
  if (/^[a-z][a-z0-9+.-]*:/i.test(src) || src.startsWith('//')) return 'không nhận URL'
  if (src.startsWith('/') || src.startsWith('\\') || /^[a-z]:/i.test(src))
    return 'không nhận đường dẫn tuyệt đối'
  if (src.includes('\\')) return 'không nhận dấu \\'
  if (src.split('/').some((seg) => seg === '..' || seg === '.')) return 'không nhận . hoặc ..'
  if (!src.startsWith('assets/')) return 'ảnh phải nằm trong assets/'
  if (!/\.(png|jpe?g|webp|avif)$/i.test(src)) return 'chỉ nhận .png .jpg .jpeg .webp .avif'
  if (!IMAGE_PATH.test(src)) return 'tên file chỉ gồm A-Z a-z 0-9 . _ - (không bắt đầu bằng .)'
  return null
}

/** Phân tích 1 dòng ảnh. Không khớp cú pháp → null; khớp nhưng sai → { error } */
export const parseImageLine = (
  line: string,
): { alt: string; src: string; caption?: string } | { error: string } | null => {
  const m = line.trimEnd().match(IMAGE_LINE)
  if (!m) return null
  const [, rawAlt, src, rawCaption] = m
  const alt = unescapeMarkdown(rawAlt).trim()
  const pathError = validateImagePath(src)
  if (pathError) return { error: `ảnh "${src}": ${pathError}` }
  if (!alt) return { error: `ảnh "${src}": thiếu alt (media.alt bắt buộc)` }
  const caption = rawCaption === undefined ? undefined : unescapeMarkdown(rawCaption).trim()
  return caption ? { alt, src, caption } : { alt, src }
}

/**
 * Tìm các đoạn chỉ có 1 ảnh (dòng đứng riêng, trên/dưới là dòng trống hoặc đầu/cuối bài, ngoài code fence)
 * và thay bằng dòng token(i) — converter markdown giữ token thành 1 paragraph, importer thay bằng upload node.
 * Dòng bắt đầu bằng `![` mà sai cú pháp/đường dẫn/không đứng riêng → errors (bài không được import).
 */
export const extractImageParagraphs = (
  markdown: string,
  token: (index: number) => string,
): { markdown: string; images: ImageRef[]; errors: string[] } => {
  const lines = markdown.split('\n')
  const images: ImageRef[] = []
  const errors: string[] = []
  let inFence = false
  for (let n = 0; n < lines.length; n++) {
    const line = lines[n]
    if (inFence) {
      if (FENCE_CLOSE.test(line)) inFence = false
      continue
    }
    if (FENCE_OPEN.test(line)) {
      inFence = true
      continue
    }
    if (!/^\s*!\[/.test(line)) continue
    const where = `dòng ${n + 1}`
    if (/^\s/.test(line)) {
      errors.push(`${where}: ảnh phải ở đầu dòng, không thụt lề (không nằm trong list/quote)`)
      continue
    }
    const parsed = parseImageLine(line)
    if (!parsed) {
      errors.push(`${where}: cú pháp ảnh không hợp lệ — cần ![alt](assets/<file> "chú thích")`)
      continue
    }
    if ('error' in parsed) {
      errors.push(`${where}: ${parsed.error}`)
      continue
    }
    const blank = (i: number) => i < 0 || i >= lines.length || !lines[i].trim()
    if (!blank(n - 1) || !blank(n + 1)) {
      errors.push(`${where}: ảnh phải là một đoạn riêng (dòng trống trước và sau)`)
      continue
    }
    lines[n] = token(images.length)
    images.push({ line: n + 1, ...parsed })
  }
  return { markdown: lines.join('\n'), images, errors }
}

/**
 * Tên file lưu trong media: <tên gốc>-<16 hex đầu sha256 nội dung>.<ext>.
 * Media không có cột hash (và ảnh gốc bị đổi sang webp nên filesize ≠ file nguồn) → hash nằm trong tên
 * file: cùng tên + cùng hash = cùng nội dung → dùng lại; đổi nội dung → tên mới → upload mới.
 */
export const hashedFilename = (src: string, sha256Hex: string): string => {
  const base = src.split('/').pop()!
  const dot = base.lastIndexOf('.')
  return `${base.slice(0, dot)}-${sha256Hex.slice(0, 16)}${base.slice(dot).toLowerCase()}`
}

/** Phần tên không có đuôi — so khớp media đã lưu bất kể đuôi (ảnh gốc được đổi sang .webp) */
export const filenameStem = (filename: string): string => filename.replace(/\.[^./]+$/, '')

/** Kiểm tra magic bytes khớp đuôi file; null = khớp */
export const sniffImage = (bytes: Uint8Array, src: string): string | null => {
  const ext = src.split('.').pop()!.toLowerCase()
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to))
  const kind =
    bytes[0] === 0x89 && ascii(1, 4) === 'PNG'
      ? 'png'
      : bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
        ? 'jpeg'
        : ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP'
          ? 'webp'
          : ascii(4, 8) === 'ftyp' && /^avi[fs]$/.test(ascii(8, 12))
            ? 'avif'
            : null
  const expected = ext === 'jpg' ? 'jpeg' : ext
  if (!kind) return 'không phải ảnh png/jpeg/webp/avif'
  return kind === expected ? null : `nội dung là ${kind} nhưng đuôi file là .${ext}`
}
