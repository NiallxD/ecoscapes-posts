/**
 * Keeps every location's hero still in step with its frontmatter.
 *
 * The hero is a baked JPEG rather than something the page reprojects, because
 * it is the opening panel's full-bleed background and must paint before the
 * panorama is downloaded. That baking now happens here instead of by hand: the
 * angles under `hero:` are the source of truth, and editing them regenerates
 * the file on the next build or, in dev, on save.
 *
 * Rendering is skipped unless the framing or the panorama actually changed, so
 * this costs a stat and a hash on a normal reload. See tools/hero.mjs.
 */
import { renderAllHeroes } from './hero.mjs';

export default function heroes() {
  return {
    name: 'ecoscapes:heroes',
    hooks: {
      // Before the build reads public/, so a changed framing ships in the same
      // run rather than the one after it.
      'astro:build:start': async ({ logger }) => {
        await renderAllHeroes({ log: (m) => logger.info(m) });
      },

      'astro:server:setup': async ({ server, logger }) => {
        await renderAllHeroes({ log: (m) => logger.info(m) });

        // Editing a location's angles re-renders its still. The page reloads
        // anyway because the markdown is content, so the new JPEG is picked up
        // without a second signal -- as long as it is written first, which is
        // why this awaits before letting the reload through.
        const onChange = async (file) => {
          if (!file.includes('/src/content/locations/') || !file.endsWith('.md')) return;
          await renderAllHeroes({ log: (m) => logger.info(m) });
        };
        server.watcher.on('change', onChange);
        server.watcher.on('add', onChange);
      },
    },
  };
}
