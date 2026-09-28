/** The network: a way through the map's layers with no tree to climb. It
 *  opens on a few maps to start from; picking one puts it on the map and
 *  opens a circle round it, cut in three -- Life, Pressures, Protection --
 *  each third holding the maps linked to it in that way. Tapping one of
 *  those lays it over the focus, which stays on underneath, with a slider
 *  for how clear it is -- where the two fall together is what shows; it
 *  goes no deeper. Focus redraws the circle round it. A
 *  trail above the circle steps back. Touching the map shrinks the circle
 *  into the top right corner, and a tap there brings it back.
 *
 *  Which map is in which third, and what links to what, is
 *  map/content/connections.json. A map with no links of its own borrows
 *  those of a linked map beside it in the layer list (same subtheme, then
 *  same theme, then the first start of its kind) until it has some. */

export type NetLayer = {
  id: string;
  name: string;
  theme: string;
  subtheme: string;
  kind: 'classes' | 'categories' | 'continuous';
  legend: { colour: string; label: string }[];
};
export type NetConfig = {
  roles: Record<string, { name: string; colour: string; layers: string[] }>;
  /** Each map's name as short as it reads in a chip. */
  names: Record<string, string>;
  starts: string[];
  links: Record<string, Record<string, string[]>>;
};

/** At most this many maps in a third: more will not fit on a phone. */
const PER = 4;

/** A line on each of the three groups, for the card that explains the
 *  network. By the role ids in connections.json. */
const ROLE_LINES: Record<string, string> = {
  life: 'the animals and the land that it exists alongside',
  pressures: 'what pressures it, from roads and towns to wildfire',
  protection: 'what protects it, from protected areas and corridors, to climate refugia',
};

