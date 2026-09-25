// Import bài nháp markdown (blog-drafts/0[1-8]-*.md) vào posts dưới dạng DRAFT (locale vi, site qkenn).
//
// Chạy: pnpm payload run src/scripts/import-drafts.ts -- <thư mục drafts>
//       (hoặc IMPORT_DIR=<thư mục> pnpm payload run src/scripts/import-drafts.ts)
// Danh mục lấy từ <dir>/_brief/series-plan.json (categoriesForCms); đổi đường dẫn bằng IMPORT_CATEGORIES_FILE.
//
// - Idempotent: upsert theo slug; chạy lại chỉ cập nhật bản NHÁP, nội dung không đổi thì bỏ qua.
// - Không bao giờ publish, không set publishedAt. Bài cùng slug đã PUBLISHED → bỏ qua + cảnh báo.
// - Draft không kích hoạt rebuild site: rebuildSiteAfterChange chỉ dispatch khi doc hoặc previousDoc
//   có _status 'published' (src/hooks/triggerSiteRebuild.ts), mà script này chỉ ghi bài draft.
// - Front matter: chỉ title/slug/excerpt/category/seoTitle/seoDescription vào CMS.
//   dangSauKhi, canTacGiaXacNhan (ghi chú riêng), series, estimatedReadingMinutes, status bị bỏ,
//   và script kiểm tra lại rằng không chuỗi nào của chúng lọt vào document đã lưu.
import { createHash } from 'crypto'
import fs from 'fs/promises'
import path from 'path'
import { getPayload, type Payload, type RichTextField } from 'payload'
import { convertMarkdownToLexical, editorConfigFactory } from '@payloadcms/richtext-lexical'

import config from '../payload.config'
import { DEFAULT_CODE_LANGUAGE, normalizeCodeLanguage } from '../lexical/codeLanguages'
import {
  inventoryMarkdown,
  parseFrontMatter,
  stripDecisionNote,
  type FrontMatter,
  type MarkdownInventory,
} from './lib/draftMarkdown'

type LexNode = {
  type: string
  children?: LexNode[]
  text?: string
  format?: number | string
  tag?: string
  listType?: string
  fields?: Record<string, unknown>
  [key: string]: unknown
}
type EditorState = { root: LexNode }

const FILE_PATTERN = /^0[1-8]-.*\.md$/
const LOCALE = 'vi'
const SITE = 'qkenn'
const IS_CODE_FORMAT = 16 // TextNode format bit: code

const argDir = process.argv.slice(2).filter((a) => a !== '--')[0]
const importDir = path.resolve(argDir || process.env.IMPORT_DIR || '')

const str = (fm: FrontMatter, key: string): string => {
  const v = fm[key]
  return typeof v === 'string' ? v : ''
}

// ---------- Lexical helpers ----------

const walk = (node: LexNode, visit: (n: LexNode, parent?: LexNode) => void, parent?: LexNode) => {
  visit(node, parent)
  for (const child of node.children ?? []) walk(child, visit, node)
}

const textOf = (node: LexNode): string => {
  if (node.type === 'text') return node.text ?? ''
  if (node.type === 'linebreak') return '\n'
  return (node.children ?? []).map(textOf).join('')
}

type Summary = Record<string, number>

const countNodes = (state: EditorState): Summary => {
  const s: Summary = {}
  const inc = (k: string) => (s[k] = (s[k] ?? 0) + 1)
  walk(state.root, (n) => {
    if (n.type === 'heading') inc(`heading.${n.tag}`)
    else if (n.type === 'block') inc(`block.${String(n.fields?.blockType)}`)
    else if (n.type === 'list') inc(`list.${n.listType}`)
    else if (n.type !== 'root' && n.type !== 'text') inc(n.type)
  })
  return Object.fromEntries(Object.entries(s).sort(([a], [b]) => a.localeCompare(b)))
}

/**
 * Hậu xử lý JSON Lexical sau convertMarkdownToLexical:
 * - code block: language → key hợp lệ của CODE_LANGUAGES (ngoài danh sách → text, ghi degraded)
 * - id ngẫu nhiên (block, link) → id cố định theo slug + thứ tự: chạy lại cho ra cùng JSON,
 *   nhờ đó nhận biết "không đổi" và không tạo version thừa
 */
