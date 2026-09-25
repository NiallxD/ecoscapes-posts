/**
 * Stamps the service worker's cache version from the media it will cache.
 *
 * `public/sw.js` names its caches after a VERSION constant, and drops any cache
 * that is not the current one on activate. That is what lets a changed asset
 * reach someone who has already visited: media is served cache-first at a fixed
 * URL, so without a new cache name the old copy is kept forever.
 *
 * The version is a hash of the media's own bytes rather than a build timestamp,
 * so it only moves when the media actually moves. A routine deploy therefore
 * leaves everyone's cached panoramas alone; re-rendering a hero or dropping in
 * a new sphere invalidates them, which is the point. Contents rather than
 * mtimes, because a fresh CI checkout restamps every mtime -- that would throw
 * away every visitor's cache on every deploy.
 *
 * Note this discards the whole cache, not just the changed file -- the cost of
 * keeping the worker this small. If that becomes too blunt, the alternative is
 * content-hashed media filenames.
 */
import { createHash } from 'node:crypto';
import { readFile, writeFile, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Every file under a directory, depth-first, as absolute paths. */
async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else out.push(full);
  }
  return out;
}

export default function swVersion() {
  return {
    name: 'ecoscapes:sw-version',
    hooks: {
      // After the build, so the hero stills rendered this run are included and
      // dist/sw.js exists to be rewritten.
      'astro:build:done': async ({ dir, logger }) => {
        const outDir = fileURLToPath(dir);
        const swFile = path.join(outDir, 'sw.js');

        const source = await readFile(swFile, 'utf8').catch(() => null);
        if (source === null) {
          logger.warn('no sw.js in the build output; cache version not stamped');
          return;
        }

        /** A hash of every file under a directory: paths as well as bytes, so
         *  a rename alone still counts. */
        const digest = async (sub) => {
          const files = (await walk(path.join(outDir, sub))).sort();
          const hash = createHash('sha256');
          for (const file of files) {
            hash.update(path.relative(outDir, file));
            hash.update(await readFile(file));
          }
          return { files, hex: hash.digest('hex').slice(0, 12) };
        };
        const media = await digest('media');
        // The map's tiles on their own: a new basemap should not cost anyone
        // their cached photographs and clips, nor a new clip their map.
        // With the map files on R2 (PUBLIC_TILES_BASE), what is up there is
        // what tools/upload-tiles.sh last wrote down in its manifest.
        const tilesBase = (process.env.PUBLIC_TILES_BASE ?? '').replace(/\/$/, '');
        const tiles = tilesBase
          ? await readFile('tools/tiles-manifest.json').then((b) => ({
              files: Object.keys(JSON.parse(b)),
              hex: createHash('sha256').update(b).digest('hex').slice(0, 12),
            }))
          : await digest('tiles');
        const version = `v${media.hex}`;
        const files = media.files;

        const stamped = source
          .replace(/const VERSION = '[^']*';/, `const VERSION = '${version}';`)
          .replace(/const TILES_VERSION = '[^']*';/, `const TILES_VERSION = 't${tiles.hex}';`)
          .replace(/const TILES_ORIGIN = '[^']*';/, `const TILES_ORIGIN = '${tilesBase ? new URL(tilesBase).origin : ''}';`);
        if (stamped === source) {
          logger.warn('could not find VERSION in sw.js; cache version not stamped');
          return;
        }

        await writeFile(swFile, stamped);
        // The map files are on the tile host: none of them in the site itself.
        if (tilesBase) {
          const maps = (await walk(path.join(outDir, 'tiles'))).filter((f) => /\.pmtiles$|\.sample\.webp$/.test(f));
          await Promise.all(maps.map((f) => rm(f)));
          logger.info(`map files from ${tilesBase}: ${maps.length} left out of the build`);
        }
        logger.info(`cache version ${version} (${files.length} media files), tiles t${tiles.hex} (${tiles.files.length} files)`);
      },
    },
  };
}
