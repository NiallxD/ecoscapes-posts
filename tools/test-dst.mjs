#!/usr/bin/env node
/**
 * The planning tool (/ecoscapes-dst/), driven end to end in a real browser:
 * every example, both score modes, a categorical layer, one layer alone, a
 * shared link, both downloads and tap-to-explain -- checking each does what
 * it should, with no errors.
 *
 *   npm run build && npm run preview      # in another terminal (port 4331)
 *   node tools/test-dst.mjs [--browser chromium|webkit] [--url ...] [--shots dir]
 *
 * WebKit is Safari's engine (npx playwright install webkit), which is what
 * matters for iPhones. --shots saves a screenshot of each step.
 */
import { chromium, webkit } from 'playwright';
import fs from 'node:fs';

const args = process.argv.slice(2);
const arg = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const url = arg('--url', 'http://localhost:4331').replace(/\/$/, '');
const which = arg('--browser', 'chromium');
const shots = arg('--shots', null);
if (shots) fs.mkdirSync(shots, { recursive: true });

const engine = which === 'webkit' ? webkit : chromium;
const browser = await engine.launch(
  which === 'webkit' ? {} : { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
);
const context = await browser.newContext({
  viewport: { width: 1400, height: 900 },
  acceptDownloads: true,
  serviceWorkers: 'block',
  // Squamish, for "Score where I am".
  geolocation: { latitude: 49.7016, longitude: -123.1558 },
  permissions: ['geolocation'],
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

let failures = 0;
const results = [];
function check(name, ok, detail = '') {
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures++;
}
const shot = async (name) => shots && (await page.screenshot({ path: `${shots}/${which}-${name}.png` }));
/** Until the map and the numbers have settled. */
async function settle() {
  await page.waitForFunction(
    () => window.__dst && window.__dst.score.pending === 0 && !document.querySelector('.key.loading'),
    null,
    { timeout: 60000 },
  );
  await page.waitForTimeout(700);
}
const text = (sel) => page.locator(sel).innerText().then((t) => t.replace(/\s+/g, ' ').trim());

await page.goto(`${url}/ecoscapes-dst/?debug`);
await page.waitForFunction(() => window.__dst && window.__dst.map.loaded(), null, { timeout: 60000 });
check('opens with no layers', (await page.locator('.crit').count()) === 0);
check('WebGL 2 layer is on the map', await page.evaluate(() => !!window.__dst.map.getLayer('score')));

// Every example.
const presets = await page.locator('#presets button').allInnerTexts();
check('six examples', presets.length === 6, presets.join(', '));
for (const p of presets) {
  await page.click(`#presets button:text-is("${p}")`);
  await settle();
  const two = await page.evaluate(() => document.querySelector('.dst-page').classList.contains('bi-on'));
  const pct = await text(two ? '#bi-pct' : '#pct');
  check(`example "${p}" gives a number`, /^\d+%$/.test(pct), `${pct} ${await text(two ? '#bi-km' : '#km')}`);
  await shot(`example-${p.replace(/\W+/g, '-').toLowerCase()}`);
}

// Tap to explain, in one-score mode.
await page.click('#presets button:text-is("Wildlife strongholds")');
await settle();
await page.mouse.click(820, 430);
await page.waitForSelector('.maplibregl-popup-content', { timeout: 10000 });
const popup = await text('.maplibregl-popup-content');
check('tap explains a place', /out of 100|No data/.test(popup), popup.slice(0, 90));

// One layer alone.
await page.keyboard.press('Escape');
const before = await text('#pct');
await page.locator('.crit').first().locator('button[data-act="solo"]').click();
await settle();
check('one layer alone changes the numbers', (await text('#pct')) !== before || (await text('#km')) !== '', await text('#key-solo'));
check('solo note shown', await page.locator('#key-solo').isVisible());
await page.click('#solo-off');
await settle();
check('back to the whole model', (await text('#pct')) === before, `${before} -> ${await text('#pct')}`);

// This view.
await page.click('#scope button[data-scope="view"]');
await page.evaluate(() => window.__dst.map.jumpTo({ center: [-123.13, 49.72], zoom: 11 }));
await settle();
check('"This view" counts the view', /in view/.test(await text('#key-foot')), await text('#key-foot'));
await page.click('#scope button[data-scope="region"]');

// A categorical layer.
await page.selectOption('#criteria select[data-axis="0"]', 'landcover');
await settle();
const cats = await page.locator('.crit:has-text("Land cover") .cat').count();
check('land cover lists its kinds', cats === 18, `${cats} kinds`);
const pBefore = await text('#pct');
await page.locator('.crit:has-text("Land cover") .cat:has-text("Coniferous forest") button:text-is("Good")').click();
await settle();
check('scoring a kind changes the result', (await text('#pct')) !== pBefore, `${pBefore} -> ${await text('#pct')}`);

// A shared link reopens the same model.
await page.waitForTimeout(400);
const link = page.url();
check('the address carries the model', link.includes('#m='));
const numbers = await text('#pct');
const page2 = await context.newPage();
await page2.goto(link);
await page2.waitForFunction(() => document.querySelectorAll('.crit').length > 0, null, { timeout: 30000 });
await page2.waitForFunction(() => /^\d+%$/.test(document.querySelector('#pct').innerText.trim()), null, { timeout: 60000 });
check(
  'a shared link reopens the model',
  (await page2.locator('.crit').count()) === (await page.locator('.crit').count()) && (await page2.locator('#pct').innerText()).trim() === numbers,
  `${await page2.locator('#pct').innerText()} vs ${numbers}`,
);
await page2.close();

// Downloads.
const [png] = await Promise.all([page.waitForEvent('download'), page.click('#save-png')]);
check('map image downloads', /\.png$/.test(png.suggestedFilename()), png.suggestedFilename());
const [csv] = await Promise.all([page.waitForEvent('download'), page.click('#save-csv')]);
const csvText = fs.readFileSync(await csv.path(), 'utf8');
check('numbers download as CSV', csvText.includes('Land cover') && csvText.includes('Area covered'), `${csvText.split('\n').length} lines`);

// The best places, a visit, the tour, and where I am.
await page.click('#presets button:text-is("Room to roam")');
await settle();
await page.click('#best-btn');
const best = await page.locator('#best-list button').allInnerTexts();
check('five best places, each named', best.length === 5 && best.every((b) => / of |at /.test(b)), best[0]?.replace(/\s+/g, ' '));
check('each has a pin', (await page.locator('.best-pin').count()) === 5);
await page.locator('#best-list button').first().click();
await page.waitForSelector('.why-title', { timeout: 15000 });
check('visiting a place explains it', /^1 · /.test(await text('.why-title')), await text('.why-title'));
await page.click('#tour-btn');
await page.waitForTimeout(1500);
check('the tour runs', (await text('#tour-btn')) === 'Stop the tour');
await page.mouse.move(900, 500);
await page.mouse.down();
await page.mouse.move(960, 530, { steps: 4 });
await page.mouse.up();
await page.waitForTimeout(300);
check('touching the map stops the tour', (await text('#tour-btn')) === 'Take the tour');
await page.click('#here');
await page.waitForFunction(() => document.querySelector('.why-title')?.textContent === 'Where you are', null, { timeout: 20000 });
check('"where I am" scores your spot', (await page.locator('.here-dot').count()) === 1);

// Two scores: isolate a cell.
await page.click('#presets button:text-is("Value × pressure")');
await settle();
await page.click('#bi-grid button[data-cell="8"]');
await settle();
check('a cell can be shown alone', (await page.locator('#bi-grid.isolating').count()) === 1);
await shot('two-scores-isolated');

check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
console.log(`${which}:`);
for (const r of results) console.log('  ' + r);
console.log(failures ? `${failures} failed` : 'all passed');
await browser.close();
process.exit(failures ? 1 : 0);
