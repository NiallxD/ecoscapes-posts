/** The four goals as a ring: what the goals bar at the foot of the column
 *  turns into for material that supports every goal (40 years of change),
 *  each goal's button bending into its own arc of the ring, and back again.
 *  Drawn in an SVG laid over the column; the bar itself is hidden while the
 *  ring (or the morph) is showing. */

export type RingGoal = { code: string; name: string; colour: string };

const NS = 'http://www.w3.org/2000/svg';
/** Points along each edge of a shape: enough for an arc to read as round. */
const N = 28;
const MORPH = 720;
/** Each arc's share of its quarter, and the ring's thickness. */
const SPAN = 80;
const THICK = 14;

const el = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}, parent?: Element) => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  parent?.appendChild(e);
  return e;
};
const ease = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
type Pt = [number, number];
type Box = { x: number; y: number; w: number; h: number };
export type RingPlace = { cx: number; cy: number; r: number };

/** A button's outline as points: along the top, then back along the
 *  bottom -- the same count as an arc's, so one can become the other. */
function barShape(b: Box): Pt[] {
  const top: Pt[] = [], bottom: Pt[] = [];
  for (let k = 0; k <= N; k++) {
    top.push([b.x + (b.w * k) / N, b.y]);
    bottom.push([b.x + b.w - (b.w * k) / N, b.y + b.h]);
  }
  return [...top, ...bottom];
}
/** Goal i's arc: the outer edge round, then back along the inner. ES.1 at
 *  the top, the rest clockwise. */
function arcShape(i: number, p: RingPlace): Pt[] {
  const mid = -90 + i * 90;
  const a0 = mid - SPAN / 2, a1 = mid + SPAN / 2;
  const at = (r: number, deg: number): Pt => [p.cx + r * Math.cos((deg * Math.PI) / 180), p.cy + r * Math.sin((deg * Math.PI) / 180)];
  const outer: Pt[] = [], inner: Pt[] = [];
  for (let k = 0; k <= N; k++) {
    outer.push(at(p.r, a0 + ((a1 - a0) * k) / N));
    inner.push(at(p.r - THICK, a1 - ((a1 - a0) * k) / N));
  }
  return [...outer, ...inner];
}
const labelAt = (i: number, p: RingPlace): Pt => {
  const deg = -90 + i * 90;
  const r = p.r + 16;
  return [p.cx + r * Math.cos((deg * Math.PI) / 180), p.cy + r * Math.sin((deg * Math.PI) / 180)];
};
const path = (pts: Pt[]) => `M${pts.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join('L')}Z`;
const mix = (a: Pt[], b: Pt[], t: number): Pt[] => a.map(([x, y], i) => [x + (b[i][0] - x) * t, y + (b[i][1] - y) * t]);

export class GoalRing {
  private shapes: SVGPathElement[] = [];
  private labels: SVGTextElement[] = [];
  private spokes: SVGLineElement[] = [];
  private centre: SVGGElement;
  private run = 0;
  /** Where the ring is when shown, or null when it's the bar. */
  private at: RingPlace | null = null;

  constructor(
    private svg: SVGSVGElement,
    private bar: HTMLElement,
    goals: RingGoal[],
    onGoal: (i: number) => void,
    private reduce: MediaQueryList,
  ) {
    this.spokes = goals.map(() => el('line', { class: 'gr-spoke' }, svg));
    goals.forEach((g, i) => {
      // Stroked in its own colour with round joins: the corners rounded, as
      // the bar's buttons are and the big ring's segments.
      const s = el('path', { class: 'gr-arc', fill: g.colour, stroke: g.colour, role: 'button', tabindex: -1, 'aria-label': `${g.code}: ${g.name}` }, svg);
      el('title', {}, s).textContent = `${g.code}: ${g.name}`;
      s.addEventListener('click', () => onGoal(i));
      this.shapes.push(s);
      const t = el('text', { class: 'gr-label', 'text-anchor': 'middle', 'dominant-baseline': 'central' }, svg);
      t.textContent = g.code;
      this.labels.push(t);
    });
    this.centre = el('g', { class: 'gr-centre' }, svg);
    this.visible(false);
  }

