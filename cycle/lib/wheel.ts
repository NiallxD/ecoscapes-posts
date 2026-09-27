/** The page's wheel on a wider screen: a disc so big it runs off the left of
 *  the screen, its ring the four EcoScapes goals, the one you're on at
 *  three o'clock with the goals either side just in view above and below,
 *  and that goal's targets on a track inside it. Drawing and gestures only:
 *  what a goal or a target is comes in, and what was asked for goes out
 *  through `on`. */

/** `icon`: a 32 × 32 drawing, as its path. */
export type WheelTarget = { id: string; chip: string; name: string; ink: string; icon?: string };
export type WheelGoal = { code: string; name: string; colour: string; ink: string; targets: WheelTarget[] };
type On = {
  goal: (i: number) => void;
  target: (id: string) => void;
  move: (dir: 1 | -1) => void;
  /** Scrolls on an arc, which may have been dropped from the ring by then. */
  scroll?: (e: WheelEvent) => void;
};

const NS = 'http://www.w3.org/2000/svg';
/** The ring's width, px. */
const RING = 76;
/** The targets' track, this far inside the ring. */
const TRACK = 34;
/** Targets on the track, this far apart (px), and the round buttons this far
 *  either side of the middle -- clear of four targets, the chosen one
 *  enlarged. */
const CHIP_GAP = 52;
const NAV_OFF = 132;
/** A target's circle, and the ring round it in three parts -- Focus,
 *  Achieve, Align -- that fill as you go through them. */
const CHIP_R = 16;
const CHIP_R_SEL = 19;
const PROG_GAP = 5;
const PARTS = 3;
/** Parts filling together start this far apart, ms: each as the one before
 *  it finishes (its fill is 0.4s, CyclePage.astro). */
const PROG_STEP = 400;
/** One part of the ring round a target, as a path about its middle. */
const part = (r: number, k: number) => {
  const gap = 16;
  const a0 = ((-90 + k * (360 / PARTS) + gap / 2) * Math.PI) / 180;
  const a1 = ((-90 + (k + 1) * (360 / PARTS) - gap / 2) * Math.PI) / 180;
  return `M${r * Math.cos(a0)} ${r * Math.sin(a0)}A${r} ${r} 0 0 1 ${r * Math.cos(a1)} ${r * Math.sin(a1)}`;
};
/** Text keeps this far clear of the ring's inner edge: clear of the targets
 *  and the buttons on the track too. */
const WRAP_GAP = 74;
/** How round a segment's corners are, px. */
const CORNER = 12;
/** The goal's targets' icons, faint on its arc: one row, evenly this far
 *  apart along it, and this big (px) -- twice the ring's width, so its edges
 *  cut them to shapes. They run on under the goal's name. */
const MARK_GAP = 200;
const MARK_SIZE = 165;
/** The goal's name down the middle of its arc, px. */
const LABEL_SIZE = 22;
/** The turn's length, ms. */
const TURN = 560;

const el = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}, parent?: Element) => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  parent?.appendChild(e);
  return e;
};
const ease = (x: number) => 1 - Math.pow(1 - x, 3);
/** The same numbers every time for the same seed, so a goal's icons fall
 *  the same way whenever its arc is made. */
const seeded = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

type Geometry = { W: number; H: number; cx: number; cy: number; R: number; rIn: number; vis: number; seg: number };
/** One goal's arc on the endless strip, kept while it is in view so a key
 *  press on it keeps its focus as the ring turns. */
type Arc = {
  g: SVGGElement;
  path: SVGPathElement;
  marks: SVGGElement;
  /** The goal's name, on a path down the arc's middle. */
  label: SVGGElement;
  chips: SVGGElement[];
};

export class Wheel {
  private G!: Geometry;
  private ring!: SVGGElement;
  private arcs = new Map<number, Arc>();
  /** Where the ring has turned to, in goals. It runs on past 4 rather than
   *  wrapping: goal n % 4 sits (n - pos) arcs from three o'clock. */
  private pos = 0;
  /** Each arc's clip path its own id. */
  private clips = 0;
  private spin = 0;
  private goal = 0;
  private target: string | null = null;
  /** How far through the chosen target: 1..3 tabs, 0 for none. */
  private done = 0;
  private shown = false;
  private reduce = matchMedia('(prefers-reduced-motion: reduce)');

