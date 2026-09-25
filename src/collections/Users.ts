import type { CollectionConfig } from 'payload'

import { adminOrSelf, canUseAdminPanel, isAdmin, isAdminField } from '../access'

export const Users: CollectionConfig = {
  slug: 'users',
  admin: {
    useAsTitle: 'email',
    defaultColumns: ['email', 'name', 'roles'],
  },
  auth: {
    useAPIKey: true,
    maxLoginAttempts: 5,
    lockTime: 10 * 60 * 1000,
    tokenExpiration: 8 * 60 * 60,
    cookies: {
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'Lax',
    },
  },
  access: {
    admin: canUseAdminPanel,
    read: adminOrSelf,
    create: isAdmin,
    update: adminOrSelf,
    delete: isAdmin,
  },
  hooks: {
    beforeChange: [
      // Tài khoản đầu tiên (màn "create first user") luôn là admin
      async ({ data, operation, req }) => {
        if (operation !== 'create') return data
        const { totalDocs } = await req.payload.count({ collection: 'users', overrideAccess: true })
        if (totalDocs === 0) return { ...data, roles: ['admin'] }
        return data
      },
    ],
  },
  fields: [
    { name: 'name', type: 'text' },
    {
      name: 'roles',
      type: 'select',
      hasMany: true,
      required: true,
      defaultValue: ['editor'],
      saveToJWT: true,
      options: [
        { label: 'Admin', value: 'admin' },
        { label: 'Editor', value: 'editor' },
        { label: 'Service (API key)', value: 'service' },
      ],
      // Editor không tự nâng quyền của mình
      access: { create: isAdminField, update: isAdminField },
    },
  ],
}
