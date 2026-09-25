import type { GlobalConfig } from 'payload'

import { anyone, isAdmin } from '../access'

export const SiteSettings: GlobalConfig = {
  slug: 'site-settings',
  access: {
    read: anyone,
    update: isAdmin,
  },
  versions: { max: 20 },
  fields: [
    { name: 'siteName', type: 'text', required: true, defaultValue: 'qkenn' },
    { name: 'tagline', type: 'text', localized: true },
    { name: 'description', type: 'textarea', localized: true, maxLength: 300 },
    {
      name: 'nav',
      type: 'array',
      fields: [
        { name: 'label', type: 'text', required: true, localized: true },
        { name: 'href', type: 'text', required: true },
      ],
    },
    {
      name: 'socials',
      type: 'array',
      fields: [
        {
          name: 'platform',
          type: 'select',
          required: true,
          options: ['github', 'linkedin', 'facebook', 'x', 'email'],
        },
        { name: 'url', type: 'text', required: true },
      ],
    },
    { name: 'footerText', type: 'text', localized: true },
  ],
}
