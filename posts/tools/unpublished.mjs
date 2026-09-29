/**
 * A post marked `published: false` is left out of the build's pages by
 * shared/lib/posts.ts; this takes its media folder out of the built site too,
 * since everything under public/ is copied across whether a page uses it or not.
 */
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { allSlugs, frontmatter } from './hero.mjs';

const LOCATIONS = fileURLToPath(new URL('../content/', import.meta.url));

export default function unpublished() {
  return {
    name: 'ecoscapes:unpublished',
    hooks: {
      'astro:build:done': async ({ dir, logger }) => {
        for (const slug of await allSlugs()) {
          const data = await frontmatter(path.join(LOCATIONS, `${slug}.md`));
          if (data.published !== false) continue;
          await rm(new URL(`media/${slug}/`, dir), { recursive: true, force: true });
          logger.info(`${slug}: unpublished, left out`);
        }
      },
    },
  };
}
