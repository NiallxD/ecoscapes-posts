/// <reference lib="webworker" />
/** Areas for the planning tool: how much of the study area -- or of the view
 *  -- the current model scores at or above a cut-off, the spread of its
 *  scores, and with two scores the area in each of the nine cells.
 *
 *  Counted from each layer's area sample (tools/prepare-value-layer.py):
 *  real full-detail values, one every ~200 m on a grid all layers share, so
 *  these are areas at full detail, not of the pixels the zoomed-out map
 *  draws. Each point is weighted by the ground it stands for, which shrinks
 *  northward on a Mercator grid.
 *
 *  Scored with the very lookup tables the map's shader uses (model.ts), so
 *  the numbers and the map always agree. The whole area is counted when the
 *  model changes; the view, over just its own rectangle, when the view
 *  changes -- so panning never recounts the region. */

export type Grid = { x0: number; y0: number; w: number; h: number; step: number; z: number };
export type StatsLayer = { src: string; weight: number; axis: 0 | 1 };
export type StatsRequest = {
  seq: number;
  kind: 'region' | 'view';
  grid: Grid;
  layers: StatsLayer[];
  /** Each layer's score for each byte, 256 apiece (model.ts criterionLut). */
  luts: Uint8Array;
  op: 'mean' | 'and' | 'or';
  cut: number;
  /** The view, in sample cells: [col0, row0, col1, row1). */
  view: [number, number, number, number] | null;
  /** Two scores: each axis's low/high breaks. Null for one score. */
  breaks: [[number, number], [number, number]] | null;
};
/** A hotspot: the middle of a block, in z-pixel coordinates, and its
 *  strength (0..1). */
export type Spot = { x: number; y: number; v: number };
/** Areas in km². `cells` is the two-score grid, row-major from low/low: row =
 *  second axis, column = first. `points` is how many samples went in.
 *  `best` are the strongest places, a few blocks apart. */
export type Tally = {
  total: number;
  above: number;
  mean: number;
  hist: number[];
  cells: number[];
  points: number;
  best: Spot[];
};
export type StatsResponse =
  | { seq: number; kind: 'region' | 'view'; tally: Tally; ms: number }
  | { seq: number; kind: 'region' | 'view'; loading: true };

const BINS = 20;
/** Hotspots are found in blocks of this many samples a side (~3 km), and
 *  kept at least SPREAD blocks apart, so five are five different places. */
const BLOCK = 16;
const SPREAD = 4;
const BEST = 5;
const samples = new Map<string, Promise<Uint8Array>>();

function load(src: string) {
  let p = samples.get(src);
  if (!p) {
    p = (async () => {
      // After the map's own tiles: the numbers can wait a moment, the map
      // should not.
      const res = await fetch(src, { priority: 'low' } as RequestInit);
      const bmp = await createImageBitmap(await res.blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
      const { width, height } = bmp;
      const c = new OffscreenCanvas(width, height);
      const ctx = c.getContext('2d', { willReadFrequently: true })!;
      ctx.drawImage(bmp, 0, 0);
      bmp.close();
      const rgba = ctx.getImageData(0, 0, width, height).data;
      const out = new Uint8Array(width * height);
      for (let i = 0, j = 0; i < out.length; i++, j += 4) out[i] = rgba[j];
      return out;
    })();
    samples.set(src, p);
  }
  return p;
}

/** Ground area of one sample cell in each row, km². */
const areaCache = new Map<string, Float64Array>();
function rowAreas(g: Grid) {
  const key = `${g.y0}/${g.h}/${g.step}/${g.z}`;
  let out = areaCache.get(key);
  if (out) return out;
  const n = 2 ** g.z * 256;
  const side = (2 * Math.PI * 6378137) / n; // metres a z-pixel at the equator
  out = new Float64Array(g.h);
  for (let r = 0; r < g.h; r++) {
    const y = g.y0 + (r + 0.5) * g.step;
    const lat = Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n)));
    const m = g.step * side * Math.cos(lat);
    out[r] = (m * m) / 1e6;
  }
  areaCache.set(key, out);
  return out;
}

// One slot per kind: a newer request replaces an older one not yet started.
const latest: Record<'region' | 'view', StatsRequest | null> = { region: null, view: null };
let busy = false;

self.onmessage = (e: MessageEvent<StatsRequest>) => {
  latest[e.data.kind] = e.data;
  if (!busy) run();
};

