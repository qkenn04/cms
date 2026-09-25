import type {
  SerializedBlockNode,
  SerializedTableCellNode,
  SerializedTableNode,
  SerializedTableRowNode,
  SerializedUploadNode,
} from '@payloadcms/richtext-lexical'
import type {
  HTMLConverterAsync,
  HTMLConvertersFunctionAsync,
} from '@payloadcms/richtext-lexical/html-async'

import type { Media } from '../payload-types'

// Converter Lexical → HTML dùng chung cho contentHtml của posts và pages.
// Ảnh upload chèn trong bài: 1 thẻ <img> (không <picture>/<source> theo max-width như converter mặc định),
// src là ảnh gốc, srcset chỉ gồm các size CÙNG tỉ lệ — cùng logic buildSrcset của site (src/components/media.ts).

type ImageSize = { url: string; width: number; height: number }
type SizeLike =
  { url?: string | null; width?: number | null; height?: number | null } | null | undefined

// Cột nội dung bài trên site (khớp `sizes` ảnh bìa trong PostView.astro của qkenn-site)
const CONTENT_SIZES = '(min-width: 46rem) 43rem, 100vw'

const escapeAttr = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

// Dấu cách / dấu phẩy trong URL làm vỡ cú pháp srcset
const srcsetUrl = (url: string): string => url.replace(/ /g, '%20').replace(/,/g, '%2C')

const isUsable = (size: SizeLike): size is ImageSize =>
  !!size && !!size.url && (size.width ?? 0) > 0 && (size.height ?? 0) > 0

const original = (media: Media): ImageSize | null => {
  const size = { url: media.url, width: media.width, height: media.height }
  return isUsable(size) ? size : null
}

/**
 * srcset từ các size có CÙNG tỉ lệ khung với ảnh chính (lệch < 1%):
 * thumbnail 4:3, og 1.91:1 bị loại khi ảnh gốc 16:9 — trộn tỉ lệ làm méo/cắt sai.
 * Ít hơn 2 ứng viên → không cần srcset.
 */
export const buildSrcset = (media: Media, primary: ImageSize): string | undefined => {
  const ratio = primary.width / primary.height
  const s = media.sizes ?? {}
  const candidates = [s.thumbnail, s.card, s.hero, s.og, original(media)]
    .filter(isUsable)
    .filter((c) => Math.abs(c.width / c.height - ratio) / ratio < 0.01)
  const byWidth = new Map<number, ImageSize>()
  for (const c of candidates) if (!byWidth.has(c.width)) byWidth.set(c.width, c)
  const list = [...byWidth.values()].sort((a, b) => a.width - b.width)
  if (list.length < 2) return undefined
  return list.map((c) => `${srcsetUrl(c.url)} ${c.width}w`).join(', ')
}

/** HTML cho 1 media doc chèn trong nội dung; '' khi thiếu dữ liệu */
export const uploadToHTML = (
  media: Media,
  { alt, styleTag = '' }: { alt?: string; styleTag?: string } = {},
): string => {
  const url = media.url ?? ''
  if (!url) return ''
  // Media chỉ nhận ảnh, nhưng giữ đường lui như converter mặc định: file khác → link tải
  if (!media.mimeType?.startsWith('image')) {
    return `<a${styleTag} href="${escapeAttr(url)}" rel="noopener noreferrer">${escapeAttr(media.filename ?? '')}</a>`
  }
  const attrs = [`src="${escapeAttr(url)}"`, `alt="${escapeAttr(alt || media.alt || '')}"`]
  const primary = original(media)
  if (primary) {
    attrs.push(`width="${primary.width}"`, `height="${primary.height}"`)
    const srcset = buildSrcset(media, primary)
    if (srcset) attrs.push(`srcset="${escapeAttr(srcset)}"`, `sizes="${CONTENT_SIZES}"`)
  }
  attrs.push('loading="lazy"', 'decoding="async"')
  return `<img${styleTag} ${attrs.join(' ')} />`
}

// ---------- Code block (CodeBlock của richtext-lexical, block slug 'Code', fields language + code) ----------

/** Escape nội dung text: & < > " ' */
export const escapeHTML = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')

