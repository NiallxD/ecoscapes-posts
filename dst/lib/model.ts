/** The Data Sandbox's scoring, in one place: what the map's shader
 *  (score-layer.ts), the area counts (stats-worker.ts) and tap-to-explain all
 *  compute from, so the three can never disagree.
 *
 *  Every layer's pixels are bytes (dst/tools/prepare-value-layer.py): 0 is no
 *  data, 1..255 a value between the layer's lo and hi. A criterion turns
 *  every possible byte into a 0..1 score once, as a 256-entry lookup table,
 *  and everything downstream reads the table. That is also what lets one
 *  mechanism serve both a straight ramp between two thresholds and a score
 *  chosen per category. */

export type Op = 'mean' | 'and' | 'or';
export type ValueLayer = { id: string; src: string; lo: number; hi: number };
/** `axis` only matters with two scores: which one a layer feeds (0 across,
 *  1 up). `scores`, when given, scores a categorical layer class by class
 *  (class value -> 0..1) instead of by the two thresholds. */
export type Criterion = {
  layer: ValueLayer;
  weight: number;
  good: number;
  bad: number;
  axis?: 0 | 1;
  scores?: Record<number, number>;
};
/** Two-score (bivariate) settings: where each axis breaks into low / middle /
 *  high (0..1), the nine colours (row = second axis, low to high; column =
 *  first), and one cell to show alone, or -1. */
export type Bivariate = { breaks: [[number, number], [number, number]]; palette: string[]; only: number };

/** Criteria the map takes at once. The limit is what a person can weigh
 *  against each other, not the GPU's. */
export const MAX_CRITERIA = 8;

/** A byte's value in the layer's own units. */
export const valueOf = (layer: ValueLayer, byte: number) => layer.lo + ((byte - 1) / 254) * (layer.hi - layer.lo);

/** A value near the given share of a layer's pixels, from its histogram:
 *  where a new criterion's thresholds start, so the map shows a spread
 *  rather than all-best or all-worst. The Sandbox starts a layer from here,
 *  and the Cycle draws its maps from here, so the two start alike. */
export function quantile(l: { lo: number; hi: number; hist: number[] }, q: number) {
  const total = l.hist.reduce((a, b) => a + b, 0);
  let run = 0;
  for (let i = 0; i < l.hist.length; i++) {
    run += l.hist[i];
    if (run >= q * total) return l.lo + ((i + 0.5) / l.hist.length) * (l.hi - l.lo);
  }
  return l.hi;
}

/** Where a new layer's two thresholds start, as shares of its area, by
 *  which way is better: from a quarter of the way up the spread to near its
 *  top, so the ordinary scores poorly and only the stand-out places are
 *  brightest. */
export const START: Record<'better' | 'worse', [number, number]> = { better: [0.25, 0.95], worse: [0.05, 0.75] };

/** A new criterion's two thresholds: from START by which way is better, or
 *  from `q` (shares of the layer's area) when an example or a Cycle map asks
 *  for somewhere else. A layer of classes steps to the nearest class. */
export function startAt(
  l: { lo: number; hi: number; hist: number[]; classes?: { value: number }[] },
  up: boolean,
  q?: [number, number],
) {
  const snap = (v: number) => (l.classes ? l.classes.reduce((a, c) => (Math.abs(c.value - v) < Math.abs(a.value - v) ? c : a)).value : v);
  const [qa, qb] = q ?? START[up ? 'better' : 'worse'];
  const a = snap(l.classes ? l.classes[0].value : quantile(l, qa));
  const b = snap(l.classes ? l.classes.at(-1)!.value : quantile(l, qb));
  return { bad: up ? a : b, good: up ? b : a };
}

/** A criterion's 0..1 score for a value in the layer's own units: 0 at `bad`,
 *  1 at `good`, straight between, clamped (RRN's fuzzy ramp). `good` below
 *  `bad` means lower is better. */
export function scoreOf(c: Criterion, value: number) {
  if (c.scores) {
    const k = Math.round(value);
    return c.scores[k] ?? 0;
  }
  const d = c.good - c.bad;
  if (Math.abs(d) < 1e-9) return value >= c.good ? 1 : 0;
  return Math.min(1, Math.max(0, (value - c.bad) / d));
}

/** The criterion's score for every byte, 0..255 (quantised to 1/255, which
 *  is how the map's shader holds it -- the area counts use the same table,
 *  quantisation and all). Entry 0 is unused: no data is never scored. */
export function criterionLut(c: Criterion) {
  const lut = new Uint8Array(256);
  for (let b = 1; b < 256; b++) lut[b] = Math.round(scoreOf(c, valueOf(c.layer, b)) * 255);
  return lut;
}

/** Combine 0..1 scores the way the shader does. */
export function combineScores(scores: { score: number; weight: number }[], op: Op) {
  if (!scores.length) return null;
  if (op === 'and') return Math.min(...scores.map((r) => r.score));
  if (op === 'or') return Math.max(...scores.map((r) => r.score));
  const w = scores.reduce((s, r) => s + r.weight, 0);
  return w ? scores.reduce((s, r) => s + r.score * r.weight, 0) / w : 0;
}

/** Low / middle / high on one axis of the two-score grid. */
export const band = (s: number, [lo, hi]: [number, number]) => (s < lo ? 0 : s < hi ? 1 : 2);

/** How steady a result is: the same model with every weight nudged, sixteen
 *  times over. VARIATIONS[v * MAX_CRITERIA + i] multiplies layer i's weight
 *  in variation v, between about x0.66 and x1.5 -- evenly on a log scale, so
 *  a weight is as likely to shrink by a third as to grow by half. Fixed, not
 *  random each time, so the map, the numbers and a shared link all see the
 *  same sixteen. Only the weighted mean has weights to nudge. */
export const RUNS = 16;
export const VARIATIONS = (() => {
  const out = new Float32Array(RUNS * MAX_CRITERIA);
  let seed = 20260925;
  const rand = () => (seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 2 ** 32;
  for (let i = 0; i < out.length; i++) out[i] = 2 ** (rand() * 1.2 - 0.6);
  return out;
})();
/** How many of the RUNS count as "always" and "mostly". */
export const STEADY = { always: RUNS, mostly: 12 };
