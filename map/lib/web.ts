/** The web: every map round one circle, in its third's colour -- Life, then
 *  Pressures, then Protection -- and a line between each two the network
 *  links (map/content/connections.json), so the whole weave of connections
 *  shows at once. Pointing at a map lights its lines and the maps at their
 *  other ends; picking one hands it on (to the network, as its middle). */

export type WebLayer = { id: string; name: string };
export type WebNet = {
  roles: Record<string, { name: string; colour: string; layers: string[] }>;
  names: Record<string, string>;
  links: Record<string, Record<string, string[]>>;
};

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** The drawing's size, in its own units: the circle the maps sit on, and
 *  room round it for their names. */
const R = 170;
const VIEW = 300;
/** The gap between one third and the next, in degrees. */
const GAP = 7;

export function web(opts: { layers: WebLayer[]; net: WebNet; onPick: (id: string) => void }) {
  const { net } = opts;
  const byId = new Map(opts.layers.map((l) => [l.id, l]));
  const roles = Object.keys(net.roles);
  // Round the circle clockwise from the top, a third's maps together, in
  // the order the layer list has them.
  const order = roles.flatMap((r) => opts.layers.filter((l) => net.roles[r].layers.includes(l.id)).map((l) => ({ l, r })));
  const n = order.length;
  const step = (360 - GAP * roles.length) / n;
  const angle = new Map<string, number>();
  let a = GAP / 2;
  let last = order[0]?.r;
  for (const { l, r } of order) {
    if (r !== last) a += GAP;
    last = r;
    angle.set(l.id, a);
    a += step;
  }
  const at = (deg: number, r: number) => {
    const t = ((deg - 90) * Math.PI) / 180;
    return [r * Math.cos(t), r * Math.sin(t)] as const;
  };
  /** A map's slice of the ring, from just inside its dot out to `out`: what
   *  takes the pointer, so a map is easy to hit, not only its thin name. */
  const wedge = (deg: number, out: number) => {
    const a0 = deg - step / 2;
    const a1 = deg + step / 2;
    const r0 = R - 12;
    const p = (a: number, r: number) => at(a, r).map((v) => v.toFixed(1)).join(' ');
    return `M${p(a0, r0)} L${p(a0, out)} A${out} ${out} 0 0 1 ${p(a1, out)} L${p(a1, r0)} A${r0} ${r0} 0 0 0 ${p(a0, r0)} Z`;
  };
  const colourOf = new Map(order.map(({ l, r }) => [l.id, net.roles[r].colour]));

  // Each pair linked, once, whichever way the link was made: the weave
  // drawn faint behind. A map's own connections, though, are its own list
  // only, as the network shows them -- a map that lists this one without
  // being on its list is not counted or lit for it (most links are listed
  // one way only: each map names what bears on it).
  const pairs = new Map<string, [string, string]>();
  const touches = new Map<string, Set<string>>(order.map(({ l }) => [l.id, new Set<string>()]));
  for (const [id, by] of Object.entries(net.links))
    for (const other of Object.values(by).flat()) {
      if (!angle.has(id) || !angle.has(other) || id === other) continue;
      const key = [id, other].sort().join('|');
      if (!pairs.has(key)) pairs.set(key, [id, other]);
      touches.get(id)!.add(other);
    }

  const lines = [...pairs.values()]
    .map(([p, q]) => {
      const [x1, y1] = at(angle.get(p)!, R);
      const [x2, y2] = at(angle.get(q)!, R);
      // Bowed in towards the middle, the more the further apart they are.
      return `<path class="web-line" data-a="${esc(p)}" data-b="${esc(q)}" d="M${x1.toFixed(1)} ${y1.toFixed(1)} Q0 0 ${x2.toFixed(1)} ${y2.toFixed(1)}" />`;
    })
    .join('');
  const nodes = order
    .map(({ l }) => {
      const deg = angle.get(l.id)!;
      const [x, y] = at(deg, R);
      const [tx, ty] = at(deg, R + 9);
      // Names read outwards, and the right way up on the left side.
      const left = deg > 180;
      const rot = left ? deg + 90 : deg - 90;
      const name = net.names[l.id] ?? l.name;
      return (
        `<g class="web-node" data-id="${esc(l.id)}" tabindex="0" role="button" aria-label="${esc(name)}: ${touches.get(l.id)!.size} connections">` +
        `<path class="web-hit" d="${wedge(deg, R + 70)}" fill="${colourOf.get(l.id)}" />` +
        `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3.6" fill="${colourOf.get(l.id)}" />` +
        `<text x="${tx.toFixed(1)}" y="${ty.toFixed(1)}" transform="rotate(${rot.toFixed(1)} ${tx.toFixed(1)} ${ty.toFixed(1)})" text-anchor="${left ? 'end' : 'start'}" dominant-baseline="middle">${esc(name)}</text>` +
        `</g>`
      );
    })
    .join('');
  // The thirds' names on arcs outside, over their maps.
  const arcs = roles
    .map((r) => {
      const ids = order.filter((o) => o.r === r).map((o) => angle.get(o.l.id)!);
      if (!ids.length) return '';
      const a0 = ids[0] - step / 2;
      const a1 = ids.at(-1)! + step / 2;
      const [x0, y0] = at(a0, R - 14);
      const [x1, y1] = at(a1, R - 14);
      return `<path class="web-arc" d="M${x0.toFixed(1)} ${y0.toFixed(1)} A${R - 14} ${R - 14} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1.toFixed(1)} ${y1.toFixed(1)}" stroke="${net.roles[r].colour}" />`;
    })
    .join('');

  const el = document.createElement('div');
  el.className = 'web';
  el.innerHTML =
    `<svg viewBox="${-VIEW} ${-VIEW} ${2 * VIEW} ${2 * VIEW}" role="group" aria-label="Every map and its connections">` +
    `<g class="web-lines">${lines}</g>${arcs}<g class="web-nodes">${nodes}</g>` +
    // The map pointed at, named in a pill in the middle, over the lines.
    `<g class="web-mid" visibility="hidden"><rect />` +
    `<text class="web-mid-name" x="0" y="-5" text-anchor="middle" dominant-baseline="middle"></text>` +
    `<text class="web-mid-count" x="0" y="11" text-anchor="middle" dominant-baseline="middle"></text></g>` +
    `</svg>`;
  const svg = el.querySelector('svg')!;
  const mid = el.querySelector<SVGGElement>('.web-mid')!;
  const midName = mid.querySelector<SVGTextElement>('.web-mid-name')!;
  const midCount = mid.querySelector<SVGTextElement>('.web-mid-count')!;
  const midBox = mid.querySelector('rect')!;

  /** The map picked, kept lit when the pointer moves off (the web over the
   *  map, where the pick is what is showing). */
  let picked: string | null = null;
  /** One map lit: its lines, and the maps at their ends; the rest dimmed. */
  const light = (id: string | null) => {
    svg.classList.toggle('lit', !!id);
    const near = id ? touches.get(id)! : new Set<string>();
    el.querySelectorAll<SVGElement>('.web-node').forEach((g) => {
      const me = g.dataset.id!;
      g.classList.toggle('on', me === id);
      g.classList.toggle('picked', me === picked);
      g.classList.toggle('near', near.has(me));
    });
    el.querySelectorAll<SVGElement>('.web-line').forEach((p) => {
      const on = !!id && (p.dataset.a === id || p.dataset.b === id) && near.has(p.dataset.a === id ? p.dataset.b! : p.dataset.a!);
      p.classList.toggle('on', on);
      // As a style: the sheet's own stroke would outrank an attribute.
      p.style.stroke = on ? colourOf.get(id!)! : '';
    });
    mid.setAttribute('visibility', id ? 'visible' : 'hidden');
    if (id) {
      midName.textContent = net.names[id] ?? byId.get(id)?.name ?? id;
      midCount.textContent = `${near.size} connection${near.size === 1 ? '' : 's'}`;
      // The pill round the wider of the two lines.
      const w = Math.max(midName.getComputedTextLength(), midCount.getComputedTextLength()) + 30;
      midBox.setAttribute('x', String(-w / 2));
      midBox.setAttribute('y', '-20');
      midBox.setAttribute('width', String(w));
      midBox.setAttribute('height', '42');
      midBox.setAttribute('rx', '21');
      midBox.style.stroke = colourOf.get(id) ?? '';
    }
  };
  const nodeOf = (e: Event) => (e.target as Element).closest<SVGElement>('.web-node');
  svg.addEventListener('pointerover', (e) => {
    const g = nodeOf(e);
    if (g) light(g.dataset.id!);
  });
  svg.addEventListener('pointerleave', () => light(picked));
  svg.addEventListener('focusin', (e) => {
    const g = nodeOf(e);
    if (g) light(g.dataset.id!);
  });
  svg.addEventListener('click', (e) => {
    const g = nodeOf(e);
    if (g) opts.onPick(g.dataset.id!);
  });
  svg.addEventListener('keydown', (e) => {
    const g = nodeOf(e);
    if (g && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      opts.onPick(g.dataset.id!);
    }
  });
  return Object.assign(el, {
    /** The drawing sized to its longest name, so it fills a round frame
     *  edge to edge: the names reach out along their radius, and the box
     *  round the farthest end is the circle the frame is. Needs the web on
     *  screen, where a name has a length. */
    fit(pad = 3) {
      let ext = R;
      el.querySelectorAll<SVGGElement>('.web-node').forEach((g) => {
        // Each map's slice out past the end of its own name: measured plain,
        // a tenth more for when it is lit (bold), and a margin beyond.
        const end = R + 9 + g.querySelector('text')!.getComputedTextLength() * 1.1 + 8;
        ext = Math.max(ext, end);
        g.querySelector('.web-hit')!.setAttribute('d', wedge(angle.get(g.dataset.id!)!, end));
      });
      if (ext === R) return;
      const e = ext + pad;
      svg.setAttribute('viewBox', `${-e} ${-e} ${2 * e} ${2 * e}`);
    },
    /** The pair on the map now -- the network's focus and the map laid over
     *  it -- marked out: their line in front, in its own colour, glowing,
     *  and the laid-over map's name lit. Null for none. */
    current(a: string | null, b: string | null) {
      el.querySelectorAll('.web-line.cur').forEach((l) => l.classList.remove('cur'));
      el.querySelectorAll('.web-node.cur').forEach((n) => n.classList.remove('cur'));
      if (!a || !b) return;
      const line = [...el.querySelectorAll<SVGPathElement>('.web-line')].find(
        (l) => (l.dataset.a === a && l.dataset.b === b) || (l.dataset.a === b && l.dataset.b === a),
      );
      if (!line) return;
      line.classList.add('cur');
      // Last in its group, so drawn over the rest.
      line.parentElement!.append(line);
      el.querySelector(`.web-node[data-id="${CSS.escape(b)}"]`)?.classList.add('cur');
    },
    /** Keep this map lit (null: none). */
    pick(id: string | null) {
      picked = id;
      light(id);
    },
  });
}