const postProcess = (state: EditorState, slug: string, degraded: string[]) => {
  const stableId = (kind: string, i: number) =>
    createHash('sha1').update(`${slug}:${kind}:${i}`).digest('hex').slice(0, 24)
  let blockIndex = 0
  let nodeIndex = 0
  walk(state.root, (n) => {
    if (typeof n.id === 'string') n.id = stableId('node', nodeIndex++)
    if (n.type !== 'block' || n.fields?.blockType !== 'Code') return
    const raw = typeof n.fields.language === 'string' ? n.fields.language : ''
    const lang = normalizeCodeLanguage(raw)
    if (!lang) {
      if (raw)
        degraded.push(
          `code block #${blockIndex + 1}: ngôn ngữ "${raw}" không có trong danh sách → ${DEFAULT_CODE_LANGUAGE}`,
        )
      n.fields.language = DEFAULT_CODE_LANGUAGE
    } else {
      if (lang !== raw)
        degraded.push(`code block #${blockIndex + 1}: ngôn ngữ "${raw}" → "${lang}" (alias)`)
      n.fields.language = lang
    }
    n.fields.id = stableId('code', blockIndex)
    n.fields.blockName = ''
    blockIndex++
  })
}

/** So Lexical với markdown gốc: code (nội dung y hệt), bảng, heading, link, list, quote, cú pháp sót */
const fidelityCheck = (
  state: EditorState,
  inv: MarkdownInventory,
): { ok: boolean; notes: string[] } => {
  const notes: string[] = []
  const codeBlocks: { language: string; code: string }[] = []
  const tables: string[][][] = []
  let headings = 0
  let links = 0
  let quotes = 0
  let listItems = 0
  let checkItems = 0
  const leftovers: string[] = []

  walk(state.root, (n, parent) => {
    if (n.type === 'block' && n.fields?.blockType === 'Code') {
      codeBlocks.push({
        language: String(n.fields.language ?? ''),
        code: String(n.fields.code ?? ''),
      })
    } else if (n.type === 'table') {
      tables.push(
        (n.children ?? []).map((row) => (row.children ?? []).map((cell) => textOf(cell).trim())),
      )
    } else if (n.type === 'heading') headings++
    else if (n.type === 'link' || n.type === 'autolink') links++
    else if (n.type === 'quote') quotes++
    else if (n.type === 'listitem') {
      if (parent?.listType === 'check') checkItems++
      else listItems++
    } else if (n.type === 'text' && !((Number(n.format) || 0) & IS_CODE_FORMAT)) {
      const t = n.text ?? ''
      if (/\*\*|__|~~|`|\]\(|!\[|\[\^|^#{1,6} |^\|.*\|$/.test(t)) leftovers.push(t.slice(0, 80))
    }
  })

  if (codeBlocks.length !== inv.fences.length) {
    notes.push(`code block: markdown ${inv.fences.length} ≠ lexical ${codeBlocks.length}`)
  } else {
    inv.fences.forEach((f, i) => {
      if (f.code !== codeBlocks[i].code) notes.push(`code block #${i + 1}: nội dung KHÁC markdown`)
    })
  }
  const cellText = (s: string) =>
    s
      .replace(/\\\|/g, '|')
      .replace(/[*_`]/g, '')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .trim()
  if (tables.length !== inv.tables.length) {
    notes.push(`bảng: markdown ${inv.tables.length} ≠ lexical ${tables.length}`)
  } else {
    inv.tables.forEach((t, i) => {
      const expected = JSON.stringify(t.map((r) => r.map(cellText)))
      const actual = JSON.stringify(tables[i].map((r) => r.map(cellText)))
      if (expected !== actual) notes.push(`bảng #${i + 1}: ô khác markdown`)
    })
  }
  if (headings !== inv.headings)
    notes.push(`heading: markdown ${inv.headings} ≠ lexical ${headings}`)
  if (links !== inv.links) notes.push(`link: markdown ${inv.links} ≠ lexical ${links}`)
  if (quotes !== inv.quoteBlocks)
    notes.push(`blockquote: markdown ${inv.quoteBlocks} ≠ lexical ${quotes}`)
  if (listItems !== inv.listItems)
    notes.push(`list item: markdown ${inv.listItems} ≠ lexical ${listItems}`)
  if (checkItems !== inv.checkItems)
    notes.push(`checklist item: markdown ${inv.checkItems} ≠ lexical ${checkItems}`)
  for (const l of leftovers) notes.push(`cú pháp markdown còn sót trong text: "${l}"`)
  return { ok: notes.length === 0, notes }
}

