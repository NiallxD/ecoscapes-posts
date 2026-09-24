#!/usr/bin/env node
/**
 * Screenshot a TerrAdapt dashboard view once a year, then once bare.
 *
 * Opens the dashboard URL in a headless browser on Google Satellite, steps the
 * timeline's current-year handle through every year from the start of the
 * range to the end -- as a keyboard user would, so the app reacts exactly as
 * it does to a drag -- and screenshots the map at each, once the year has
 * landed and its tiles have loaded. Then it reloads the same camera with the
 * layer's opacity at 0 and any overlay taken off, and screenshots the bare
 * satellite: the base layer tools/stitch-series.mjs lines the years up with.
 *
 * The screenshots are of the map alone: everything the dashboard draws over it
 * (header, legend, timeline, buttons) is hidden for the capture. --keep-ui
 * leaves it in.
 *
 * Overlays you upload belong to your TerrAdapt account, so a headless browser
 * that is not logged in does not see them. Log in once with --login: a real
 * browser window opens, you log in, press Enter here, and the session is kept
 * in tools/.terradapt-auth.json (git-ignored) for every run after.
 *
 * Usage:
 *   node tools/capture-terradapt.mjs --login '<dashboard url>'
 *   node tools/capture-terradapt.mjs '<dashboard url>' [--out <dir>]
 *     [--years 1984-2024] [--size 1600x1000] [--scale 2] [--settle 1500]
 *     [--keep-ui]
 *
 * --years takes part of the range (a quick test, or redoing a few); the
 * default is the whole range the dashboard's timeline is set to.
 *
 * Writes <out>/1984.png ... <out>/2024.png and <out>/base.png -- by default
 * <out> is a new ~/Downloads/terradapt-<date-time> -- and prints the
 * tools/stitch-series.mjs command that turns them into the clip.
 */
import { chromium } from 'playwright';
import { existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const here = dirname(fileURLToPath(import.meta.url));
const AUTH = join(here, '.terradapt-auth.json');

// ---- Arguments ---------------------------------------------------------------
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const opt = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : fallback;
};
const valued = new Set(['out', 'size', 'scale', 'settle', 'years']);
const input = argv.find((a, i) => !a.startsWith('--') && !valued.has(argv[i - 1]?.slice(2)));
if (!input) {
  console.error("usage: node tools/capture-terradapt.mjs [--login] '<dashboard url>' [--out <dir>] [--years 1984-2024] [--size 1600x1000] [--scale 2] [--settle 1500] [--keep-ui]");
  process.exit(1);
}
const [width, height] = opt('size', '1600x1000').split('x').map(Number);
const scale = Number(opt('scale', '2'));
const settle = Number(opt('settle', '1500'));
const [onlyFrom, onlyTo] = (opt('years', '') || '-').split('-').map((v) => (v ? Number(v) : undefined));
// A new folder in Downloads each run, unless told otherwise.
const out = resolve(opt('out', join(homedir(), 'Downloads', `terradapt-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}`)));

// The dashboard keeps its whole state in the URL, as JSON-quoted values.
const url = new URL(input);
url.searchParams.set('baseLayer', '"google_satellite"');

const launch = (headless) =>
  chromium.launch({
    headless,
    // WebGL in software when headless: the map is a WebGL canvas and there is
    // no GPU to hand it otherwise.
    args: headless ? ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : [],
  });

// ---- Log in once -------------------------------------------------------------
if (flag('login')) {
  const browser = await launch(false);
  const context = await browser.newContext({ viewport: { width, height } });
  const page = await context.newPage();
  await page.goto(url.href);
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  await rl.question('Log in to TerrAdapt in the browser window, then press Enter here to keep the session. ');
  rl.close();
  await context.storageState({ path: AUTH });
  await browser.close();
  console.log(`Saved the session to ${AUTH}.`);
  process.exit(0);
}

// ---- Capture -----------------------------------------------------------------
const browser = await launch(true);
const context = await browser.newContext({
  viewport: { width, height },
  deviceScaleFactor: scale,
  ...(existsSync(AUTH) ? { storageState: AUTH } : {}),
});
const page = await context.newPage();

// Loaded means no requests in flight for a while: tiles arrive in bursts, and
// the map is only finished once the last burst has been quiet for a moment.
let inflight = 0;
page.on('request', () => inflight++);
page.on('requestfinished', () => inflight--);
page.on('requestfailed', () => inflight--);
const quiet = async (ms = 1200, timeout = 45000) => {
  const start = Date.now();
  let calmSince = Date.now();
  while (Date.now() - start < timeout) {
    if (inflight > 0) calmSince = Date.now();
    else if (Date.now() - calmSince >= ms) return;
    await page.waitForTimeout(100);
  }
  console.warn('  (still loading after 45 s; taking it anyway)');
};

