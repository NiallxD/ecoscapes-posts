import { startAt, type Criterion } from '../../dst/lib/model';
import type { Saved } from '../../dst/lib/share';
import type { MapDef } from './content';

/** A layer as the page's script has it (content.ts, mapLayers). */
export type MapLayer = { id: string; name: string; src: string; lo: number; hi: number; higher: 'better' | 'worse'; hist: number[] };

/** Where each score breaks into low / middle / high: the Sandbox's own. */
const BREAKS: [[number, number], [number, number]] = [
  [0.35, 0.65],
  [0.35, 0.65],
];

/** A target's map as a Data Sandbox model: what the score layer draws, and
 *  the same model as a share link's contents, so "Test it in the Sandbox"
 *  opens exactly this. The thresholds start where the Sandbox would start
 *  them (startAt), unless the recipe says otherwise. */
export function modelFor(m: MapDef, layers: Map<string, MapLayer>, key: string[]) {
  const two = !!m.axes;
  const criteria: Criterion[] = m.layers.map((r) => {
    const l = layers.get(r.id)!;
    const start = startAt(l, (r.higher ?? l.higher) === 'better', r.q);
    return {
      layer: { id: l.id, src: l.src, lo: l.lo, hi: l.hi },
      weight: r.weight,
      bad: r.bad ?? start.bad,
      good: r.good ?? start.good,
      axis: r.axis,
    };
  });
  const r4 = (v: number) => Number(v.toPrecision(4));
  const saved: Saved = {
    v: 1,
    m: two ? 'two' : 'one',
    o: 'mean',
    a: m.axes ?? ['Value', 'Pressure'],
    b: BREAKS,
    c: 70,
    i: criteria.map((c) => [c.layer.id, c.weight, r4(c.bad), r4(c.good), c.axis ?? 0]),
    ...(two ? { p: key } : {}),
  };
  return { criteria, bivariate: two ? { breaks: BREAKS, palette: key, only: -1 } : null, saved };
}