async function run() {
  busy = true;
  for (;;) {
    const req = latest.region ?? latest.view;
    if (!req) break;
    latest[req.kind] = null;
    if (req.layers.some((l) => !samples.has(l.src)))
      postMessage({ seq: req.seq, kind: req.kind, loading: true } satisfies StatsResponse);
    const arrays = await Promise.all(req.layers.map((l) => load(l.src)));
    // A newer request of this kind came in while loading: count that instead.
    if (latest[req.kind]) continue;
    const t0 = performance.now();
    const tally = count(req, arrays);
    postMessage({ seq: req.seq, kind: req.kind, tally, ms: performance.now() - t0 } satisfies StatsResponse);
  }
  busy = false;
}

function count(req: StatsRequest, arrays: Uint8Array[]): Tally {
  const { grid: g, layers, op, cut, breaks } = req;
  const two = !!breaks;
  const areas = rowAreas(g);
  const n = layers.length;
  // Scores as fractions, straight from the shader's tables.
  const lut = Float32Array.from(req.luts, (v) => v / 255);
  const w = layers.map((l) => l.weight);
  const ax = layers.map((l) => (two ? l.axis : 0));
  const [c0, r0, c1, r1] = req.kind === 'view' && req.view ? req.view : [0, 0, g.w, g.h];
  const t: Tally = { total: 0, above: 0, mean: 0, hist: new Array(BINS).fill(0), cells: new Array(9).fill(0), points: 0, best: [] };
  // Per block: the area with data, and the strength -- the score (one score)
  // or high on both (two scores) -- summed by area.
  const bw = Math.ceil(g.w / BLOCK), bh = Math.ceil(g.h / BLOCK);
  const bArea = new Float64Array(bw * bh), bStrength = new Float64Array(bw * bh);
  let sSum = 0;
  const sum = [0, 0], wsum = [0, 0], lo = [1, 1], hi = [0, 0], seen = [0, 0];
  const combine = (k: number) => (op === 'and' ? lo[k] : op === 'or' ? hi[k] : wsum[k] > 0 ? sum[k] / wsum[k] : 0);
  const bandOf = (s: number, [l, h]: [number, number]) => (s < l ? 0 : s < h ? 1 : 2);

  for (let r = r0; r < r1; r++) {
    const a = areas[r];
    const base = r * g.w;
    for (let c = c0; c < c1; c++) {
      const i = base + c;
      sum[0] = sum[1] = wsum[0] = wsum[1] = hi[0] = hi[1] = seen[0] = seen[1] = 0;
      lo[0] = lo[1] = 1;
      for (let k = 0; k < n; k++) {
        const b = arrays[k][i];
        if (!b) continue;
        const s = lut[k * 256 + b];
        const x = ax[k];
        sum[x] += s * w[k];
        wsum[x] += w[k];
        if (s < lo[x]) lo[x] = s;
        if (s > hi[x]) hi[x] = s;
        seen[x]++;
      }
      let score: number, strength: number;
      if (two) {
        // Like the map: a place needs both scores to have a cell.
        if (!seen[0] || !seen[1]) continue;
        score = combine(0);
        const cell = bandOf(combine(1), breaks![1]) * 3 + bandOf(score, breaks![0]);
        t.cells[cell] += a;
        strength = cell === 8 ? 1 : 0;
      } else {
        if (!seen[0]) continue;
        score = combine(0);
        strength = score;
      }
      const bi = ((r / BLOCK) | 0) * bw + ((c / BLOCK) | 0);
      bArea[bi] += a;
      bStrength[bi] += strength * a;
      t.total += a;
      t.points++;
      t.hist[Math.min(BINS - 1, Math.floor(score * BINS))] += a;
      sSum += score * a;
      if (score >= cut) t.above += a;
    }
  }
  t.mean = t.total ? sSum / t.total : 0;
  t.best = hotspots(g, bw, bh, bArea, bStrength);
  return t;
}

/** The strongest blocks, mostly covered by data, each at least SPREAD blocks
 *  from any stronger one already taken. */
function hotspots(g: Grid, bw: number, bh: number, area: Float64Array, strength: Float64Array): Spot[] {
  let full = 0;
  for (let i = 0; i < area.length; i++) if (area[i] > full) full = area[i];
  const order: number[] = [];
  for (let i = 0; i < area.length; i++) if (area[i] > full * 0.6 && strength[i] > 0) order.push(i);
  order.sort((a, b) => strength[b] / area[b] - strength[a] / area[a]);
  const picked: number[] = [];
  for (const i of order) {
    const x = i % bw, y = (i / bw) | 0;
    if (picked.some((j) => Math.max(Math.abs((j % bw) - x), Math.abs(((j / bw) | 0) - y)) < SPREAD)) continue;
    picked.push(i);
    if (picked.length === BEST) break;
  }
  return picked.map((i) => ({
    x: g.x0 + ((i % bw) * BLOCK + BLOCK / 2) * g.step,
    y: g.y0 + (((i / bw) | 0) * BLOCK + BLOCK / 2) * g.step,
    v: strength[i] / area[i],
  }));
}