/** Tên ngôn ngữ cho class `language-*`: chỉ giữ [a-z0-9+#-]; rỗng → 'text' */
export const sanitizeCodeLanguage = (language: unknown): string => {
  const clean = (typeof language === 'string' ? language : '')
    .toLowerCase()
    .replace(/[^a-z0-9+#-]/g, '')
  return clean || 'text'
}

/** `<pre><code class="language-x">` — giữ nguyên mọi khoảng trắng/xuống dòng của code */
export const codeBlockToHTML = ({
  code,
  language,
}: {
  code?: unknown
  language?: unknown
}): string =>
  `<pre><code class="language-${sanitizeCodeLanguage(language)}">${escapeHTML(
    typeof code === 'string' ? code : '',
  )}</code></pre>`

type CodeBlockFields = {
  blockType: 'Code'
  blockName?: string | null
  code?: string
  language?: string
}

const codeBlockConverter: HTMLConverterAsync<SerializedBlockNode<CodeBlockFields>> = ({ node }) =>
  codeBlockToHTML(node.fields ?? {})

// ---------- Bảng (EXPERIMENTAL_TableFeature) ----------
// Converter mặc định: mọi hàng trong <tbody>, style inline (border #ccc…). Ở đây: HTML ngữ nghĩa,
// các hàng header ở đầu bảng (headerState có bit ROW) vào <thead>, style để CSS của site lo.
// Bọc <div class="table-wrap"> để site cho cuộn ngang trên màn hình hẹp.

type LooseNode = { type: string; children?: LooseNode[]; [key: string]: unknown }

const HEADER_ROW = 1 // TableCellHeaderStates.ROW (@lexical/table); BOTH = 3 cũng có bit này
const HEADER_COLUMN = 2 // TableCellHeaderStates.COLUMN

const cellsOf = (row: SerializedTableRowNode): SerializedTableCellNode[] =>
  (row.children ?? []).filter((c): c is SerializedTableCellNode => c?.type === 'tablecell')

const rowsOf = (table: SerializedTableNode): SerializedTableRowNode[] =>
  (table.children ?? []).filter((r): r is SerializedTableRowNode => r?.type === 'tablerow')

const isHeaderRow = (row: SerializedTableRowNode): boolean => {
  const cells = cellsOf(row)
  return cells.length > 0 && cells.every((c) => ((c.headerState ?? 0) & HEADER_ROW) === HEADER_ROW)
}

const spanAttr = (name: 'colspan' | 'rowspan', value: unknown): string =>
  typeof value === 'number' && Number.isInteger(value) && value > 1 ? ` ${name}="${value}"` : ''

const tableConverter: HTMLConverterAsync<SerializedTableNode> = async ({
  node,
  nodesToHTML,
  parent,
}) => {
  const rows = rowsOf(node)
  let headCount = 0
  while (headCount < rows.length && isHeaderRow(rows[headCount])) headCount++
  // Bảng chỉ toàn hàng header → vẫn để hàng đó trong thead, tbody rỗng thì bỏ

  const tableParent = { ...node, parent }
  const renderRow = async (row: SerializedTableRowNode, inHead: boolean): Promise<string> => {
    const rowParent = { ...row, parent: tableParent }
    const cells: string[] = []
    for (const cell of cellsOf(row)) {
      const header = inHead || ((cell.headerState ?? 0) & (HEADER_ROW | HEADER_COLUMN)) !== 0
      const tag = header ? 'th' : 'td'
      const scope = inHead ? ' scope="col"' : header ? ' scope="row"' : ''
      // Ô chỉ có 1 paragraph (trường hợp thường gặp, vd import từ markdown) → bỏ <p> bọc ngoài
      const cellParent = { ...cell, parent: rowParent }
      const children = cell.children ?? []
      const only = children.length === 1 ? (children[0] as LooseNode) : null
      const inner =
        only?.type === 'paragraph'
          ? await nodesToHTML({
              nodes: (only.children ?? []) as never,
              parent: { ...only, parent: cellParent } as never,
            })
          : await nodesToHTML({ nodes: children, parent: cellParent as never })
      cells.push(
        `<${tag}${scope}${spanAttr('colspan', cell.colSpan)}${spanAttr('rowspan', cell.rowSpan)}>${inner.join('')}</${tag}>`,
      )
    }
    return `<tr>${cells.join('')}</tr>`
  }

  const head: string[] = []
  const body: string[] = []
  for (let i = 0; i < rows.length; i++) {
    const inHead = i < headCount
    ;(inHead ? head : body).push(await renderRow(rows[i], inHead))
  }
  return (
    '<div class="table-wrap"><table>' +
    (head.length ? `<thead>${head.join('')}</thead>` : '') +
    (body.length ? `<tbody>${body.join('')}</tbody>` : '') +
    '</table></div>'
  )
}

export const htmlConverters: HTMLConvertersFunctionAsync = ({ defaultConverters }) => ({
  ...defaultConverters,
  table: tableConverter,
  blocks: {
    ...(defaultConverters.blocks ?? {}),
    Code: codeBlockConverter,
  },
  upload: async ({ node, populate, providedStyleTag }) => {
    const uploadNode: SerializedUploadNode = node
    // Chưa populate (vd depth thấp) → tự lấy doc; không lấy được thì bỏ ảnh
    const doc =
      typeof uploadNode.value === 'object'
        ? uploadNode.value
        : await populate?.({ id: uploadNode.value, collectionSlug: uploadNode.relationTo })
    if (!doc) return ''
    // alt riêng của node (nếu upload feature có field alt) ưu tiên hơn alt của media, như converter mặc định
    const alt = typeof uploadNode.fields?.alt === 'string' ? uploadNode.fields.alt : undefined
    return uploadToHTML(doc as Media, { alt, styleTag: providedStyleTag })
  },
})