  constructor(
    private svg: SVGSVGElement,
    private goals: WheelGoal[],
    private on: On,
  ) {
    this.gestures();
  }

  private get n() {
    return this.goals.length;
  }
  private mod = (i: number) => ((i % this.n) + this.n) % this.n;
  private polar(r: number, deg: number): [number, number] {
    const t = (deg * Math.PI) / 180;
    return [this.G.cx + r * Math.cos(t), this.G.cy + r * Math.sin(t)];
  }
  /** A segment of the ring, its four corners rounded: along the outer edge,
   *  round the corner, down the side, round, back along the inner edge. */
  private arcPath(r1: number, r2: number, a0: number, a1: number) {
    const rc = CORNER;
    const d = (r: number) => (rc / r) * (180 / Math.PI);
    const P = (r: number, a: number) => this.polar(r, a).map((v) => v.toFixed(1)).join(' ');
    return (
      `M${P(r2, a0 + d(r2))}` +
      `A${r2} ${r2} 0 0 1 ${P(r2, a1 - d(r2))}` +
      `Q${P(r2, a1)} ${P(r2 - rc, a1)}` +
      `L${P(r1 + rc, a1)}` +
      `Q${P(r1, a1)} ${P(r1, a1 - d(r1))}` +
      `A${r1} ${r1} 0 0 0 ${P(r1, a0 + d(r1))}` +
      `Q${P(r1, a0)} ${P(r1 + rc, a0)}` +
      `L${P(r2 - rc, a0)}` +
      `Q${P(r2, a0)} ${P(r2, a0 + d(r2))}Z`
    );
  }

  /** How far across the ring's outer edge reaches at mid-height: where the
   *  map's own middle is measured from. */
  get reach() {
    return this.G.cx + this.G.R;
  }
  /** Where the targets' circles on the track begin at this height on
   *  screen: the ring's edge, as far as the eye is concerned. */
  trackAt(y: number) {
    const r = this.G.rIn - TRACK - CHIP_R_SEL - PROG_GAP;
    const dy = y - this.G.cy;
    return this.G.cx + Math.sqrt(Math.max(0, r * r - dy * dy));
  }
  /** The furthest right text can go at this height on screen. */
  edgeAt(y: number) {
    const r = this.G.rIn - WRAP_GAP;
    const dy = y - this.G.cy;
    return this.G.cx + Math.sqrt(Math.max(0, r * r - dy * dy));
  }

