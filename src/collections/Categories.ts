import type { CollectionConfig } from 'payload'

import { anyone, isAdmin, isEditorOrAdmin } from '../access'
import { slugFrom } from '../hooks/slugify'

export const Categories: CollectionConfig = {
  slug: 'categories',
  admin: {
    useAsTitle: 'title',
    defaultColumns: ['title', 'slug'],
  },
  access: {
    read: anyone,
    create: isEditorOrAdmin,
    update: isEditorOrAdmin,
    delete: isAdmin,
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
  ],
}
