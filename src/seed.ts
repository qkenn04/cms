// Dữ liệu mẫu cho dev. Chạy: pnpm payload run src/seed.ts  (idempotent — chạy lại không tạo trùng)
import { getPayload } from 'payload'

import config from './payload.config'

// Mỗi chuỗi truyền vào là 1 đoạn văn
const paragraph = (...texts: string[]) => ({
  root: {
    type: 'root',
    format: '' as const,
    indent: 0,
    version: 1,
    direction: 'ltr' as const,
    children: texts.map((text) => ({
      type: 'paragraph',
      format: '' as const,
      indent: 0,
      version: 1,
      direction: 'ltr' as const,
      textFormat: 0,
      children: [{ type: 'text', text, format: 0, detail: 0, mode: 'normal', style: '', version: 1 }],
    })),
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

// Nội dung tạm — chủ site thay trong admin
const pages = [
  {
    slug: 'about',
    vi: {
      title: 'Giới thiệu',
      body: [
        'Xin chào! Tôi là một kỹ sư phần mềm và là người đứng sau qkenn.cloud — nơi tôi ghi lại những gì học được khi xây dựng hệ thống web.',
        'Công việc của tôi xoay quanh việc thiết kế và xây dựng các hệ thống web: backend, cơ sở dữ liệu và hạ tầng để triển khai chúng. Mọi dịch vụ của qkenn.cloud đều được tự host trên một VPS riêng.',
        '(Đây là nội dung tạm — phần giới thiệu này sẽ được cập nhật trong CMS.)',
      ],
    },
    en: {
      title: 'About',
      body: [
        "Hi! I'm a software engineer and the person behind qkenn.cloud, where I write down what I learn while building web systems.",
        'My work revolves around designing and building web systems: backends, databases and the infrastructure to deploy them. Every service on qkenn.cloud is self-hosted on a VPS.',
        '(This is placeholder content — this introduction will be updated in the CMS.)',
      ],
    },
  },
]

const payload = await getPayload({ config })

const catIds: Record<string, number> = {}
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

for (const pg of pages) {
  const existing = await payload.find({
    collection: 'pages',
    where: { slug: { equals: pg.slug } },
    limit: 1,
    draft: true,
  })
  if (existing.docs[0]) {
    payload.logger.info(`bỏ qua (đã có): pages/${pg.slug}`)
    continue
  }
  const doc = await payload.create({
    collection: 'pages',
    locale: 'vi',
    data: {
      title: pg.vi.title,
      slug: pg.slug,
      content: paragraph(...pg.vi.body),
      site: 'qkenn',
      _status: 'published',
    },
  })
  await payload.update({
    collection: 'pages',
    id: doc.id,
    locale: 'en',
    data: { title: pg.en.title, content: paragraph(...pg.en.body), _status: 'published' },
  })
  payload.logger.info(`tạo: pages/${pg.slug} (published)`)
}

process.exit(0)