/**
 * Mẫu tìm từ field riêng tư (dangSauKhi, canTacGiaXacNhan): mỗi mục tách theo dấu câu thành đoạn ≥ 24 ký tự,
 * cộng 48 ký tự đầu của mục. Dùng để chứng minh không đoạn nào lọt vào document.
 */
const privateNeedles = (fm: FrontMatter): { key: string; needle: string }[] => {
  const out = new Map<string, string>()
  for (const key of ['dangSauKhi', 'canTacGiaXacNhan'] as const) {
    const v = fm[key]
    for (const item of Array.isArray(v) ? v : v ? [v] : []) {
      const t = item.trim()
      if (t.length >= 24) out.set(t.slice(0, 48), key)
      for (const frag of t.split(/[.;:!?()"“”—–]+/))
        if (frag.trim().length >= 24) out.set(frag.trim(), key)
    }
  }
  return [...out].map(([needle, key]) => ({ key, needle }))
}

/** Toàn bộ text sẽ lưu: field text + mọi text/code trong Lexical */
const storedText = (data: {
  title: string
  excerpt: string
  meta: { title: string; description: string }
  content: EditorState
}): string => {
  const parts = [data.title, data.excerpt, data.meta.title, data.meta.description]
  walk(data.content.root, (n) => {
    if (typeof n.text === 'string') parts.push(n.text)
    if (typeof n.url === 'string') parts.push(n.url)
    for (const v of Object.values(n.fields ?? {})) if (typeof v === 'string') parts.push(v)
  })
  return parts.join('\n')
}

// ---------- Payload ----------

const ensureCategories = async (
  payload: Payload,
  file: string,
): Promise<Map<string, number | string>> => {
  const plan = JSON.parse(await fs.readFile(file, 'utf8')) as {
    categoriesForCms?: { slug: string; vi: string; en: string }[]
  }
  const list = plan.categoriesForCms ?? []
  if (!list.length) throw new Error(`${file}: không có categoriesForCms`)
  const ids = new Map<string, number | string>()
  for (const c of list) {
    const found = await payload.find({
      collection: 'categories',
      where: { slug: { equals: c.slug } },
      limit: 1,
      depth: 0,
      overrideAccess: true,
    })
    if (found.docs[0]) {
      ids.set(c.slug, found.docs[0].id)
      console.log(`  danh mục ${c.slug}: đã có (id ${found.docs[0].id})`)
      continue
    }
    const created = await payload.create({
      collection: 'categories',
      locale: 'vi',
      data: { slug: c.slug, title: c.vi },
      overrideAccess: true,
    })
    await payload.update({
      collection: 'categories',
      id: created.id,
      locale: 'en',
      data: { title: c.en },
      overrideAccess: true,
    })
    ids.set(c.slug, created.id)
    console.log(`  danh mục ${c.slug}: TẠO MỚI (id ${created.id})`)
  }
  return ids
}

const firstAdmin = async (payload: Payload) => {
  const res = await payload.find({
    collection: 'users',
    where: { roles: { in: ['admin'] } },
    sort: 'createdAt',
    limit: 1,
    depth: 0,
    overrideAccess: true,
  })
  const user = res.docs[0]
  if (!user) throw new Error('Không có user admin nào')
  return user
}

// So sánh "không đổi": bỏ key rỗng/null để khác biệt chuẩn hoá của DB không tính là đổi
const canonical = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v !== null && v !== undefined && v !== '')
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, canonical(v)]),
    )
  }
  return value
}
const idOf = (v: unknown) =>
  v && typeof v === 'object' && 'id' in v ? (v as { id: unknown }).id : v

