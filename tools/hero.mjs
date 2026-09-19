/**
 * Render the full-bleed portrait still that sits behind a location's opening
 * panel, by reprojecting its panorama.
 *
 * Cropping an equirect directly gives a stretched, obviously-wrong image,
 * because the projection compresses horizontally towards the poles. This casts
 * a ray through a pinhole camera aimed at (yaw, pitch) for every output pixel
 * and samples the sphere -- the same thing the panorama viewer does on the GPU.
 * The result reads as an ordinary photograph, and a framing chosen in the
 * viewer is the same framing here.
 *
 * The framing lives in the location's frontmatter under `hero:`, so this is
 * driven by the content rather than by remembered command-line flags. The Astro
 * integration in tools/hero-integration.mjs runs it on build and whenever the
 * markdown changes in dev; `npm run hero [slug]` runs it by hand.
 */
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { load as parseYaml } from 'js-yaml';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LOCATIONS = path.join(ROOT, 'src', 'content', 'locations');
const PUBLIC = path.join(ROOT, 'public');
// Staleness stamps live in Astro's own cache dir, never beside the JPEG: public/
// is copied verbatim into the build, so a stamp there would ship with the site.
const CACHE = path.join(ROOT, '.astro', 'hero');

/** Schema defaults, repeated because this runs outside Astro. */
const DEFAULTS = { yaw: 0, pitch: 0, vfov: 75, width: 1080, height: 1920, quality: 80 };

