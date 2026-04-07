// @ts-check
import { defineConfig } from 'astro/config';

import tailwindcss from '@tailwindcss/vite';
import sitemap from '@astrojs/sitemap';
import pagefind from 'astro-pagefind';

// https://astro.build/config
export default defineConfig({
  site: 'https://blog.nzrv.dev',
  integrations: [sitemap(), pagefind()],
  vite: {
    plugins: [tailwindcss()]
  }
});
