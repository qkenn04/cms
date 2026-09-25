import { postgresAdapter } from '@payloadcms/db-postgres'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import path from 'path'
import { buildConfig } from 'payload'
import { fileURLToPath } from 'url'
import sharp from 'sharp'

import { seoPlugin } from '@payloadcms/plugin-seo'
import { s3Storage } from '@payloadcms/storage-s3'

import { Categories } from './collections/Categories'
import { Media } from './collections/Media'
import { Posts } from './collections/Posts'
import { Users } from './collections/Users'
import { SiteSettings } from './globals/SiteSettings'
import { migrations } from './migrations'

const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)

const serverURL = process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:3000'
const origins = [serverURL, ...(process.env.CORS_ORIGINS || '').split(',').filter(Boolean)]

// Có R2_PUBLIC_URL (custom domain của bucket) thì ảnh serve thẳng từ CDN;
// chưa có thì Payload đọc từ R2 và trả qua /api/media/file/*
const r2PublicURL = process.env.R2_PUBLIC_URL?.replace(/\/$/, '')

export default buildConfig({
  serverURL,
  cors: origins,
  csrf: origins,
  admin: {
    user: Users.slug,
    importMap: {
      baseDir: path.resolve(dirname),
    },
  },
  collections: [Posts, Categories, Media, Users],
  globals: [SiteSettings],
  // Song ngữ từ ngày 1: đổi `localized` trên field đã có dữ liệu sẽ mất dữ liệu field đó
  localization: {
    locales: [
      { label: 'Tiếng Việt', code: 'vi' },
      { label: 'English', code: 'en' },
    ],
    defaultLocale: 'vi',
    fallback: true,
  },
  editor: lexicalEditor(),
  secret: process.env.PAYLOAD_SECRET || '',
  typescript: {
    outputFile: path.resolve(dirname, 'payload-types.ts'),
  },
  db: postgresAdapter({
    pool: {
      connectionString: process.env.DATABASE_URL || '',
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    },
    // Không dùng push: mọi thay đổi schema đi qua migration commit vào git
    push: false,
    migrationDir: path.resolve(dirname, 'migrations'),
    // Production (NODE_ENV=production) tự chạy migration pending lúc khởi động
    prodMigrations: migrations,
  }),
  // Job queue: chạy scheduled publish. autoRun chỉ khởi động sau getPayload({ cron: true })
  // (xem src/instrumentation.ts); host cron gọi /api/payload-jobs/run bằng CRON_SECRET làm dự phòng
  jobs: {
    autoRun: [{ cron: '* * * * *', queue: 'default', limit: 10 }],
    access: {
      run: ({ req }) => {
        if (req.user) return true
        const secret = process.env.CRON_SECRET
        return Boolean(secret) && req.headers.get('authorization') === `Bearer ${secret}`
      },
    },
  },
  endpoints: [
    {
      path: '/health',
      method: 'get',
      handler: async (req) => {
        try {
          await req.payload.count({ collection: 'users', overrideAccess: true })
          return Response.json({ status: 'ok' })
        } catch {
          return Response.json({ status: 'db_down' }, { status: 503 })
        }
      },
    },
  ],
  sharp,
  plugins: [
    s3Storage({
      // Không cấu hình R2 (vd CI build) thì giữ lưu local
      enabled: Boolean(process.env.R2_BUCKET),
      collections: {
        media: r2PublicURL
          ? {
              prefix: 'qkenn',
              disablePayloadAccessControl: true,
              generateFileURL: ({ filename, prefix }) => `${r2PublicURL}/${prefix}/${filename}`,
            }
          : { prefix: 'qkenn' },
      },
      bucket: process.env.R2_BUCKET || '',
      config: {
        credentials: {
          accessKeyId: process.env.R2_ACCESS_KEY_ID || '',
          secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || '',
        },
        region: 'auto',
        endpoint: process.env.R2_ENDPOINT,
        forcePathStyle: true,
      },
    }),
    seoPlugin({
      collections: ['posts'],
      uploadsCollection: 'media',
      tabbedUI: true,
      generateTitle: ({ doc }) => (doc?.title ? `${doc.title} | qkenn` : 'qkenn'),
      generateDescription: ({ doc }) => doc?.excerpt ?? '',
    }),
  ],
})