/** A site-absolute media URL as a path under public/. */
const publicPath = (url) => path.join(PUBLIC, url.replace(/^\//, ''));

/** The YAML block of a location's markdown. */
async function frontmatter(file) {
  const text = await readFile(file, 'utf8');
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) throw new Error(`${path.basename(file)} has no frontmatter block`);
  return parseYaml(m[1]) ?? {};
}

/**
 * Reproject an equirectangular panorama into a rectilinear still.
 *
 * Kept as a plain loop over a raw RGB buffer: at ~2M output pixels this is a
 * few hundred milliseconds, and pulling in a GPU or a native resampler to save
 * that would cost more in dependencies than it returns.
 */
function reproject(eq, EW, EH, { yaw, pitch, vfov, width: W, height: H }) {
  const out = Buffer.allocUnsafe(W * H * 3);
  const focal = H / 2 / Math.tan((vfov * Math.PI) / 180 / 2);
  const p = (pitch * Math.PI) / 180;
  const y = (yaw * Math.PI) / 180;
  const cosP = Math.cos(p);
  const sinP = Math.sin(p);
  const cosY = Math.cos(y);
  const sinY = Math.sin(y);

  for (let j = 0; j < H; j++) {
    const gy = j - (H - 1) / 2;
    // Rotate the ray bundle: pitch about X, then yaw about Y.
    const dy = gy * cosP - focal * sinP;
    const dzP = gy * sinP + focal * cosP;

    for (let i = 0; i < W; i++) {
      const gx = i - (W - 1) / 2;
      const dx = gx * cosY + dzP * sinY;
      const dz = -gx * sinY + dzP * cosY;

      const norm = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const lon = Math.atan2(dx, dz);
      const lat = Math.asin(Math.max(-1, Math.min(1, dy / norm)));

      // Sphere -> equirect pixel coordinates.
      const u = (lon / (2 * Math.PI) + 0.5) * EW - 0.5;
      const v = (lat / Math.PI + 0.5) * EH - 0.5;

      const u0 = Math.floor(u);
      const v0 = Math.max(0, Math.min(EH - 2, Math.floor(v)));
      const fu = u - u0;
      const fv = v - v0;
      // Longitude wraps, so the seam samples correctly with a modulo.
      const u0m = ((u0 % EW) + EW) % EW;
      const u1m = (u0m + 1) % EW;

      const a = (v0 * EW + u0m) * 3;
      const b = (v0 * EW + u1m) * 3;
      const c = ((v0 + 1) * EW + u0m) * 3;
      const d = ((v0 + 1) * EW + u1m) * 3;
      const o = (j * W + i) * 3;

      for (let k = 0; k < 3; k++) {
        const top = eq[a + k] * (1 - fu) + eq[b + k] * fu;
        const bot = eq[c + k] * (1 - fu) + eq[d + k] * fu;
        out[o + k] = (top * (1 - fv) + bot * fv + 0.5) | 0;
      }
    }
  }
  return out;
}

/**
 * Render one location's hero if it is out of date.
 *
 * Staleness is a hash of everything that changes the pixels -- the framing, the
 * output size and the source panorama's own mtime and size -- stored beside the
 * JPEG. An unrelated edit to the markdown therefore costs nothing, which is
 * what makes this safe to run on every dev reload.
 */
export async function renderHero(slug, { force = false } = {}) {
  const data = await frontmatter(path.join(LOCATIONS, `${slug}.md`));
  const hero = data?.hero;
  if (!hero?.src) return { slug, skipped: 'no hero.src' };
  const panoUrl = data?.pano?.src;
  if (!panoUrl) return { slug, skipped: 'no pano.src' };

  const src = publicPath(panoUrl);
  const out = publicPath(hero.src);
  // `hero.yaw` is a compass bearing, like every other angle in the file, but
  // this reprojects straight out of the equirectangular image -- which knows
  // nothing about north. `pano.north` is where north sits on the image's own
  // scale, so adding it converts the bearing back into a position in the
  // source. The viewer does the same thing by turning the sphere.
  const north = Number(data?.pano?.north) || 0;
  const opts = { ...DEFAULTS, ...hero };
  opts.yaw = (((Number(opts.yaw) || 0) + north) % 360 + 360) % 360;

  const srcStat = await stat(src).catch(() => null);
  if (!srcStat) return { slug, skipped: `no panorama at ${path.relative(ROOT, src)}` };

  const stamp = createHash('sha256')
    .update(
      JSON.stringify([
        opts.yaw, opts.pitch, opts.vfov, opts.width, opts.height, opts.quality,
        srcStat.mtimeMs, srcStat.size,
      ]),
    )
    .digest('hex')
    .slice(0, 16);
  const stampFile = path.join(CACHE, `${slug}.stamp`);

  if (!force) {
    const [prev, exists] = await Promise.all([
      readFile(stampFile, 'utf8').catch(() => null),
      stat(out).catch(() => null),
    ]);
    if (prev === stamp && exists) return { slug, unchanged: true };
  }

  const image = sharp(src);
  const { width: EW, height: EH } = await image.metadata();
  const eq = await image.raw().toColourspace('srgb').toBuffer();

  const pixels = reproject(eq, EW, EH, opts);
  await mkdir(path.dirname(out), { recursive: true });
  await sharp(pixels, { raw: { width: opts.width, height: opts.height, channels: 3 } })
    .jpeg({ quality: opts.quality, progressive: true, mozjpeg: true })
    .toFile(out);
  await mkdir(CACHE, { recursive: true });
  await writeFile(stampFile, stamp);

  return { slug, written: path.relative(ROOT, out), ...opts };
}

/** Every location that has a markdown file. */
export async function allSlugs() {
  const files = await readdir(LOCATIONS);
  return files.filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -3));
}

/** Render every location's hero. Never throws: a bad location must not stop a
 *  build or kill the dev server, so failures are reported and stepped over. */
export async function renderAllHeroes({ force = false, log = () => {} } = {}) {
  for (const slug of await allSlugs()) {
    try {
      const r = await renderHero(slug, { force });
      if (r.written) log(`hero ${slug}: yaw=${r.yaw} pitch=${r.pitch} vfov=${r.vfov}`);
      else if (r.skipped) log(`hero ${slug}: skipped (${r.skipped})`);
    } catch (err) {
      log(`hero ${slug}: failed -- ${err.message}`);
    }
  }
}

// `npm run hero` for the whole set, `npm run hero -- <slug>` for one.
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const slugs = args.filter((a) => !a.startsWith('--'));
  const log = (m) => console.log(m);
  if (slugs.length) {
    for (const slug of slugs) {
      const r = await renderHero(slug, { force: true });
      log(r.written ? `${r.written} yaw=${r.yaw} pitch=${r.pitch} vfov=${r.vfov}` : `${slug}: ${r.skipped}`);
    }
  } else {
    await renderAllHeroes({ force, log });
  }
}
