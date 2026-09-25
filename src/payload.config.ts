import { postgresAdapter } from '@payloadcms/db-postgres'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import path from 'path'
import { buildConfig } from 'payload'
import { fileURLToPath } from 'url'
import sharp from 'sharp'

import { seoPlugin } from '@payloadcms/plugin-seo'

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
    seoPlugin({
      collections: ['posts'],
      uploadsCollection: 'media',
      tabbedUI: true,
      generateTitle: ({ doc }) => (doc?.title ? `${doc.title} | qkenn` : 'qkenn'),
      generateDescription: ({ doc }) => doc?.excerpt ?? '',
    }),
  ],
})