  /** The bar's buttons, in the SVG's own coordinates. */
  private bars(): Box[] {
    const o = this.svg.getBoundingClientRect();
    return [...this.bar.querySelectorAll('button')].map((b) => {
      const r = b.getBoundingClientRect();
      return { x: r.left - o.left, y: r.top - o.top, w: r.width, h: r.height };
    });
  }

  /** An SVG element has no `hidden` property of its own (setting one does
   *  nothing), so shown and hidden by its style. */
  private visible(on: boolean) {
    this.svg.style.display = on ? '' : 'none';
  }

  get shown() {
    return this.at !== null;
  }

  /** Into a ring at `p`, the words at its middle and what drives it under. */
  show(p: RingPlace, title: string, through: string[]) {
    const was = this.at;
    this.at = p;
    this.centre.replaceChildren();
    const t1 = el('text', { x: p.cx, y: p.cy - 7, 'text-anchor': 'middle', class: 'gr-title' }, this.centre);
    t1.textContent = title;
    const t2 = el('text', { x: p.cx, y: p.cy + 12, 'text-anchor': 'middle', class: 'gr-sub' }, this.centre);
    t2.textContent = 'supports every goal';
    // What does the work, under the ring, a line or two.
    through.forEach((line, k) => {
      const t = el('text', { x: p.cx, y: p.cy + p.r + 40 + k * 16, 'text-anchor': 'middle', class: k ? 'gr-through' : 'gr-through gr-lead' }, this.centre);
      t.textContent = line;
    });
    // Already a ring: moved there, no morph.
    if (was) return this.draw(p, 1);
    this.morph(true);
  }

  /** Back into the bar. */
  hide() {
    if (!this.at) return;
    this.morph(false);
  }

  /** Where the ring sits changed (a resize): straight there. */
  place(p: RingPlace) {
    if (!this.at) return;
    this.at = p;
    this.draw(p, 1);
  }

  private draw(p: RingPlace, t: number) {
    const bars = this.bars();
    this.shapes.forEach((s, i) => {
      s.setAttribute('d', path(mix(barShape(bars[i]), arcShape(i, p), t)));
      s.style.fillOpacity = String(0.18 + 0.82 * t);
      s.style.strokeWidth = String(5 * t);
      s.style.strokeOpacity = String(t);
    });
    this.labels.forEach((l, i) => {
      const b = bars[i];
      const from: Pt = [b.x + b.w / 2 + 6, b.y + b.h / 2];
      const [x, y] = mix([from], [labelAt(i, p)], t)[0];
      l.setAttribute('x', x.toFixed(1));
      l.setAttribute('y', y.toFixed(1));
    });
    // Spokes and the words at the middle come in over the last part.
    const late = Math.max(0, (t - 0.6) / 0.4);
    this.spokes.forEach((sp, i) => {
      const mid = ((-90 + i * 90) * Math.PI) / 180;
      const r0 = 42, r1 = p.r - THICK - 6;
      sp.setAttribute('x1', String(p.cx + r0 * Math.cos(mid)));
      sp.setAttribute('y1', String(p.cy + r0 * Math.sin(mid)));
      sp.setAttribute('x2', String(p.cx + (r0 + (r1 - r0) * late) * Math.cos(mid)));
      sp.setAttribute('y2', String(p.cy + (r0 + (r1 - r0) * late) * Math.sin(mid)));
      sp.style.opacity = String(late);
    });
    this.centre.style.opacity = String(late);
    this.shapes.forEach((s) => s.setAttribute('tabindex', t === 1 ? '0' : '-1'));
  }

  private morph(toRing: boolean) {
    const run = ++this.run;
    const p = this.at!;
    this.visible(true);
    this.bar.style.visibility = 'hidden';
    // The bar's own heading goes with it.
    this.bar.parentElement?.classList.add('as-ring');
    const done = () => {
      if (toRing) return;
      this.at = null;
      this.visible(false);
      this.bar.style.visibility = '';
      this.bar.parentElement?.classList.remove('as-ring');
    };
    if (this.reduce.matches) {
      this.draw(p, toRing ? 1 : 0);
      return done();
    }
    const t0 = performance.now();
    const frame = (now: number) => {
      if (run !== this.run) return;
      const x = Math.min(1, Math.max(0, (now - t0) / MORPH));
      this.draw(p, ease(toRing ? x : 1 - x));
      if (x < 1) requestAnimationFrame(frame);
      else done();
    };
    requestAnimationFrame(frame);
  }
}
