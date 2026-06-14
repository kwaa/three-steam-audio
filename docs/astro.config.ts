import starlight from '@astrojs/starlight'
import ecTwoSlash from 'expressive-code-twoslash'
import starlightThemeNova from 'starlight-theme-nova'

import { defineConfig } from 'astro/config'

// https://astro.build/config
export default defineConfig({
  integrations: [
    starlight({
      expressiveCode: {
        plugins: [
          ecTwoSlash({
            twoslashOptions: {
              compilerOptions: {
                jsx: 4,
              },
            },
          }),
        ],
      },
      plugins: [
        starlightThemeNova(),
      ],
      sidebar: [
        { label: 'Getting Started', slug: 'getting-started' },
        {
          items: [{ autogenerate: { directory: 'guides' } }],
          label: 'Guides',
        },
        {
          items: [{ autogenerate: { directory: 'reference' } }],
          label: 'Reference',
        },
        { label: 'Build Instructions', slug: 'build-instructions' },
      ],
      social: [{ href: 'https://github.com/kwaa/three-steam-audio', icon: 'github', label: 'GitHub' }],
      title: 'Three Steam Audio Docs',
    }),
  ],
})