/** How big the circle is when shrunk into the corner. */
const MINI = 0.25;

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export function network(opts: {
  root: HTMLElement;
  button: HTMLElement;
  layers: NetLayer[];
  net: NetConfig;
  /** The maps on the map: the focus, underneath, and the one laid over it
   *  (or none). */
  show: (focus: string, overlay: string | undefined) => void;
  /** Told which view is up whenever it is drawn: the start card, the circle
   *  or the circle shrunk. */
  onView?: (view: 'start' | 'ring' | 'mini') => void;
  /** Told when the network is switched on or off. */
  onToggle: (on: boolean) => void;
}) {
  const { root, button, net } = opts;
  const byId = new Map(opts.layers.map((l) => [l.id, l]));
  const roles = Object.keys(net.roles);
  const roleOf = new Map(roles.flatMap((r) => net.roles[r].layers.map((id) => [id, r] as const)));
  /** A map's colour here is its third's, not its own: many layers' strongest
   *  colour is too dark to see as a dot. */
  const short = (id: string) => net.names[id] ?? byId.get(id)!.name;
  const colourOf = (id: string) => net.roles[roleOf.get(id) ?? roles[0]].colour;

  /** The maps in each third round `id`, the map itself left out. */
  const linksOf = (id: string): Record<string, string[]> => {
    const l = byId.get(id)!;
    const near = [
      ...opts.layers.filter((o) => o.subtheme === l.subtheme),
      ...opts.layers.filter((o) => o.theme === l.theme),
      ...net.starts.filter((s) => roleOf.get(s) === roleOf.get(id)).map((s) => byId.get(s)!),
      byId.get(net.starts[0])!,
    ];
    const from = net.links[id] ?? net.links[near.find((o) => net.links[o.id])!.id];
    return Object.fromEntries(roles.map((r) => [r, (from[r] ?? []).filter((o) => o !== id && byId.has(o)).slice(0, PER)]));
  };

  /** A point on the circle: `r` out from the middle, `a` degrees clockwise
   *  from the top, in the drawings' units. */
  const at = (r: number, a: number) => `${(r * Math.sin((a * Math.PI) / 180)).toFixed(2)} ${(-r * Math.cos((a * Math.PI) / 180)).toFixed(2)}`;

  // Laid out once; the parts filled in as they change.
  root.innerHTML =
    // First, how it works, in a few lines, and the maps to start from at the
    // foot of the card.
    `<div class="net-start" role="dialog" aria-labelledby="net-start-title">` +
    `<button class="net-start-close" type="button" aria-label="Close">` +
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg></button>` +
    `<p class="eyebrow">Explore by connections</p>` +
    `<h2 id="net-start-title">Start from one map and follow what it touches</h2>` +
    `<p>The map you pick here becomes the Focus Map. Surrounding it are three segments, each with maps which are connected to the Focus Map in one of three ways:</p>` +
    `<ul class="net-roles">` +
    roles
      .map((r) => `<li><i style="background:${net.roles[r].colour}"></i><b>${esc(net.roles[r].name)}</b> ${esc(ROLE_LINES[r] ?? '')}</li>`)
      .join('') +
    `</ul>` +
    `<p>Choose one of the entry points below to get started. When looking at a connected map, you can tap the 'Focus' button to make it the new Focus Map and reveal it's unique connections. Step back through the network anytime with the breadcrumbs.</p>` +
    `<p class="eyebrow net-start-pick">Start with</p><div class="net-starts"></div></div>` +
    `<div class="net-ring">` +
    `<nav class="net-trail" aria-label="Maps focused so far"></nav>` +
    `<div class="net-disc">${disc()}${arc()}<div class="net-thirds"></div><button class="net-hub" type="button"></button></div>` +
    `<div class="net-bar"></div>` +
    `</div>`;
  const startEl = root.querySelector<HTMLElement>('.net-start')!;
  const startsEl = root.querySelector<HTMLElement>('.net-starts')!;
  root.querySelector('.net-start-close')!.addEventListener('click', () => toggle(false));
  const ringEl = root.querySelector<HTMLElement>('.net-ring')!;
  const trailEl = root.querySelector<HTMLElement>('.net-trail')!;
  const thirdsEl = root.querySelector<HTMLElement>('.net-thirds')!;
  const hubEl = root.querySelector<HTMLButtonElement>('.net-hub')!;
  const barEl = root.querySelector<HTMLElement>('.net-bar')!;
  const discEl = root.querySelector<HTMLElement>('.net-disc')!;
  const arcEl = root.querySelector<SVGSVGElement>('.net-arc')!;
  const arcText = root.querySelector<SVGTextPathElement>('.net-arc textPath')!;


  /** The trail, round the outside of the circle over the top: a path for
   *  it to run along, in a drawing a little bigger than the circle's. The
   *  same trail is in the page as buttons too, for a keyboard or a screen
   *  reader (.net-trail, shown when a key reaches it). */
  const ARC_R = 109;
  function arc() {
    return (
      `<svg class="net-arc" viewBox="-120 -120 240 240" aria-hidden="true">` +
      `<path id="net-arc-path" fill="none" />` +
      `<text><textPath href="#net-arc-path" startOffset="50%" text-anchor="middle"></textPath></text></svg>`
    );
  }
  /** Its words the same size on the screen however big the circle is. */
  const sizeArc = () => {
    const d = discEl.offsetWidth;
    if (d) arcEl.querySelector('text')!.setAttribute('font-size', String(2500 / d));
  };
  /** Each third's chips placed inside their piece of the circle: clear of
   *  the rim, of the middle and of the other thirds. Names differ too much in
   *  length for one layout to fit every focus on every screen, so each third
   *  tries a few -- set in or out along its middle line, packed wider or
   *  narrower, the words a little smaller -- and keeps the first that fits
   *  (or the last, if none does). */
  const PLACES = (() => {
    const out: { t: number; w: number; k: number }[] = [];
    for (const k of [1, 0.92, 0.84, 0.76, 0.7])
      for (const w of [1, 0.85, 1.15, 1.3])
        for (const t of [0.6, 0.64, 0.56, 0.68, 0.72]) out.push({ t, w, k });
    return out;
  })();
  // Measured by layout, not on the screen, so a circle still growing or
  // shrinking measures the same as one at rest.
  const fit = () => {
    const size = discEl.offsetWidth;
    if (!size || view === 'start') return;
    const cx = size / 2;
    const cy = size / 2;
    const rim = (size / 2) * 0.96;
    const hub = hubEl.offsetWidth / 2 + 4;
    thirdsEl.querySelectorAll<HTMLElement>('.net-set').forEach((set, i) => {
      const mid = i * 120;
      // A chip, or the third's name (its words, not the full-width line
      // it sits on), as a box in the circle's own px.
      const boxes = () =>
        [...set.querySelectorAll<HTMLElement>('.net-chip, .net-name > span, .net-none')].map((c) => {
          const x = set.offsetLeft - set.offsetWidth / 2 + c.offsetLeft;
          const y = set.offsetTop - set.offsetHeight / 2 + c.offsetTop;
          return { left: x, top: y, right: x + c.offsetWidth, bottom: y + c.offsetHeight };
        });
      // How many px the boxes stray out of the third, all told.
      const stray = () =>
        boxes().reduce((sum, q) => {
          // Corners and the middles of the sides: a side can cross the
          // round middle with all four corners clear of it.
          const mx = (q.left + q.right) / 2;
          const my = (q.top + q.bottom) / 2;
          const points = [[q.left, q.top], [q.right, q.top], [q.left, q.bottom], [q.right, q.bottom], [mx, q.top], [mx, q.bottom], [q.left, my], [q.right, my]];
          return sum + points.reduce((s2, [x, y]) => {
            const dx = x - cx;
            const dy = y - cy;
            const r = Math.hypot(dx, dy);
            const a = ((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360;
            const off = Math.abs(((a - mid + 540) % 360) - 180);
            // Past the line between thirds, less a few px for the gap drawn there.
            const across = r * Math.sin(((off - 60) * Math.PI) / 180) + 2;
            return s2 + Math.max(0, r - rim) + Math.max(0, hub - r) + Math.max(0, across);
          }, 0);
        }, 0);
      const a = (mid * Math.PI) / 180;
      const place = (p: (typeof PLACES)[number]) => {
        set.style.left = `${50 + 50 * p.t * Math.sin(a)}%`;
        set.style.top = `${50 - 50 * p.t * Math.cos(a)}%`;
        set.style.setProperty('--w', String(p.w));
        set.style.setProperty('--k', String(p.k));
      };
      let best = PLACES[0];
      let least = Infinity;
      for (const p of PLACES) {
        place(p);
        const out = stray();
        if (out < least) [best, least] = [p, out];
        if (out === 0) return;
      }
      place(best);
    });
  };

  /** The trail round the rim: Start and as many of the last steps as fit
   *  along it, the ones before them an ellipsis. */
  const drawArc = () => {
    const path = arcEl.querySelector<SVGPathElement>('path')!;
    const text = arcEl.querySelector<SVGTextElement>('text')!;
    // Round the top, but no further down the sides than the screen is wide.
    // By layout: the circle is always in the middle of the screen's width.
    const px = discEl.offsetWidth / 200;
    if (!px) return;
    // Clear of the edge by more than the words' height: they tip down the
    // sides at the ends.
    const edge = root.clientWidth / 2 - 28;
    const span = Math.min(72, (Math.asin(Math.min(1, edge / (ARC_R * px))) * 180) / Math.PI);
    path.setAttribute('d', `M${at(ARC_R, -span)} A${ARC_R} ${ARC_R} 0 0 1 ${at(ARC_R, span)}`);
    const room = path.getTotalLength();
    for (let from = 0; from < trail.length; from++) {
      arcText.innerHTML =
        `<tspan data-step="-1">Start</tspan>` +
        (from ? `<tspan class="sep"> › …</tspan>` : '') +
        trail
          .slice(from)
          .map((id, j) => {
            const i = from + j;
            return `<tspan class="sep"> › </tspan><tspan data-step="${i}"${i === trail.length - 1 ? ' class="here"' : ''}>${esc(short(id))}</tspan>`;
          })
          .join('');
      // With some to spare: glyphs past the path's end are not drawn at all.
      if (text.getComputedTextLength() <= room * 0.92) return;
    }
  };

  /** The circle's three thirds and their rims, clockwise from the top. */
  function disc() {
    const R = 99;
    const IN = 25;
    const GAP = 1.2;
    return (
      `<svg class="net-face" viewBox="-100 -100 200 200" aria-hidden="true">` +
      roles
        .map((r, i) => {
          const a0 = -60 + i * 120 + GAP;
          const a1 = a0 + 120 - 2 * GAP;
          const c = net.roles[r].colour;
          return (
            `<path class="net-third" d="M${at(R, a0)} A${R} ${R} 0 0 1 ${at(R, a1)} L${at(IN, a1)} A${IN} ${IN} 0 0 0 ${at(IN, a0)}Z" fill="${c}" />` +
            `<path class="net-rim" d="M${at(R - 2, a0)} A${R - 2} ${R - 2} 0 0 1 ${at(R - 2, a1)}" stroke="${c}" />`
          );
        })
        .join('') +
      `</svg>`
    );
  }

  let on = false;
  let view: 'start' | 'ring' | 'mini' = 'start';
  /** The maps focused so far, the one in the middle last. */
  let trail: string[] = [];
  /** The link laid over the focus, if one is. The focus is always on,
   *  underneath it. */
  let overlay: string | undefined;
  /** Drawn round a map without putting it on (focus's `preview`): the wheel
   *  as an example, until something on it is picked. */
  let previewing = false;

  const chip = (id: string, cls = '') => {
    const l = byId.get(id)!;
    return (
      `<button type="button" class="net-chip${cls}" data-id="${esc(id)}" aria-pressed="${id === overlay}">` +
      `<i style="background:${colourOf(id)}"></i><span>${esc(short(id))}</span></button>`
    );
  };

  function render(fresh = false) {
    opts.onView?.(view);
    root.dataset.view = view;
    startEl.hidden = view !== 'start';
    ringEl.hidden = view === 'start';
    ringEl.classList.toggle('mini', view === 'mini');
    // Shrunk, the whole circle is the one button that opens it again.
    if (view === 'mini') {
      discEl.setAttribute('role', 'button');
      discEl.tabIndex = 0;
      discEl.setAttribute('aria-label', `Open the network: ${short(trail.at(-1)!)}`);
    } else {
      discEl.removeAttribute('role');
      discEl.removeAttribute('tabindex');
      discEl.removeAttribute('aria-label');
    }
    startsEl.innerHTML = net.starts.map((id) => chip(id)).join('');

    const focus = trail.at(-1);
    if (!focus) return;
    const fl = byId.get(focus)!;
    const links = linksOf(focus);
    // Clockwise from the top, as the circle's thirds are drawn.
    thirdsEl.innerHTML = roles
      .map(
        (r, i) =>
          `<div class="net-set net-set-${i}" role="group" aria-label="${esc(net.roles[r].name)}" style="--c:${net.roles[r].colour}">` +
          `<span class="net-name"><span>${esc(net.roles[r].name)}</span></span>` +
          (links[r].length ? links[r].map((id) => chip(id)).join('') : `<span class="net-none">Nothing on the same ground</span>`) +
          `</div>`,
      )
      .join('');
    thirdsEl.classList.toggle('fresh', fresh);
    hubEl.style.setProperty('--c', colourOf(focus));
    hubEl.setAttribute('aria-pressed', String(!overlay && !previewing));
    hubEl.innerHTML = `<span class="net-which">Focus</span><b>${esc(short(focus))}</b>`;
    hubEl.classList.toggle('fresh', fresh);

    trailEl.innerHTML =
      `<button type="button" data-step="-1">Start</button>` +
      trail
        .map((id, i) => {
          const last = i === trail.length - 1;
          return `<span aria-hidden="true">›</span><button type="button" data-step="${i}"${last ? ' aria-current="true"' : ''}>${esc(short(id))}</button>`;
        })
        .join('');
    sizeArc();
    drawArc();
    fit();

    barEl.innerHTML =
      `<span class="net-showing"><i style="background:${colourOf(overlay ?? focus)}"></i><span><span class="net-which">On the map</span>` +
      (overlay ? `${esc(short(overlay))} over ${esc(short(focus))}` : esc(byId.get(focus)!.name)) +
      `</span></span>` +
      (overlay ? `<button type="button" class="chip net-focus">Focus</button>` : '');
  }

  /** The page told what should be on: the focus, and over it the overlay. */
  const apply = () => {
    previewing = false;
    opts.show(trail.at(-1)!, overlay);
  };

  /** Round a map, the circle open. `back` is a step back down the trail. */
  const focusOn = (id: string, back = false) => {
    if (back) trail = trail.slice(0, trail.indexOf(id) + 1);
    else trail = [...trail.filter((t) => t !== id), id];
    overlay = undefined;
    apply();
    view = 'ring';
    render(true);
  };

  startsEl.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('.net-chip');
    if (b) {
      trail = [];
      focusOn(b.dataset.id!);
    }
  });
  thirdsEl.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('.net-chip');
    if (!b) return;
    // Laid over the focus; tapped again, taken off.
    overlay = overlay === b.dataset.id ? undefined : b.dataset.id;
    apply();
    render();
  });
  hubEl.addEventListener('click', () => {
    overlay = undefined;
    apply();
    render();
  });
  /** A step of the trail taken: back to the start, or to a focus before. */
  const step = (i: number) => {
    if (i < 0) {
      view = 'start';
      render();
    } else if (i < trail.length - 1) focusOn(trail[i], true);
  };
  trailEl.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('button[data-step]');
    if (b) step(Number(b.dataset.step));
  });
  /** The step of the trail under a point on the screen, if any. Worked out
   *  from the letter there rather than left to the browser: Safari does not
   *  hit-test text laid along a path, so a tap on it lands on what is under. */
  const stepAt = (x: number, y: number) => {
    const text = arcEl.querySelector<SVGTextElement>('text')!;
    const m = text.getScreenCTM();
    if (!m) return null;
    const pt = new DOMPoint(x, y).matrixTransform(m.inverse());
    const at = text.getCharNumAtPosition(pt as unknown as DOMPointInit & SVGPoint);
    if (at < 0) return null;
    let n = 0;
    for (const t of arcText.querySelectorAll('tspan')) {
      n += t.textContent!.length;
      if (at < n) return t.hasAttribute('data-step') ? t : null;
    }
    return null;
  };
  ringEl.addEventListener('click', (e) => {
    if (view !== 'ring') return;
    const t = stepAt(e.clientX, e.clientY);
    if (t) step(Number(t.getAttribute('data-step')));
    // The ring's own empty room round the circle and its bar is the map, as
    // far as a tap goes: put the circle away, as a tap on the map does.
    else if (e.target === ringEl) collapse();
  });
  // The hand, and the step lit, over a step that can be taken.
  let lit: Element | null = null;
  ringEl.addEventListener('pointermove', (e) => {
    const t = view === 'ring' && e.pointerType === 'mouse' ? stepAt(e.clientX, e.clientY) : null;
    const can = t && !t.classList.contains('here') ? t : null;
    if (can === lit) return;
    lit?.classList.remove('lit');
    can?.classList.add('lit');
    lit = can;
    ringEl.style.cursor = can ? 'pointer' : '';
  });
  addEventListener('resize', () => {
    sizeArc();
    if (trail.length) drawArc();
    fit();
  });
  barEl.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    if (t.closest('.net-focus') && overlay) focusOn(overlay);
  });
  const reopen = () => {
    view = 'ring';
    render();
  };
  discEl.addEventListener('click', (e) => {
    if (view !== 'mini') return;
    e.stopPropagation();
    reopen();
  });
  // With a mouse, resting on the shrunk circle opens it -- after a moment,
  // so passing over the corner on the way elsewhere doesn't.
  let hover: ReturnType<typeof setTimeout> | undefined;
  discEl.addEventListener('pointerenter', (e) => {
    if (view !== 'mini' || e.pointerType !== 'mouse') return;
    hover = setTimeout(() => view === 'mini' && reopen(), 180);
  });
  discEl.addEventListener('pointerleave', () => clearTimeout(hover));
  discEl.addEventListener('keydown', (e) => {
    if (view === 'mini' && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      reopen();
    }
  });

  /** Where the circle goes to shrink: its top right corner to the map's,
   *  under the attribution button. From where it sits unshrunk, read off
   *  the layout (its box in the ring), which no move or shrink -- made,
   *  or still gliding -- touches. */
  const corner = () => {
    const ring = ringEl.getBoundingClientRect();
    const host = root.getBoundingClientRect();
    const left = ring.left + discEl.offsetLeft;
    const top = ring.top + discEl.offsetTop;
    // Clear of the control column where it runs to the top (a phone on its side).
    const right = parseFloat(getComputedStyle(root).getPropertyValue('--mini-right')) || 12;
    discEl.style.setProperty('--mx', `${host.right - right - (left + discEl.offsetWidth)}px`);
    discEl.style.setProperty('--my', `${host.top + 40 - top}px`);
    discEl.style.setProperty('--s', String(MINI));
  };
  addEventListener('resize', () => view === 'mini' && corner());

  /** The circle out of the way, to look at the map: while the map is being
   *  handled, or when anything else opens over it. */
  function collapse() {
    if (!on || view !== 'ring') return;
    corner();
    view = 'mini';
    render();
  }

  const toggle = (want: boolean) => {
    if (want === on) return;
    on = want;
    root.hidden = !on;
    button.setAttribute('aria-pressed', String(on));
    if (on) {
      view = 'start';
      trail = [];
      overlay = undefined;
      render();
    }
    opts.onToggle(on);
  };
  button.addEventListener('click', () => toggle(!on));
  addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !on) return;
    if (view === 'ring') collapse();
    else if (view === 'start' && trail.length) reopen();
  });

  /** A map picked some other way -- the layers list or its search -- while
   *  the network is out: put on as the one it shows and the circle redrawn
   *  round it, left shrunk if it was -- or opened, with `open` (a map picked
   *  from the web, to go on from). With `preview`, the wheel is drawn round
   *  it but nothing is put on the map until a map on it is picked (the
   *  landing's example). */
  const focus = (id: string, open = false, preview = false) => {
    if (!on || !byId.has(id)) return;
    trail = [...trail.filter((t) => t !== id), id];
    overlay = undefined;
    if (preview) previewing = true;
    else apply();
    if (open || view !== 'mini') view = 'ring';
    render(true);
  };

  /** On, at the start card -- or back to it, if already on. */
  const enter = () => {
    if (!on) return toggle(true);
    view = 'start';
    render();
  };

  /** Begun afresh from a map: it alone on the trail, as the focus, nothing
   *  laid over it, the circle open (a start map picked). */
  const begin = (id: string) => {
    if (!on || !byId.has(id)) return;
    trail = [];
    focusOn(id);
  };

  return { collapse, focus, begin, enter, startCard: startEl, active: () => on, off: () => toggle(false) };
}
