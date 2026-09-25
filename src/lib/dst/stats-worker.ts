/// <reference lib="webworker" />
/** Areas for the decision-support page: how much of the study area -- or of
 *  the view -- the current model scores at or above a cut-off, and the spread
 *  of its scores. Counted from each layer's area sample (tools/prepare-value-
 *  layer.py): real full-detail values, one every few pixels on a grid all
 *  layers share, so these are areas at full detail, not of the averaged
 *  pixels the zoomed-out map draws. Off the main thread, so the sliders stay
 *  smooth while it counts.
 *
 *  The scoring here is the shader's (score-layer.ts FRAG), in the same byte
 *  space: the numbers and the map always agree. */

export type Grid = { x0: number; y0: number; w: number; h: number; step: number; z: number };
export type StatsCriterion = { id: string; src: string; weight: number; bad: number; good: number; axis: 0 | 1 };
export type StatsRequest = {
  seq: number;
  grid: Grid;
  criteria: StatsCriterion[];
  op: 'mean' | 'and' | 'or';
  cut: number;
  /** The view, in sample cells: [col0, row0, col1, row1). */
  view: [number, number, number, number] | null;
  /** Two scores: each axis's low/high breaks. Null for one score. */
  breaks: [[number, number], [number, number]] | null;
};
/** Areas in km². `cells` is the two-score grid, row-major from low/low: row =
 *  second axis, column = first. Empty with one score. */
export type Tally = { total: number; above: number; mean: number; hist: number[]; cells: number[] };
export type StatsResponse = { seq: number; region: Tally; view: Tally | null } | { seq: number; loading: true };

const BINS = 20;
const samples = new Map<string, Promise<Uint8Array>>();

function load(src: string) {
  let p = samples.get(src);
  if (!p) {
    p = (async () => {
      const blob = await (await fetch(src)).blob();
      const bmp = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
      const { width, height } = bmp;
      const c = new OffscreenCanvas(width, height);
      const ctx = c.getContext('2d', { willReadFrequently: true })!;
      ctx.drawImage(bmp, 0, 0);
      bmp.close();
      const rgba = ctx.getImageData(0, 0, width, height).data;
      const out = new Uint8Array(width * height);
      for (let i = 0; i < out.length; i++) out[i] = rgba[i * 4];
      return out;
    })();
    samples.set(src, p);
  }
  return p;
}

/** Ground area of one sample cell in each row, km²: a Mercator pixel's side
 *  shrinks with the cosine of its latitude. */
function rowAreas(g: Grid) {
  const n = 2 ** g.z * 256;
  const side = (2 * Math.PI * 6378137) / n; // metres a z-pixel at the equator
  const out = new Float64Array(g.h);
  for (let r = 0; r < g.h; r++) {
    const y = g.y0 + (r + 0.5) * g.step;
    const lat = Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n)));
    const m = g.step * side * Math.cos(lat);
    out[r] = (m * m) / 1e6;
  }
  return out;
}

const empty = (): Tally => ({ total: 0, above: 0, mean: 0, hist: new Array(BINS).fill(0), cells: new Array(9).fill(0) });

let latest: StatsRequest | null = null;
let busy = false;

self.onmessage = (e: MessageEvent<StatsRequest>) => {
  latest = e.data;
  if (!busy) run();
};

async function run() {
  busy = true;
  while (latest) {
    const req = latest;
    latest = null;
    const pending = req.criteria.some((c) => !samples.has(c.src));
    if (pending) postMessage({ seq: req.seq, loading: true } satisfies StatsResponse);
    const arrays = await Promise.all(req.criteria.map((c) => load(c.src)));
    // A newer model arrived while loading: count that one instead.
    if (latest) continue;
    postMessage(count(req, arrays) satisfies StatsResponse);
  }
  busy = false;
}

function count(req: StatsRequest, arrays: Uint8Array[]): StatsResponse {
  const { grid: g, criteria: cs, op, cut, breaks } = req;
  const two = !!breaks;
  const areas = rowAreas(g);
  const n = cs.length;
  const w = cs.map((c) => c.weight);
  const bad = cs.map((c) => c.bad);
  const d = cs.map((c) => c.good - c.bad);
  const ax = cs.map((c) => (two ? c.axis : 0));
  const region = empty();
  const view = req.view ? empty() : null;
  const [vc0, vr0, vc1, vr1] = req.view ?? [0, 0, 0, 0];
  let rSum = 0, vSum = 0;
  const sum = [0, 0], wsum = [0, 0], lo = [1, 1], hi = [0, 0], seen = [0, 0];
  const combine = (k: number) => (op === 'and' ? lo[k] : op === 'or' ? hi[k] : wsum[k] > 0 ? sum[k] / wsum[k] : 0);
  const band = (s: number, [l, h]: [number, number]) => (s < l ? 0 : s < h ? 1 : 2);

  for (let r = 0; r < g.h; r++) {
    const a = areas[r];
    const inRows = view && r >= vr0 && r < vr1;
    const base = r * g.w;
    for (let c = 0; c < g.w; c++) {
      const i = base + c;
      sum[0] = sum[1] = wsum[0] = wsum[1] = hi[0] = hi[1] = seen[0] = seen[1] = 0;
      lo[0] = lo[1] = 1;
      for (let k = 0; k < n; k++) {
        const b = arrays[k][i];
        if (!b) continue;
        const dk = d[k];
        let s = Math.abs(dk) < 1e-4 ? (b >= cs[k].good ? 1 : 0) : (b - bad[k]) / dk;
        s = s < 0 ? 0 : s > 1 ? 1 : s;
        const x = ax[k];
        sum[x] += s * w[k];
        wsum[x] += w[k];
        if (s < lo[x]) lo[x] = s;
        if (s > hi[x]) hi[x] = s;
        seen[x]++;
      }
      let score: number, cell = -1;
      if (two) {
        // Like the map: a place needs both scores to have a cell.
        if (!seen[0] || !seen[1]) continue;
        cell = band(combine(1), breaks![1]) * 3 + band(combine(0), breaks![0]);
        score = combine(0);
      } else {
        if (!seen[0]) continue;
        score = combine(0);
      }
      const bin = Math.min(BINS - 1, Math.floor(score * BINS));
      region.total += a;
      region.hist[bin] += a;
      rSum += score * a;
      if (score >= cut) region.above += a;
      if (cell >= 0) region.cells[cell] += a;
      if (inRows && c >= vc0 && c < vc1) {
        view!.total += a;
        view!.hist[bin] += a;
        vSum += score * a;
        if (score >= cut) view!.above += a;
        if (cell >= 0) view!.cells[cell] += a;
      }
    }
  }
  region.mean = region.total ? rSum / region.total : 0;
  if (view) view.mean = view.total ? vSum / view.total : 0;
  return { seq: req.seq, region, view };
}
