import starlight from '@astrojs/starlight'
import ecTwoSlash from 'expressive-code-twoslash'
import starlightThemeNova from 'starlight-theme-nova'

import { defineConfig } from 'astro/config'

// https://astro.build/config
export default defineConfig({
  integrations: [
    starlight({
      expressiveCode: {
        plugins: [ecTwoSlash()],
      },
      plugins: [
        starlightThemeNova(),
      ],
      sidebar: [
        {
          items: [
            // Each item here is one entry in the navigation menu.
            { label: 'Example Guide', slug: 'guides/example' },
          ],
          label: 'Guides',
        },
        {
          items: [{ autogenerate: { directory: 'reference' } }],
          label: 'Reference',
        },
      ],
      social: [{ href: 'https://github.com/kwaa/three-steam-audio', icon: 'github', label: 'GitHub' }],
      title: 'Three Steam Audio Docs',
    }),
  ],
})
