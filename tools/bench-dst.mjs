#!/usr/bin/env node
/**
 * A repeatable performance run of the planning tool (/ecoscapes-dst/), for
 * comparing one build with the next.
 *
 *   npm run build && npm run preview      # in another terminal (port 4331)
 *   node tools/bench-dst.mjs [--url http://localhost:4331] [--gpu] [--fast]
 *
 * Drives the page (?debug turns on its measuring hooks) through a fixed
 * script -- an example, a zoom in, five pans, a layer added, a slider dragged
 * -- and reports, per step: how long until every tile in view is drawn, the
 * main thread's long tasks (anything over 50 ms, which is what a person feels
 * as a stall), and the bytes of value tiles fetched; and how long the area
 * counts took in the worker.
 *
 * The network is held to about a 4G connection (40 ms a round trip, 12
 * Mbit/s) unless --fast. Without --gpu the browser renders in software (SwiftShader), so frame times
 * are pessimistic; the long tasks, bytes and counting times are real either
 * way.
 */
import { chromium } from 'playwright';

const args = process.argv.slice(2);
const url = (args[args.indexOf('--url') + 1] || 'http://localhost:4331').replace(/\/$/, '');
const gpu = args.includes('--gpu');

const browser = await chromium.launch({
  args: gpu ? [] : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
// No service worker: every tile comes over the network, as on a first visit.
const context = await browser.newContext({ viewport: { width: 1400, height: 900 }, serviceWorkers: 'block' });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

// Long tasks, from the very start.
await page.addInitScript(() => {
  window.__long = [];
  new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__long.push(e.duration))).observe({
    type: 'longtask',
    buffered: true,
  });
});
let bytes = 0, requests = 0;
page.on('requestfinished', async (req) => {
  if (!req.url().includes('/tiles/dst/')) return;
  requests++;
  try {
    bytes += (await req.sizes()).responseBodySize;
  } catch {}
});
// A real connection, not localhost: every request costs a round trip.
if (!args.includes('--fast')) {
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 40,
    downloadThroughput: (12 * 1024 * 1024) / 8,
    uploadThroughput: (4 * 1024 * 1024) / 8,
  });
}

const rows = [];
async function step(name, act) {
  await page.evaluate(() => (window.__long.length = 0));
  const b0 = bytes, r0 = requests;
  const t0 = Date.now();
  await act();
  // Let the change reach a frame before asking whether it is drawn.
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  // Settled: nothing pending for 400 ms in a row.
  let quiet = 0;
  while (quiet < 4 && Date.now() - t0 < 60000) {
    await page.waitForTimeout(100);
    const pending = await page.evaluate(() => window.__dst.score.pending + (window.__dst.map.areTilesLoaded() ? 0 : 1));
    quiet = pending ? 0 : quiet + 1;
  }
  const ms = Date.now() - t0 - 400;
  const long = await page.evaluate(() => window.__long.slice());
  rows.push({
    step: name,
    'drawn (ms)': ms,
    'long tasks': long.length,
    'longest (ms)': Math.round(Math.max(0, ...long)),
    'stalled (ms)': Math.round(long.reduce((a, b) => a + b, 0)),
    requests: requests - r0,
    'tiles (KB)': Math.round((bytes - b0) / 1024),
  });
}

await page.goto(`${url}/ecoscapes-dst/?debug`);
await page.waitForFunction(() => window.__dst && window.__dst.map.loaded());

await step('example: Room to roam (5 layers)', () => page.click('#presets button:has-text("Room to roam")'));
await step('zoom in to the corridor', () =>
  page.evaluate(() => window.__dst.map.jumpTo({ center: [-123.1, 49.9], zoom: 10.5 })),
);
for (let i = 0; i < 5; i++)
  await step(`pan ${i + 1}`, () => page.evaluate(() => window.__dst.map.panBy([350, 120], { duration: 0 })));
await step('add a layer (beaver)', () => page.selectOption('#criteria select[data-axis="0"]', 'habitat-beaver'));

// A slider drag: 30 steps, one a frame, timing each frame.
const drag = await page.evaluate(async () => {
  const input = document.querySelector('.crit input[data-k="good"]');
  const times = [];
  let last = performance.now();
  for (let i = 0; i < 30; i++) {
    input.value = String(Number(input.min) + ((Number(input.max) - Number(input.min)) * (i + 5)) / 40);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => requestAnimationFrame(r));
    const now = performance.now();
    times.push(now - last);
    last = now;
  }
  times.sort((a, b) => a - b);
  return { median: times[15], worst: times[29] };
});
await page.waitForTimeout(2500);
const counts = await page.evaluate(() => window.__dst.debug.counts.slice());

console.table(rows);
console.log(`slider drag: median frame ${drag.median.toFixed(1)} ms, worst ${drag.worst.toFixed(1)} ms${gpu ? '' : ' (software GL)'}`);
console.log(
  `area counts: ${counts.length} runs, median ${[...counts].sort((a, b) => a - b)[counts.length >> 1]?.toFixed(0)} ms, ` +
    `worst ${Math.max(...counts).toFixed(0)} ms`,
);
console.log(`value tiles fetched: ${Math.round(bytes / 1024)} KB in ${requests} requests`);
if (errors.length) console.log('page errors:', errors);
await browser.close();
