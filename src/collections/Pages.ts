import type { CodeField, CollectionConfig } from 'payload'
import { lexicalHTMLField } from '@payloadcms/richtext-lexical'

import { isEditorOrAdmin, publishedOrLoggedIn } from '../access'
import { htmlConverters } from '../lexical/htmlConverters'
import { slugFrom, validateSlug } from '../hooks/slugify'
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
    // Publish / unpublish / xoá trang public → GitHub workflow_dispatch → build lại site tĩnh
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
      hooks: { beforeValidate: [slugFrom('title', 'trang')] },
      // Cùng quy tắc với posts: slug toàn chữ số dễ trùng route phân trang (/blog/N)
      validate: validateSlug,
    },
    { name: 'content', type: 'richText', required: true, localized: true },
    // HTML sinh từ `content` mỗi lần đọc — site Astro render thẳng.
    // virtual: không tạo cột DB (storeInDB: false của lexicalHTMLField vẫn tạo cột rỗng)
    // converters: ảnh chèn trong bài → 1 <img> lazy + srcset cùng tỉ lệ (src/lexical/htmlConverters.ts)
    {
      ...(lexicalHTMLField({
        lexicalFieldName: 'content',
        htmlFieldName: 'contentHtml',
        converters: htmlConverters,
      }) as CodeField),
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
        { label: 'Site khác (dự phòng)', value: 'other' },
      ],
      admin: { position: 'sidebar' },
    },
  ],
}
