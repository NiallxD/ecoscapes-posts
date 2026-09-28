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
  const colourOf = new Map(order.map(({ l, r }) => [l.id, net.roles[r].colour]));

  // Each pair linked, once, whichever way the link was made.
  const pairs = new Map<string, [string, string]>();
  const touches = new Map<string, Set<string>>(order.map(({ l }) => [l.id, new Set<string>()]));
  for (const [id, by] of Object.entries(net.links))
    for (const other of Object.values(by).flat()) {
      if (!angle.has(id) || !angle.has(other) || id === other) continue;
      const key = [id, other].sort().join('|');
      if (!pairs.has(key)) pairs.set(key, [id, other]);
      touches.get(id)!.add(other);
      touches.get(other)!.add(id);
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
    `<text class="web-mid" x="0" y="0" text-anchor="middle" dominant-baseline="middle"></text>` +
    `</svg>`;
  const svg = el.querySelector('svg')!;
  const mid = el.querySelector<SVGTextElement>('.web-mid')!;

  /** One map lit: its lines, and the maps at their ends; the rest dimmed. */
  const light = (id: string | null) => {
    svg.classList.toggle('lit', !!id);
    const near = id ? touches.get(id)! : new Set<string>();
    el.querySelectorAll<SVGElement>('.web-node').forEach((g) => {
      const me = g.dataset.id!;
      g.classList.toggle('on', me === id);
      g.classList.toggle('near', near.has(me));
    });
    el.querySelectorAll<SVGElement>('.web-line').forEach((p) => {
      const on = !!id && (p.dataset.a === id || p.dataset.b === id);
      p.classList.toggle('on', on);
      // As a style: the sheet's own stroke would outrank an attribute.
      p.style.stroke = on ? colourOf.get(id!)! : '';
    });
    mid.textContent = id ? `${near.size} connections` : '';
  };
  const nodeOf = (e: Event) => (e.target as Element).closest<SVGElement>('.web-node');
  svg.addEventListener('pointerover', (e) => {
    const g = nodeOf(e);
    if (g) light(g.dataset.id!);
  });
  svg.addEventListener('pointerleave', () => light(null));
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
  return el;
}
