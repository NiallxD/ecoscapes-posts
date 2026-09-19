// @ts-check
import { defineConfig } from 'astro/config';

import heroes from './tools/hero-integration.mjs';
import swVersion from './tools/sw-version.mjs';

// GitHub Pages project sites live under /<repo>/. Both are read from the env so
// `npm run dev` stays at the root and the deploy workflow supplies the real
// values. Everything that builds a URL goes through src/lib/paths.ts.
const base = process.env.PUBLIC_BASE_PATH || '/';
const site = process.env.PUBLIC_SITE_URL || 'http://localhost:4321';

export default defineConfig({
  site,
  base,
  // Re-renders each location's hero still from its frontmatter, on build and on
  // save in dev. See tools/hero.mjs.
  integrations: [heroes(), swVersion()],
  build: { format: 'directory' },
  // The gyroscope needs a secure context, which a LAN IP is not, so phone
  // testing goes through a cloudflared tunnel. Vite rejects hostnames it was
  // not told about, and quick tunnels get a fresh *.trycloudflare.com name
  // every run.
  server: { allowedHosts: ['.trycloudflare.com'] },
  // The dev toolbar docks to the bottom centre of the screen, which is where the
  // panel arrows now live -- on a phone it sits right on top of them.
  devToolbar: { enabled: false },
});
