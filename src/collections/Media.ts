import type { CollectionConfig } from 'payload'

import { anyone, isAdmin, isEditorOrAdmin } from '../access'

// Tạm lưu local (./media); chuyển sang R2 bằng @payloadcms/storage-s3 khi có bucket
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
    formatOptions: { format: 'webp', options: { quality: 80 } },
    imageSizes: [
      { name: 'thumbnail', width: 400, height: 300, position: 'centre' },
      { name: 'card', width: 800, withoutEnlargement: true },
      { name: 'hero', width: 1600, withoutEnlargement: true },
      { name: 'og', width: 1200, height: 630, position: 'centre' },
    ],
  },
  fields: [
    { name: 'alt', type: 'text', required: true, localized: true },
    { name: 'caption', type: 'text', localized: true },
  ],
}
