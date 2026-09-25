import type { SerializedUploadNode } from '@payloadcms/richtext-lexical'
import type { HTMLConvertersFunctionAsync } from '@payloadcms/richtext-lexical/html-async'

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

export const htmlConverters: HTMLConvertersFunctionAsync = ({ defaultConverters }) => ({
  ...defaultConverters,
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
