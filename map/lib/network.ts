/** The network: a way through the map's layers with no tree to climb. It
 *  opens on a few maps to start from; picking one puts it on the map and
 *  opens a circle round it, cut in three -- Life, Pressures, Protection --
 *  each third holding the maps linked to it in that way. Tapping one of
 *  those shows it and goes no deeper; Focus redraws the circle round it. A
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

/** How big the circle is when shrunk into the corner. */
const MINI = 0.25;

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export function network(opts: {
  root: HTMLElement;
  button: HTMLElement;
  layers: NetLayer[];
  net: NetConfig;
  /** Put this map on in place of the one the network last put on. */
  show: (id: string) => void;
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

  // Laid out once; the parts filled in as they change.
  root.innerHTML =
    `<div class="net-start" role="group" aria-labelledby="net-start-title">` +
    `<p class="eyebrow" id="net-start-title">Start with a map</p><div class="net-starts"></div></div>` +
    `<div class="net-ring">` +
    `<nav class="net-trail" aria-label="Maps focused so far"></nav>` +
    `<div class="net-disc">${disc()}<div class="net-thirds"></div><button class="net-hub" type="button"></button></div>` +
    `<div class="net-bar"></div>` +
    `</div>`;
  const startEl = root.querySelector<HTMLElement>('.net-start')!;
  const startsEl = root.querySelector<HTMLElement>('.net-starts')!;
  const ringEl = root.querySelector<HTMLElement>('.net-ring')!;
  const trailEl = root.querySelector<HTMLElement>('.net-trail')!;
  const thirdsEl = root.querySelector<HTMLElement>('.net-thirds')!;
  const hubEl = root.querySelector<HTMLButtonElement>('.net-hub')!;
  const barEl = root.querySelector<HTMLElement>('.net-bar')!;
  const discEl = root.querySelector<HTMLElement>('.net-disc')!;

  /** The circle's three thirds and their rims, clockwise from the top. */
  function disc() {
    const at = (r: number, a: number) => `${(r * Math.sin((a * Math.PI) / 180)).toFixed(2)} ${(-r * Math.cos((a * Math.PI) / 180)).toFixed(2)}`;
    const R = 99;
    const IN = 25;
    const GAP = 1.2;
    return (
      `<svg viewBox="-100 -100 200 200" aria-hidden="true">` +
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
  /** The map on the map now: the focus, or one of its links. */
  let shown: string | undefined;

  const chip = (id: string, cls = '') => {
    const l = byId.get(id)!;
    return (
      `<button type="button" class="net-chip${cls}" data-id="${esc(id)}" aria-pressed="${id === shown}">` +
      `<i style="background:${colourOf(id)}"></i><span>${esc(short(id))}</span></button>`
    );
  };

  function render(fresh = false) {
    root.dataset.view = view;
    startEl.hidden = view !== 'start';
    ringEl.hidden = view === 'start';
    ringEl.classList.toggle('mini', view === 'mini');
    // Shrunk, the whole circle is the one button that opens it again.
    if (view === 'mini') {
      discEl.setAttribute('role', 'button');
      discEl.tabIndex = 0;
      discEl.setAttribute('aria-label', `Open the network: ${short(shown ?? trail.at(-1)!)}`);
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
          `<span class="net-name">${esc(net.roles[r].name)}</span>` +
          (links[r].length ? links[r].map((id) => chip(id)).join('') : `<span class="net-none">Nothing on the same ground</span>`) +
          `</div>`,
      )
      .join('');
    thirdsEl.classList.toggle('fresh', fresh);
    hubEl.style.setProperty('--c', colourOf(focus));
    hubEl.setAttribute('aria-pressed', String(shown === focus));
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

    const sl = byId.get(shown ?? focus)!;
    barEl.innerHTML =
      `<span class="net-showing"><i style="background:${colourOf(sl.id)}"></i><span><span class="net-which">On the map</span>${esc(sl.name)}</span></span>` +
      (shown && shown !== focus ? `<button type="button" class="chip net-focus">Focus</button>` : '') +
      `<button type="button" class="net-hide" aria-label="Put the circle away">` +
      `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg></button>`;
  }

  const showMap = (id: string) => {
    shown = id;
    opts.show(id);
  };

  /** Round a map, the circle open. `back` is a step back down the trail. */
  const focusOn = (id: string, back = false) => {
    if (back) trail = trail.slice(0, trail.indexOf(id) + 1);
    else trail = [...trail.filter((t) => t !== id), id];
    showMap(id);
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
    showMap(b.dataset.id!);
    render();
  });
  hubEl.addEventListener('click', () => {
    showMap(trail.at(-1)!);
    render();
  });
  trailEl.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('button[data-step]');
    if (!b) return;
    const i = Number(b.dataset.step);
    if (i < 0) {
      view = 'start';
      render();
    } else if (i < trail.length - 1) focusOn(trail[i], true);
  });
  barEl.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    if (t.closest('.net-focus') && shown) focusOn(shown);
    else if (t.closest('.net-hide')) collapse();
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
  discEl.addEventListener('keydown', (e) => {
    if (view === 'mini' && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      reopen();
    }
  });

  /** Where the circle goes to shrink: its top right corner to the map's,
   *  under the attribution button. From where it sits unshrunk, which is
   *  where it sits now less the move already made. */
  const corner = () => {
    const r = discEl.getBoundingClientRect();
    const host = root.getBoundingClientRect();
    const dx = parseFloat(discEl.style.getPropertyValue('--mx')) || 0;
    const dy = parseFloat(discEl.style.getPropertyValue('--my')) || 0;
    discEl.style.setProperty('--mx', `${host.right - 12 - (r.right - dx)}px`);
    discEl.style.setProperty('--my', `${host.top + 40 - (r.top - dy)}px`);
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
      shown = undefined;
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

  return { collapse, active: () => on, off: () => toggle(false) };
}
