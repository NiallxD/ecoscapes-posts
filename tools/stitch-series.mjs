#!/usr/bin/env node
/**
 * Stitch a folder of yearly TerrAdapt screenshots into the time series clip.
 *
 * TerrAdapt's own export is a square 3D view at one frame a year. This builds
 * the clip from screenshots of the dashboard instead, so the framing is
 * whatever the camera was left on: each screenshot is cropped to the same 4:5
 * window (the map only -- no browser, legend or timeline), held for
 * `--secs` a year, and crossed into the next with a short blurred dissolve.
 *
 * The dissolve is centred on the boundary between two years, so every year
 * still owns exactly `--secs` of the clip and the page's year counter -- which
 * is the position in the clip, floored to a year -- flips halfway through it.
 *
 * Also writes the first year as the poster, and the base layer (the satellite
 * screenshot, same camera) through the same crop, so the two line up.
 *
 * Usage:
 *   node tools/stitch-series.mjs --dir <screenshots> --from 1984 --skip 3 \
 *     --years 41 --base 47 --slug feather-park-01 \
 *     [--crop 1420:1775:1346:495] [--size 1080:1350] [--secs 1.5] [--fade 0.6]
 *     [--blur 5] [--crf 28] [--out <dir>]
 *
 * Screenshots are taken in filename order (macOS names them by time). --skip
 * drops strays at the start; --base is the 1-based index of the base layer.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((out, a, i, all) => (a.startsWith('--') ? [...out, [a.slice(2), all[i + 1]]] : out), []),
);
const need = (k) => {
  if (args[k] === undefined) throw new Error(`missing --${k}`);
  return args[k];
};
const dir = need('dir');
const from = Number(need('from'));
const count = Number(need('years'));
const skip = Number(args.skip ?? 0);
const baseIndex = args.base ? Number(args.base) : null;
const slug = need('slug');
const [cw, ch, cx, cy] = (args.crop ?? '1420:1775:1346:495').split(':').map(Number);
const [W, H] = (args.size ?? '1080:1350').split(':').map(Number);
const SECS = Number(args.secs ?? 1.5); // seconds each year owns
const FADE = Number(args.fade ?? 0.6); // seconds of dissolve, centred on the boundary
const FPS = Number(args.fps ?? 30);
const BLUR = Number(args.blur ?? 5); // px sigma at the middle of a dissolve
const CRF = Number(args.crf ?? 28);

// --out writes somewhere else, for trying settings without touching the site.
const out = args.out ?? join(import.meta.dirname, '..', 'public', 'media', slug);
mkdirSync(out, { recursive: true });

const shots = readdirSync(dir).filter((f) => /\.png$/i.test(f)).sort();
const years = shots.slice(skip, skip + count);
if (years.length !== count) throw new Error(`asked for ${count} years, found ${years.length} after skipping ${skip}`);

/** The map window of one screenshot, at output size. */
const framed = (file) =>
  sharp(join(dir, file)).extract({ left: cx, top: cy, width: cw, height: ch }).resize(W, H).removeAlpha();

console.log(`cropping ${count} years (${from}-${from + count - 1})...`);
const frames = await Promise.all(years.map((f) => framed(f).raw().toBuffer()));

const raw = { raw: { width: W, height: H, channels: 3 } };
const blurred = (buf, sigma) => (sigma < 0.3 ? buf : sharp(buf, raw).blur(sigma).raw().toBuffer());
const ease = (p) => p * p * (3 - 2 * p); // smoothstep: no visible start or stop to the dissolve

const total = Math.round(count * SECS * FPS);
const enc = spawn(
  'ffmpeg',
  [
    '-y', '-loglevel', 'error',
    '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', `${W}x${H}`, '-r', String(FPS), '-i', '-',
    // Main profile and yuv420p for every phone; no audio, so it can autoplay.
    //
    // One keyframe a year, at the end of each dissolve -- the start of that
    // year's hold -- and none anywhere else. A slider stop lands in a hold, so
    // it is never more than a year's worth of near-identical frames from a
    // keyframe; and keyframes are nearly all of this file's weight (a map
    // raster at full detail), so one every half second was 42 MB where this
    // is a fraction of it.
    '-c:v', 'libx264', '-profile:v', 'main', '-pix_fmt', 'yuv420p', '-preset', 'slow',
    '-force_key_frames', `0,${Array.from({ length: count - 1 }, (_, i) => ((i + 1) * SECS + FADE / 2).toFixed(3)).join(',')}`,
    '-g', String(Math.round(SECS * FPS * 2)), '-sc_threshold', '0',
    '-crf', String(CRF), '-movflags', '+faststart', '-an',
    join(out, 'series.mp4'),
  ],
  { stdio: ['pipe', 'inherit', 'inherit'] },
);
const write = (buf) => new Promise((ok) => (enc.stdin.write(buf) ? ok() : enc.stdin.once('drain', ok)));

const mix = Buffer.alloc(W * H * 3);
for (let n = 0; n < total; n++) {
  const t = (n + 0.5) / FPS;
  const k = Math.min(count - 1, Math.floor(t / SECS)); // the year this moment belongs to
  // Nearest boundary, and how far into its dissolve this moment is.
  const b = Math.round(t / SECS);
  const p = (t - (b * SECS - FADE / 2)) / FADE;
  if (b < 1 || b > count - 1 || p <= 0 || p >= 1) {
    await write(frames[k]);
  } else {
    const sigma = BLUR * Math.sin(Math.PI * p);
    const [a, c] = await Promise.all([blurred(frames[b - 1], sigma), blurred(frames[b], sigma)]);
    const w = ease(p);
    for (let i = 0; i < mix.length; i++) mix[i] = a[i] + (c[i] - a[i]) * w;
    await write(mix);
  }
  if (n % 150 === 0) process.stdout.write(`\r  frame ${n}/${total}`);
}
enc.stdin.end();
await new Promise((ok, fail) => enc.on('close', (code) => (code ? fail(new Error(`ffmpeg exited ${code}`)) : ok())));
console.log(`\r  ${total} frames, ${(total / FPS).toFixed(3)}s`);

// The first year: what the panel paints before it plays, and what sits under
// the clip.
await sharp(frames[0], raw).jpeg({ quality: 82, mozjpeg: true }).toFile(join(out, 'series-poster.jpg'));
if (baseIndex) {
  await framed(shots[baseIndex - 1]).jpeg({ quality: 82, mozjpeg: true }).toFile(join(out, 'series-base.jpg'));
}
console.log(`wrote ${out}/series.mp4, series-poster.jpg${baseIndex ? ', series-base.jpg' : ''}`);
console.log(`set series.video: from ${from}, to ${from + count - 1}, duration ${(total / FPS).toFixed(3)}, speed 1`);
