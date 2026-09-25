import type { CodeField, CollectionConfig } from 'payload'
import { lexicalHTMLField } from '@payloadcms/richtext-lexical'

import { isEditorOrAdmin, publishedOrLoggedIn } from '../access'
import { slugFrom } from '../hooks/slugify'
import { rebuildSiteAfterChange, rebuildSiteAfterDelete } from '../hooks/triggerSiteRebuild'

// Trang tĩnh (About, ...) của site; site Astro lấy theo slug cố định
export const Pages: CollectionConfig = {
  slug: 'pages',
  admin: {
    useAsTitle: 'title',
    defaultColumns: ['title', 'slug', '_status', 'updatedAt'],
  },
  versions: {
    drafts: {
      autosave: { interval: 2000 },
    },
    maxPerDoc: 20,
  },
  access: {
    read: publishedOrLoggedIn,
    create: isEditorOrAdmin,
    update: isEditorOrAdmin,
    delete: isEditorOrAdmin,
  },
  hooks: {
    // Publish / unpublish / xoá trang public → GitHub repository_dispatch → build lại site tĩnh
    afterChange: [rebuildSiteAfterChange],
    afterDelete: [rebuildSiteAfterDelete],
  },
  fields: [
    { name: 'title', type: 'text', required: true, localized: true },
    {
      // Không localized: vi và en dùng chung 1 slug (vd /about và /en/about)
      name: 'slug',
      type: 'text',
      unique: true,
      index: true,
      admin: { position: 'sidebar', description: 'Slug cố định, vd about' },
      hooks: { beforeValidate: [slugFrom('title')] },
    },
    { name: 'content', type: 'richText', required: true, localized: true },
    // HTML sinh từ `content` mỗi lần đọc — site Astro render thẳng.
    // virtual: không tạo cột DB (storeInDB: false của lexicalHTMLField vẫn tạo cột rỗng)
    {
      ...(lexicalHTMLField({ lexicalFieldName: 'content', htmlFieldName: 'contentHtml' }) as CodeField),
      virtual: true,
    },
    {
      // Hook rebuild dispatch sang repo của từng site
      name: 'site',
      type: 'select',
      required: true,
      defaultValue: 'qkenn',
      index: true,
      options: [
        { label: 'qkenn.cloud', value: 'qkenn' },
        { label: 'nail_website', value: 'nail' },
      ],
      admin: { position: 'sidebar' },
    },
  ],
}