const run = async () => {
  if (!argDir && !process.env.IMPORT_DIR) {
    throw new Error(
      'Thiếu thư mục: pnpm payload run src/scripts/import-drafts.ts -- <dir>  (hoặc IMPORT_DIR)',
    )
  }
  const files = (await fs.readdir(importDir)).filter((f) => FILE_PATTERN.test(f)).sort()
  if (!files.length) throw new Error(`${importDir}: không có file 0[1-8]-*.md`)

  // IMPORT_DRY=1: chỉ chuyển markdown → Lexical + kiểm tra, không kết nối/ghi DB
  const dry = process.env.IMPORT_DRY === '1'
  const sanitized = await config
  const postsConfig = sanitized.collections.find((c) => c.slug === 'posts')
  const contentField = postsConfig?.flattenedFields.find((f) => f.name === 'content') as
    RichTextField | undefined
  if (!contentField) throw new Error('posts.content không tồn tại')
  // Đúng editor config (đã sanitize) của posts.content: code block + bảng + link…
  const editorConfig = editorConfigFactory.fromField({ field: contentField })

  console.log(
    `${dry ? '[DRY] Chuyển đổi' : 'Import'} ${files.length} bài từ ${importDir} (locale ${LOCALE}, site ${SITE}, DRAFT)`,
  )
  let payload: Payload | undefined
  let categoryIds = new Map<string, number | string>()
  let authorId: number | string = 0
  if (!dry) {
    payload = await getPayload({ config })
    const categoriesFile =
      process.env.IMPORT_CATEGORIES_FILE || path.join(importDir, '_brief', 'series-plan.json')
    categoryIds = await ensureCategories(payload, categoriesFile)
    authorId = (await firstAdmin(payload)).id
    console.log(`  tác giả: user id ${authorId} (admin đầu tiên)`)
  }

  let failures = 0
  for (const file of files) {
    const degraded: string[] = []
    const { data: fm, body: rawBody } = parseFrontMatter(
      await fs.readFile(path.join(importDir, file), 'utf8'),
    )
    const { body, removed } = stripDecisionNote(rawBody)
    if (removed) degraded.push('đã bỏ blockquote "Quyết định mặc định" đầu bài (có chủ đích)')

    const slug = str(fm, 'slug')
    const title = str(fm, 'title')
    if (!slug || !title) {
      console.error(`✗ ${file}: thiếu slug/title`)
      failures++
      continue
    }
    const category = str(fm, 'category')
    const categoryId = categoryIds.get(category)
    if (!categoryId && !dry)
      degraded.push(`category "${category}" không có trong categoriesForCms → bỏ trống`)
    const excerpt = str(fm, 'excerpt')
    if (excerpt.length > 300)
      degraded.push(`excerpt ${excerpt.length} ký tự > maxLength 300 (publish sẽ lỗi validate)`)

    const inv = inventoryMarkdown(body)
    degraded.push(...inv.unsupported)
    const content = convertMarkdownToLexical({
      editorConfig,
      markdown: body,
    }) as unknown as EditorState
    postProcess(content, slug, degraded)
    const fidelity = fidelityCheck(content, inv)

    const data = {
      title,
      slug,
      excerpt,
      content,
      categories: categoryId ? [categoryId] : [],
      author: authorId,
      site: SITE,
      meta: { title: str(fm, 'seoTitle'), description: str(fm, 'seoDescription') },
      _status: 'draft' as const,
    }

    // Không đưa field riêng tư nào vào data: chỉ các key đọc ở trên. Kiểm tra lại trên text sẽ lưu:
    // - đoạn chỉ có ở field riêng tư mà lại xuất hiện → lỗi xử lý → KHÔNG ghi
    // - đoạn trùng câu tác giả viết sẵn trong THÂN bài → giữ (là nội dung bài), in cảnh báo để tác giả xem
    const hay = storedText(data)
    const hits = privateNeedles(fm).filter(({ needle }) => hay.includes(needle))
    const fromBody = hits.filter(({ needle }) => body.includes(needle))
    if (hits.length > fromBody.length) {
      console.error(
        `✗ ${file}: ${hits.length - fromBody.length} đoạn của field riêng tư lọt vào dữ liệu import → KHÔNG ghi`,
      )
      failures++
      continue
    }
    for (const key of ['dangSauKhi', 'canTacGiaXacNhan']) {
      const same = fromBody.filter((h) => h.key === key)
      if (!same.length) continue
      // chỉ in độ dài, không in nội dung field riêng tư
      degraded.push(
        `CẢNH BÁO: ${same.length} đoạn của ${key} (${same.map((h) => h.needle.length).join(', ')} ký tự) trùng nguyên văn câu có sẵn trong THÂN bài — nội dung bài giữ nguyên, tác giả xem lại trước khi publish`,
      )
    }

    const counts = countNodes(content)
    const report = (id: number | string, action: string) => {
      console.log(`\n✓ ${file}\n  slug: ${slug}\n  id: ${id} — ${action}`)
      console.log(
        `  node: ${Object.entries(counts)
          .map(([k, v]) => `${k}=${v}`)
          .join(' ')}`,
      )
      console.log(
        `  markdown: fences=${inv.fences.length} tables=${inv.tables.length} headings=${inv.headings} links=${inv.links} quotes=${inv.quoteBlocks} listItems=${inv.listItems} checkItems=${inv.checkItems}`,
      )
      console.log(`  fidelity: ${fidelity.ok ? 'OK' : 'LỆCH'}`)
      for (const n of fidelity.notes) console.log(`    - ${n}`)
      if (degraded.length) {
        console.log('  bỏ / suy giảm:')
        for (const d of degraded) console.log(`    - ${d}`)
      }
      if (!fidelity.ok) failures++
    }
    if (!payload) {
      report('-', 'DRY, không ghi')
      continue
    }

    // Upsert theo slug. Doc chính (không draft) cho biết bản public: đã published → không đụng.
    const existing = await payload.find({
      collection: 'posts',
      where: { slug: { equals: slug } },
      limit: 2,
      depth: 0,
      locale: LOCALE,
      overrideAccess: true,
    })
    if (existing.totalDocs > 1) {
      console.error(`✗ ${file}: ${existing.totalDocs} bài trùng slug ${slug}`)
      failures++
      continue
    }
    let id: number | string
    let action: string
    const current = existing.docs[0]
    if (current && current._status === 'published') {
      console.warn(
        `⚠ ${file}: bài "${slug}" (id ${current.id}) đã PUBLISHED → bỏ qua, không ghi đè`,
      )
      continue
    }
    if (current) {
      // Bản nháp mới nhất (có thể mới hơn doc chính)
      const latest = await payload.findByID({
        collection: 'posts',
        id: current.id,
        draft: true,
        depth: 0,
        locale: LOCALE,
        overrideAccess: true,
      })
      const before = canonical({
        title: latest.title,
        slug: latest.slug,
        excerpt: latest.excerpt,
        content: latest.content,
        categories: (latest.categories ?? []).map(idOf),
        author: idOf(latest.author),
        site: latest.site,
        meta: { title: latest.meta?.title, description: latest.meta?.description },
        _status: latest._status,
      })
      if (JSON.stringify(before) === JSON.stringify(canonical(data))) {
        id = current.id
        action = 'không đổi (bỏ qua)'
      } else {
        const updated = await payload.update({
          collection: 'posts',
          id: current.id,
          data: data as never,
          draft: true,
          locale: LOCALE,
          overrideAccess: true,
          context: { importDrafts: true },
        })
        id = updated.id
        action = 'cập nhật bản nháp'
      }
    } else {
      const created = await payload.create({
        collection: 'posts',
        data: data as never,
        draft: true,
        locale: LOCALE,
        overrideAccess: true,
        context: { importDrafts: true },
      })
      id = created.id
      action = 'tạo mới (draft)'
    }

    report(id, action)
  }

  console.log(failures ? `\nXong, ${failures} bài có vấn đề` : '\nXong, không lỗi')
  process.exit(failures ? 1 : 0)
}

// top-level await: `payload run` thoát ngay khi module import xong
try {
  await run()
} catch (err) {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
}
