import type { CollectionConfig } from 'payload'

import { isEditorOrAdmin, publishedOrLoggedIn } from '../access'
import { slugFrom } from '../hooks/slugify'

export const Posts: CollectionConfig = {
  slug: 'posts',
  admin: {
    useAsTitle: 'title',
    defaultColumns: ['title', 'site', '_status', 'publishedAt', 'updatedAt'],
  },
  versions: {
    drafts: {
      autosave: { interval: 2000 },
      schedulePublish: true,
    },
    maxPerDoc: 30,
  },
  access: {
    read: publishedOrLoggedIn,
    create: isEditorOrAdmin,
    update: isEditorOrAdmin,
    delete: isEditorOrAdmin,
  },
  hooks: {
    beforeChange: [
      // Ghi ngày đăng lần đầu khi bài được publish
      ({ data }) => {
        if (data?._status === 'published' && !data.publishedAt) {
          return { ...data, publishedAt: new Date().toISOString() }
        }
        return data
      },
    ],
  },
  fields: [
    { name: 'title', type: 'text', required: true, localized: true },
    {
      name: 'slug',
      type: 'text',
      unique: true,
      index: true,
      admin: { position: 'sidebar', description: 'Để trống sẽ tự sinh từ tiêu đề' },
      hooks: { beforeValidate: [slugFrom('title')] },
    },
    { name: 'excerpt', type: 'textarea', localized: true, maxLength: 300 },
    { name: 'content', type: 'richText', required: true, localized: true },
    { name: 'coverImage', type: 'upload', relationTo: 'media' },
    { name: 'categories', type: 'relationship', relationTo: 'categories', hasMany: true },
    {
      name: 'author',
      type: 'relationship',
      relationTo: 'users',
      admin: { position: 'sidebar' },
      defaultValue: ({ user }) => user?.id,
    },
    { name: 'publishedAt', type: 'date', admin: { position: 'sidebar' } },
    {
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