  /** Everything drawn again for the window's size. */
  build() {
    const W = innerWidth, H = innerHeight, h = H / 2;
    // The ring's outer edge reaches 42% across at the middle and meets the
    // top and bottom of the screen at about 34%.
    const a = W * 0.42, d = Math.max(80, W * 0.08);
    const R = (h * h + d * d) / (2 * d);
    const vis = (Math.asin(Math.min(1, h / R)) * 180) / Math.PI;
    // Each goal's arc: a little over half of what is in view, so the goals
    // either side show above and below.
    this.G = { W, H, cx: a - R, cy: h, R, rIn: R - RING, vis, seg: vis * 1.05 };

    this.svg.replaceChildren();
    this.arcs.clear();
    this.svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    const defs = el('defs', {}, this.svg);
    for (const t of this.goals.flatMap((g) => g.targets))
      if (t.icon) el('path', { d: t.icon }, el('symbol', { id: `wheel-icon-${t.id}`, viewBox: '0 0 32 32' }, defs));
    el('circle', { class: 'disc', cx: this.G.cx, cy: this.G.cy, r: R }, this.svg);
    this.ring = el('g', { class: 'ring' }, this.svg);
    el('circle', { class: 'track', cx: this.G.cx, cy: this.G.cy, r: this.G.rIn - TRACK }, this.ring);

    // Back and on, one place at a time: two round buttons on the targets'
    // track either side of them. Fixed; the ring turns beside them.
    const rB = this.G.rIn - TRACK;
    for (const dir of [-1, 1] as const) {
      const ang = dir * (NAV_OFF / rB) * (180 / Math.PI);
      const [bx, by] = this.polar(rB, ang);
      const g = el('g', { class: 'nav', role: 'button', tabindex: 0, 'aria-label': dir < 0 ? 'Back' : 'On', transform: `translate(${bx} ${by}) rotate(${ang})` }, this.svg);
      el('title', {}, g).textContent = dir < 0 ? 'Back (↑ or ←)' : 'On (↓ or →)';
      el('circle', { class: 'nav-body', r: 19 }, g);
      el('path', { class: 'nav-arrow', d: dir < 0 ? 'M-6 3 L0 -3.5 L6 3' : 'M-6 -3 L0 3.5 L6 -3' }, g);
      g.addEventListener('click', () => this.on.move(dir));
      g.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          this.on.move(dir);
        }
      });
    }
    this.place();
  }

  /** The ring's arcs where it has turned to. Arcs are made as they come into
   *  view and dropped as they leave it; the rest are only moved. */
  private place() {
    const G = this.G;
    const rT = G.rIn - TRACK;
    const base = Math.round(this.pos);
    const keep = new Set<number>();
    for (let n = base - 3; n <= base + 3; n++) {
      const a = (n - this.pos) * G.seg;
      if (Math.abs(a) > G.vis + G.seg) continue;
      keep.add(n);
      const i = this.mod(n);
      const arc = this.arcs.get(n) ?? this.makeArc(n, i);
      const on = i === this.goal && n === base;
      arc.g.classList.toggle('on', on);
      arc.path.setAttribute('d', this.arcPath(G.rIn, G.R, a - G.seg / 2 + 0.4, a + G.seg / 2 - 0.4));
      arc.marks.setAttribute('transform', `rotate(${a} ${G.cx} ${G.cy})`);
      arc.label.setAttribute('transform', `rotate(${a} ${G.cx} ${G.cy})`);
      const gap = (CHIP_GAP / rT) * (180 / Math.PI);
      const k = arc.chips.length;
      // Progress: targets before the chosen one all done, the chosen one up
      // to its tab, the rest not yet.
      const at = on ? arc.chips.findIndex((c) => c.dataset.target === this.target) : -1;
      arc.chips.forEach((c, j) => {
        const [tx, ty] = this.polar(rT, a + (j - (k - 1) / 2) * gap);
        c.setAttribute('transform', `translate(${tx} ${ty})`);
        const sel = j === at;
        c.classList.toggle('sel', sel);
        const r = sel ? CHIP_R_SEL : CHIP_R;
        c.querySelector('circle')!.setAttribute('r', String(r));
        const lit = at < 0 ? 0 : j < at ? PARTS : j === at ? this.done : 0;
        c.querySelectorAll<SVGPathElement>('.prog-bg').forEach((p, n) => p.setAttribute('d', part(r + PROG_GAP, n)));
        // Parts that fill now go round one after another; emptied, at once.
        let next = 0;
        c.querySelectorAll<SVGPathElement>('.prog').forEach((p, n) => {
          p.setAttribute('d', part(r + PROG_GAP, n));
          const fill = n < lit;
          if (fill !== p.classList.contains('done')) p.style.transitionDelay = fill ? `${next++ * PROG_STEP}ms` : '0ms';
          p.classList.toggle('done', fill);
        });
      });
    }
    for (const [n, arc] of this.arcs) if (!keep.has(n)) (arc.g.remove(), this.arcs.delete(n));
  }

  private makeArc(n: number, i: number): Arc {
    const goal = this.goals[i];
    const g = el('g', { class: 'arc' }, this.ring);
    if (this.on.scroll) g.addEventListener('wheel', (e) => this.on.scroll!(e as WheelEvent), { passive: false });
    const seg = el('g', { class: 'seg', 'data-goal': i, role: 'button', tabindex: 0, 'aria-label': `${goal.code}: ${goal.name}` }, g);
    const path = el('path', { fill: goal.colour }, seg);
    const marks = this.makeMarks(i, seg);
    const label = this.makeLabel(goal.code, seg);
    el('title', {}, seg).textContent = `${goal.code}: ${goal.name}`;
    const chips = goal.targets.map((t) => {
      const c = el('g', { class: 'chip', 'data-target': t.id, role: 'button', tabindex: 0, 'aria-label': t.name, style: `--gc:${goal.colour}` }, g);
      el('circle', { r: CHIP_R, fill: goal.colour }, c);
      // Each part a track, and over it the goal's colour drawn round it as
      // the part fills: one after another when several fill at once.
      for (let n = 0; n < PARTS; n++) el('path', { class: 'prog-bg', d: part(CHIP_R + PROG_GAP, n) }, c);
      for (let n = 0; n < PARTS; n++) el('path', { class: 'prog', d: part(CHIP_R + PROG_GAP, n), pathLength: 1 }, c);
      el('text', { fill: t.ink, 'text-anchor': 'middle', 'dominant-baseline': 'central' }, c).textContent = t.chip;
      el('title', {}, c).textContent = t.name;
      return c;
    });
    const arc = { g, path, marks, label, chips };
    this.arcs.set(n, arc);
    return arc;
  }

  /** "ES GOAL 1" down the middle of a goal's arc, following its curve, the
   *  letters' tops to the outside: drawn about three o'clock and turned with
   *  it. Always centred on its arc, so the goals either side show only part
   *  of theirs. */
  private makeLabel(code: string, parent: SVGGElement) {
    const G = this.G;
    const g = el('g', { class: 'seg-label' }, parent);
    // Down the arc, top to bottom, a little inside its middle line so the
    // letters sit centred across the ring.
    const r = (G.R + G.rIn) / 2 - LABEL_SIZE * 0.35;
    const [x0, y0] = this.polar(r, -G.seg / 2), [x1, y1] = this.polar(r, G.seg / 2);
    const id = `wheel-label-${this.clips++}`;
    el('path', { id, d: `M${x0.toFixed(1)} ${y0.toFixed(1)}A${r} ${r} 0 0 1 ${x1.toFixed(1)} ${y1.toFixed(1)}`, fill: 'none' }, el('defs', {}, g));
    const text = el('text', { class: 'seg-n', 'text-anchor': 'middle' }, g);
    const on = el('textPath', { href: `#${id}`, startOffset: '50%' }, text);
    // In capitals here, not by CSS, which Safari doesn't always apply on a path.
    on.textContent = `ES Goal ${code.replace(/^ES\./, '')}`.toUpperCase();
    return g;
  }
  /** A goal's targets' icons along its arc, drawn about three o'clock and
   *  turned with it: evenly spaced, each moved off the middle of the ring
   *  and turned a little at random, never the same as the one before, and
   *  cut off at the arc's edges. */
  private makeMarks(i: number, parent: SVGGElement) {
    const G = this.G;
    // The arc's own shape about three o'clock, which turns with the icons.
    const clip = `wheel-clip-${this.clips++}`;
    el('path', { d: this.arcPath(G.rIn, G.R, -G.seg / 2 + 0.4, G.seg / 2 - 0.4) }, el('clipPath', { id: clip }, parent));
    const marks = el('g', { class: 'seg-marks', 'aria-hidden': 'true', 'clip-path': `url(#${clip})` }, parent);
    const ids = this.goals[i].targets.filter((t) => t.icon).map((t) => t.id);
    if (!ids.length) return marks;
    const rnd = seeded(i + 1);
    const rm = (G.R + G.rIn) / 2;
    // Along the arc, px, to its ends; half a gap either side of the middle.
    const half = (rm * G.seg * Math.PI) / 360 + MARK_SIZE / 2;
    let last = '';
    for (let s = MARK_GAP / 2; s <= half; s += MARK_GAP) {
      for (const along of [-s, s]) {
        const radial = rm + (rnd() - 0.5) * RING * 0.6;
        const tilt = (rnd() - 0.5) * 60;
        const pick = ids.length > 1 ? ids.filter((id) => id !== last) : ids;
        last = pick[Math.floor(rnd() * pick.length)];
        const deg = (along / rm) * (180 / Math.PI);
        const [x, y] = this.polar(radial, deg);
        el('use', { href: `#wheel-icon-${last}`, x: -MARK_SIZE / 2, y: -MARK_SIZE / 2, width: MARK_SIZE, height: MARK_SIZE, transform: `translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${(deg + tilt).toFixed(1)})` }, marks);
      }
    }
    return marks;
  }

  /** Turn to a goal, the short way round, and mark a target on it (or none),
   *  `done` of its three tabs along. */
  show(goal: number, target: string | null, done = 0) {
    this.done = target ? done : 0;
    const first = !this.shown;
    const turning = goal !== this.goal;
    this.shown = true;
    this.goal = goal;
    this.target = target;
    // The first time, straight there: an address can open on any goal.
    if (first) (this.pos = goal), this.place();
    else if (turning) this.turnTo(this.nearest(goal));
    else this.place();
  }
  /** The nearest turn that puts goal i under three o'clock. */
  private nearest(i: number) {
    const p = Math.round(this.pos);
    let best: number | null = null;
    for (let n = p - 3; n <= p + 3; n++) if (this.mod(n) === i && (best === null || Math.abs(n - this.pos) < Math.abs(best - this.pos))) best = n;
    return best ?? p;
  }
  private turnTo(to: number) {
    cancelAnimationFrame(this.spin);
    const from = this.pos, t0 = performance.now(), dur = this.reduce.matches ? 0 : TURN;
    const frame = (now: number) => {
      const x = dur ? Math.min(1, (now - t0) / dur) : 1;
      this.pos = from + (to - from) * ease(x);
      this.place();
      if (x < 1) this.spin = requestAnimationFrame(frame);
    };
    frame(t0);
  }

  // ---- Turning it by hand ----------------------------------------------------
  private gestures() {
    // A drag turns the ring; let go and it settles on the nearest goal. A
    // press that hardly moves is a click on whatever it was on.
    let drag: { a0: number; p0: number; moved: number; target: Element } | null = null;
    const angleAt = (e: PointerEvent) => (Math.atan2(e.clientY - this.G.cy, e.clientX - this.G.cx) * 180) / Math.PI;
    this.svg.addEventListener('pointerdown', (e) => {
      const t = e.target as Element;
      if (!t.closest('.ring')) return;
      cancelAnimationFrame(this.spin);
      drag = { a0: angleAt(e), p0: this.pos, moved: 0, target: t };
      this.svg.setPointerCapture(e.pointerId);
    });
    this.svg.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const da = angleAt(e) - drag.a0;
      drag.moved = Math.max(drag.moved, Math.abs(da));
      this.pos = drag.p0 - da / this.G.seg;
      this.place();
    });
    const release = () => {
      if (!drag) return;
      const d = drag;
      drag = null;
      if (d.moved < 1) {
        const chip = d.target.closest<SVGGElement>('[data-target]');
        if (chip) return this.on.target(chip.dataset.target!);
        const seg = d.target.closest<SVGGElement>('[data-goal]');
        if (seg) return this.on.goal(Number(seg.dataset.goal));
      }
      const i = this.mod(Math.round(this.pos));
      if (i === this.goal) this.turnTo(Math.round(this.pos));
      else this.on.goal(i);
    };
    this.svg.addEventListener('pointerup', release);
    this.svg.addEventListener('pointercancel', release);
    // Keys on a goal or a chip.
    this.svg.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const t = e.target as Element;
      const chip = t.closest<SVGGElement>('[data-target]');
      const seg = t.closest<SVGGElement>('[data-goal]');
      if (!chip && !seg) return;
      e.preventDefault();
      if (chip) this.on.target(chip.dataset.target!);
      else this.on.goal(Number(seg!.dataset.goal));
    });
    // A scroll over the ring is the page's to handle: it steps along the
    // path like the arrows (CyclePage.astro).
  }
}
