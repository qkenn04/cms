import type { CollectionConfig } from 'payload'

import { anyone, isAdmin, isEditorOrAdmin } from '../access'

const webp = { format: 'webp' as const, options: { quality: 80 } }

// File lưu trên Cloudflare R2 (plugin storage-s3 trong payload.config.ts)
export const Media: CollectionConfig = {
  slug: 'media',
  access: {
    read: anyone,
    create: isEditorOrAdmin,
    update: isEditorOrAdmin,
    delete: isAdmin,
  },
  upload: {
    // Không nhận SVG/XML: có thể chứa script
    mimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/avif'],
    focalPoint: true,
    adminThumbnail: 'thumbnail',
    formatOptions: webp,
    // formatOptions ở trên chỉ áp cho ảnh gốc; mỗi size phải khai báo riêng
    imageSizes: [
      { name: 'thumbnail', width: 400, height: 300, position: 'centre', formatOptions: webp },
      { name: 'card', width: 800, withoutEnlargement: true, formatOptions: webp },
      { name: 'hero', width: 1600, withoutEnlargement: true, formatOptions: webp },
      { name: 'og', width: 1200, height: 630, position: 'centre', formatOptions: webp },
    ],
  },
  fields: [
    { name: 'alt', type: 'text', required: true, localized: true },
    { name: 'caption', type: 'text', localized: true },
  ],
}