const open = async (href) => {
  await page.goto(href, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForSelector('.year-slider .noUi-handle', { timeout: 60000 });
  await quiet();
};

/** The map canvas: the biggest one on the page. Everything else is hidden
 *  for the shot, unless --keep-ui. Returns the area to screenshot. */
const frame = async () => {
  const box = await page.evaluate((keepUi) => {
    const canvas = [...document.querySelectorAll('canvas')].sort(
      (a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight,
    )[0];
    if (!canvas) return null;
    if (!keepUi && !document.getElementById('capture-hide-ui')) {
      canvas.setAttribute('data-capture', '');
      const style = document.createElement('style');
      style.id = 'capture-hide-ui';
      // visibility is inherited but can be turned back on by a child, so
      // this hides everything except the canvas without moving anything.
      style.textContent = 'body * { visibility: hidden !important; } [data-capture] { visibility: visible !important; }';
      document.head.append(style);
    }
    const r = canvas.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  }, flag('keep-ui'));
  if (!box) throw new Error('no map canvas found on the page');
  return flag('keep-ui') ? undefined : box;
};

const shoot = async (name) => {
  await page.waitForTimeout(settle);
  const clip = await frame();
  const path = join(out, `${name}.png`);
  await page.screenshot({ path, clip });
  // The UI back straight after: a hidden element cannot take focus, and the
  // next year is stepped on through the timeline's handle.
  await page.evaluate(() => document.getElementById('capture-hide-ui')?.remove());
  return path;
};

mkdirSync(out, { recursive: true });
console.log(`Opening the dashboard on Google Satellite${existsSync(AUTH) ? ', logged in' : ''}...`);
await open(url.href);

if (url.searchParams.get('overlayId') && (await page.getByText('Login / Register').count())) {
  console.warn(
    "  This view has an overlay, but the browser is not logged in, so it will not show.\n" +
      "  Run once with --login to keep your session, then run this again.",
  );
}

// The middle of the three handles is the current year; the outer two are the
// ends of the range. Home puts it on the start, each ArrowRight a year on.
const handles = page.locator('.year-slider .noUi-handle');
const valueOf = async (i) => Math.round(Number(await handles.nth(i).getAttribute('aria-valuenow')));
const last = await valueOf(2);
const current = handles.nth(1);
await current.focus();
await page.keyboard.press('Home');

const years = [];
for (;;) {
  const want = (await valueOf(1));
  // The label over the timeline is what the map is showing; wait for it.
  await page.waitForFunction((y) => document.querySelector('.year-marker--current')?.textContent.trim() === String(y), want, { timeout: 20000 });
  if (onlyFrom === undefined || want >= onlyFrom) {
    await quiet();
    await shoot(want);
    years.push(want);
    process.stdout.write(`  ${want}\r`);
  }
  if (want >= last || (onlyTo !== undefined && want >= onlyTo)) break;
  await current.focus();
  await page.keyboard.press('ArrowRight');
  // Guard against a key that did not take: it would repeat the same year.
  await page.waitForFunction(
    ([sel, y]) => Math.round(Number(document.querySelectorAll(sel)[1]?.getAttribute('aria-valuenow'))) > y,
    ['.year-slider .noUi-handle', want],
    { timeout: 10000 },
  );
}
console.log(`Captured ${years.length} years, ${years[0]}-${years.at(-1)}.`);

// The bare satellite, same camera: the view as the app last wrote it into the
// URL, with the layer faded out and the overlay taken off.
const bare = new URL(page.url());
bare.searchParams.set('opacity', '0');
bare.searchParams.set('baseLayer', '"google_satellite"');
for (const k of ['selectedOverlay', 'overlayId', 'overlayName']) bare.searchParams.delete(k);
await open(bare.href);
await shoot('base');
console.log('Captured the bare satellite as base.png.');
await browser.close();

// What stitch-series needs: the files are in filename order, years then base.
const meta = await sharp(join(out, 'base.png')).metadata();
const px = { w: meta.width, h: meta.height };
const cropH = px.h - (px.h % 2);
const cropW = Math.round((cropH * 4) / 5 / 2) * 2;
console.log(`\nSaved to ${out}\nTo build the clip (a centred 4:5 crop; adjust --crop to frame it):`);
console.log(
  `  node tools/stitch-series.mjs --dir '${out}' --from ${years[0]} --skip 0 --years ${years.length} ` +
    `--base ${years.length + 1} --slug <slug> --crop ${cropW}:${cropH}:${Math.round((px.w - cropW) / 2)}:0`,
);
