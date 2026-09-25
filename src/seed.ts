// Dữ liệu mẫu cho dev. Chạy: pnpm payload run src/seed.ts  (idempotent — chạy lại không tạo trùng)
import { getPayload } from 'payload'

import config from './payload.config'

const paragraph = (text: string) => ({
  root: {
    type: 'root',
    format: '' as const,
    indent: 0,
    version: 1,
    direction: 'ltr' as const,
    children: [
      {
        type: 'paragraph',
        format: '' as const,
        indent: 0,
        version: 1,
        direction: 'ltr' as const,
        textFormat: 0,
        children: [{ type: 'text', text, format: 0, detail: 0, mode: 'normal', style: '', version: 1 }],
      },
    ],
  },
})

const categories = [
  { slug: 'ky-thuat', vi: 'Kỹ thuật', en: 'Engineering' },
  { slug: 'ghi-chep', vi: 'Ghi chép', en: 'Notes' },
]

const posts = [
  {
    slug: 'xin-chao',
    status: 'published' as const,
    category: 'ghi-chep',
    vi: { title: 'Xin chào', excerpt: 'Bài viết đầu tiên trên blog.', body: 'Đây là bài viết mẫu tiếng Việt.' },
    en: { title: 'Hello', excerpt: 'The first post on the blog.', body: 'This is a sample English post.' },
  },
  {
    slug: 'dung-cms-voi-payload',
    status: 'published' as const,
    category: 'ky-thuat',
    vi: { title: 'Dựng CMS với Payload', excerpt: 'Ghi chép khi dựng CMS.', body: 'Payload chạy trong Next.js.' },
    en: null, // chưa dịch → API ?locale=en trả bản vi (fallback)
  },
  {
    slug: 'ban-nhap',
    status: 'draft' as const,
    category: 'ghi-chep',
    vi: { title: 'Bản nháp', excerpt: 'Không được lộ ra public.', body: 'Nội dung nháp.' },
    en: null,
  },
]

const payload = await getPayload({ config })

const catIds: Record<string, number | string> = {}
for (const c of categories) {
  const existing = await payload.find({ collection: 'categories', where: { slug: { equals: c.slug } }, limit: 1 })
  const doc =
    existing.docs[0] ??
    (await payload.create({ collection: 'categories', locale: 'vi', data: { title: c.vi, slug: c.slug } }))
  await payload.update({ collection: 'categories', id: doc.id, locale: 'en', data: { title: c.en } })
  catIds[c.slug] = doc.id
}

for (const p of posts) {
  const existing = await payload.find({
    collection: 'posts',
    where: { slug: { equals: p.slug } },
    limit: 1,
    draft: true,
  })
  if (existing.docs[0]) {
    payload.logger.info(`bỏ qua (đã có): ${p.slug}`)
    continue
  }
  const doc = await payload.create({
    collection: 'posts',
    locale: 'vi',
    draft: p.status === 'draft',
    data: {
      title: p.vi.title,
      slug: p.slug,
      excerpt: p.vi.excerpt,
      content: paragraph(p.vi.body),
      categories: [catIds[p.category]],
      site: 'qkenn',
      _status: p.status,
    },
  })
  if (p.en) {
    await payload.update({
      collection: 'posts',
      id: doc.id,
      locale: 'en',
      data: { title: p.en.title, excerpt: p.en.excerpt, content: paragraph(p.en.body), _status: p.status },
    })
  }
  payload.logger.info(`tạo: ${p.slug} (${p.status})`)
}

process.exit(0)
