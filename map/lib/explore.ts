/** Where the map starts when it opens with nothing on: the map dimmed, and
 *  over it one question -- "What do you want to explore?" -- with a search
 *  box whose hint turns through things to try, and beside it the two other
 *  ways in, the network and the filter (the lens).
 *
 *  The search is forgiving, so that almost anything typed finds something:
 *  a layer's name, its short name, its classes ("coniferous" is land cover),
 *  its description and the everyday words for it in
 *  map/content/search-words.json ("fire", "roads", "frogs"); a slip of a
 *  letter or two, a plural, and words like "show me" don't matter. When
 *  nothing matches at all it offers the nearest by spelling, rather than
 *  nothing. */

export type ExploreLayer = {
  id: string;
  name: string;
  about?: string;
  legend: { label: string }[];
  theme: string;
  subtheme: string;
};

/** The hints the empty box turns through. */
const TRIES = ['Grizzly bear', 'human impacts', 'wildfire', 'frogs', 'wildlife corridors', 'protected areas', 'climate refuges', 'forest'];
/** How long each hint shows, in ms. */
const TURN = 2800;
/** At most this many results under the box. */
const MOST = 6;

/** Words too common to count for anything in a question. */
const STOP = new Set(
  'a an and are as at be by can do for from have how i in is it me my near of on or show see the to want what where which who with explore find look about any some there this that'.split(' '),
);

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Words, lower-cased, without accents, and without a plural or -ing ending:
 *  "Bears" and "bear", "burning" and "burn" are one word here. */
const words = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map(stem);
function stem(w: string) {
  if (w.length > 5 && w.endsWith('ing')) return w.slice(0, -3);
  if (w.length > 4 && w.endsWith('ies')) return w.slice(0, -3) + 'y';
  if (w.length > 4 && /(ches|shes|sses|xes)$/.test(w)) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
  return w;
}

/** Letters to change to turn a into b -- two swapped letters counting as
 *  one change ("frgo" is one from "frog") -- giving up past `max`. */
function edits(a: string, b: string, max: number) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  return d[a.length][b.length];
}
/** How well a typed word matches one of a layer's, 0 to 1: the whole word,
 *  its start, inside it, or near enough. Near enough is careful with short
 *  words, where one letter makes another word ("bear", "beav-er"; "fire",
 *  "fir"; "road", "toad"): at four letters only a letter changed or two
 *  swapped, same length, same first letter; from five, a letter off either way, or off the start of a longer
 *  word; from eight, two. */
function match(q: string, w: string) {
  if (w === q) return 1;
  if (w.startsWith(q)) return q.length >= 3 ? 0.85 : 0.4;
  if (q.length >= 5 && w.includes(q)) return 0.6;
  if (q.length === 4 && w.length === 4 && q[0] === w[0] && edits(q, w, 1) <= 1) return 0.5;
  if (q.length >= 5) {
    const max = q.length >= 8 ? 2 : 1;
    if (edits(q, w, max) <= max) return 0.55;
    if (w.length > q.length && edits(q, w.slice(0, q.length), max) <= max) return 0.45;
  }
  return 0;
}
/** The letter triples in a string, for the nearest by spelling. */
const triples = (s: string) => {
  const t = ` ${s.toLowerCase().replace(/[^a-z]+/g, ' ')} `;
  const out = new Set<string>();
  for (let i = 0; i + 3 <= t.length; i++) out.add(t.slice(i, i + 3));
  return out;
};

const WEIGHT = { name: 10, words: 8, legend: 5, about: 3, where: 2 } as const;
type Field = keyof typeof WEIGHT;

export function explore(opts: {
  root: HTMLElement;
  layers: ExploreLayer[];
  /** Short names (connections.json) and everyday words (search-words.json). */
  names: Record<string, string>;
  searchWords: Record<string, string[]>;
  /** A layer's colour dot, and the line under it: where it sits. */
  colourOf: (id: string) => string;
  whereOf: (l: ExploreLayer) => string;
  /** Open with the map dimmed and the question up. */
  open: boolean;
  /** A result picked: put it on the map. */
  onPick: (id: string) => void;
  onNetwork: () => void;
  onFilter: () => void;
}) {
  const { root } = opts;
  const index = opts.layers.map((l) => {
    const fields: Record<Field, string[]> = {
      name: words(`${l.name} ${opts.names[l.id] ?? ''}`),
      words: words((opts.searchWords[l.id] ?? []).join(' ')),
      legend: words(l.legend.map((k) => k.label).join(' ')),
      about: words(l.about ?? ''),
      where: words(opts.whereOf(l)),
    };
    const spelling = triples(`${l.name} ${opts.names[l.id] ?? ''} ${(opts.searchWords[l.id] ?? []).join(' ')}`);
    return { l, fields, spelling };
  });

  type Hit = { l: ExploreLayer; score: number; why?: string };
  /** Every layer that matches any of the words, best first. Words that match
   *  nothing are passed over rather than ruling a layer out. */
  function search(query: string): { hits: Hit[]; near: boolean } {
    const qs = words(query).filter((w) => !STOP.has(w));
    if (!qs.length) return { hits: [], near: false };
    const phrase = qs.join(' ');
    const hits: Hit[] = [];
    for (const e of index) {
      let score = 0;
      let matched = 0;
      let why: string | undefined;
      for (const q of qs) {
        let best = 0;
        let from: Field | null = null;
        for (const f of Object.keys(WEIGHT) as Field[])
          for (const w of e.fields[f]) {
            const s = match(q, w) * WEIGHT[f];
            if (s > best) [best, from] = [s, f];
          }
        if (best > 0) matched++;
        score += best;
        // Found only among its classes: say which, as that is why it is here.
        if (from === 'legend' && !why) {
          const k = e.l.legend.find((k) => words(k.label).some((w) => match(q, w) > 0));
          if (k) why = `Includes ${k.label}`;
        }
      }
      if (!score) continue;
      // All the words matched counts for more than some of them; the whole
      // phrase at the start of the name, more again.
      score *= matched / qs.length;
      if (words(e.l.name).join(' ').startsWith(phrase) || words(opts.names[e.l.id] ?? '').join(' ').startsWith(phrase)) score += 6;
      hits.push({ l: e.l, score, why });
    }
    hits.sort((a, b) => b.score - a.score || a.l.name.localeCompare(b.l.name));
    // Only those near the best: a word in passing in a description is not
    // worth a place when a name matches.
    const top = hits[0]?.score ?? 0;
    if (hits.length) return { hits: hits.filter((h) => h.score >= top * 0.4).slice(0, MOST), near: false };
    // Nothing: the nearest by spelling, so there is always somewhere to go.
    const t = triples(query);
    const near = index
      .map((e) => {
        let same = 0;
        for (const x of t) if (e.spelling.has(x)) same++;
        return { l: e.l, score: same / (t.size + 1) };
      })
      .filter((h) => h.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);
    return { hits: near, near: true };
  }

  root.innerHTML =
    `<div class="ex-card" role="dialog" aria-modal="true" aria-labelledby="ex-title">` +
    `<h2 id="ex-title">What do you want to explore?</h2>` +
    `<div class="ex-row">` +
    `<div class="ex-box">` +
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="6.5" /><path d="M16 16l4.5 4.5" /></svg>` +
    `<input class="ex-input" type="search" autocomplete="off" spellcheck="false" aria-label="What do you want to explore?" aria-controls="ex-results" aria-autocomplete="list" />` +
    `<span class="ex-hint" aria-hidden="true"></span>` +
    `</div>` +
    `<button class="step ex-mode" type="button" data-mode="network" aria-label="Network: start from one map and follow its links" title="Network">` +
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="12" cy="12" r="3" /><circle cx="12" cy="3.8" r="2" /><circle cx="19.1" cy="16.1" r="2" /><circle cx="4.9" cy="16.1" r="2" /><path d="M12 9V5.8M14.6 13.5l2.8 1.6M9.4 13.5l-2.8 1.6" /></svg></button>` +
    `<button class="step ex-mode" type="button" data-mode="filter" aria-label="Filter: look through one map to the others under it" title="Filter">` +
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="5" stroke-dasharray="2 2.2" /></svg></button>` +
    `</div>` +
    `<ul class="ex-results" id="ex-results" role="listbox" aria-label="Maps" hidden></ul>` +
    `</div>`;
  const input = root.querySelector<HTMLInputElement>('.ex-input')!;
  const hint = root.querySelector<HTMLElement>('.ex-hint')!;
  const list = root.querySelector<HTMLElement>('.ex-results')!;

  // ---- The hint: things to try, turning --------------------------------------
  let turn = 0;
  let timer = 0;
  const showHint = () => {
    hint.classList.remove('in');
    // Out, then the next one in: a frame between so the fade restarts.
    requestAnimationFrame(() => {
      hint.textContent = `Try “${TRIES[turn % TRIES.length]}”`;
      hint.classList.add('in');
      turn++;
    });
  };
  const turning = (on: boolean) => {
    clearInterval(timer);
    if (on && !input.value) {
      showHint();
      timer = window.setInterval(showHint, TURN);
    }
  };
  // Hidden while there is typing to show instead.
  const syncHint = () => (hint.hidden = !!input.value);

  // ---- Results ---------------------------------------------------------------
  let hits: Hit[] = [];
  let active = -1;
  const draw = () => {
    const { hits: found, near } = search(input.value);
    hits = found;
    active = hits.length ? 0 : -1;
    list.hidden = !input.value.trim();
    if (list.hidden) return;
    list.innerHTML =
      (near && hits.length ? `<li class="ex-near" role="presentation">Nothing by that name. The closest we have:</li>` : '') +
      (hits.length
        ? hits
            .map(
              (h, i) =>
                `<li role="option" id="ex-opt-${i}" data-id="${esc(h.l.id)}" aria-selected="${i === active}">` +
                `<i style="background:${esc(opts.colourOf(h.l.id))}"></i>` +
                `<span><b>${esc(h.l.name)}</b><span class="ex-why">${esc(h.why ?? opts.whereOf(h.l))}</span></span></li>`,
            )
            .join('')
        : `<li class="ex-near" role="presentation">No maps yet for that. Try one of the hints.</li>`);
    input.setAttribute('aria-activedescendant', active >= 0 ? `ex-opt-${active}` : '');
  };
  const choose = (i: number) => {
    active = i;
    list.querySelectorAll('[role="option"]').forEach((li, j) => li.setAttribute('aria-selected', String(j === i)));
    input.setAttribute('aria-activedescendant', `ex-opt-${i}`);
    list.querySelector(`#ex-opt-${i}`)?.scrollIntoView({ block: 'nearest' });
  };
  const pick = (id: string) => {
    close();
    opts.onPick(id);
  };

  input.addEventListener('input', () => {
    syncHint();
    turning(!input.value);
    draw();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' && hits.length) {
      e.preventDefault();
      choose((active + 1) % hits.length);
    } else if (e.key === 'ArrowUp' && hits.length) {
      e.preventDefault();
      choose((active - 1 + hits.length) % hits.length);
    } else if (e.key === 'Enter' && active >= 0) {
      e.preventDefault();
      pick(hits[active].l.id);
    }
  });
  list.addEventListener('click', (e) => {
    const li = (e.target as HTMLElement).closest<HTMLElement>('[data-id]');
    if (li) pick(li.dataset.id!);
  });
  root.querySelectorAll<HTMLButtonElement>('.ex-mode').forEach((b) =>
    b.addEventListener('click', () => {
      close();
      (b.dataset.mode === 'network' ? opts.onNetwork : opts.onFilter)();
    }),
  );

  // ---- Open and shut -----------------------------------------------------------
  // A tap on the dimmed map, or Escape, lets it go: the map is there to use.
  root.addEventListener('click', (e) => {
    if (e.target === root) close();
  });
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape' || root.hidden) return;
    if (input.value) {
      input.value = '';
      syncHint();
      turning(true);
      draw();
    } else close();
  };
  addEventListener('keydown', onKey);

  function close() {
    if (root.hidden) return;
    root.classList.add('leaving');
    turning(false);
    setTimeout(() => {
      root.hidden = true;
      root.classList.remove('leaving');
    }, 220);
  }
  function open() {
    root.hidden = false;
    input.value = '';
    syncHint();
    draw();
    turning(true);
    // The keyboard only where there is one: on a phone it would cover the
    // question before it has been read.
    if (matchMedia('(pointer: fine)').matches) input.focus({ preventScroll: true });
  }
  if (opts.open) open();
  else root.hidden = true;

  return { open, close, isOpen: () => !root.hidden };
}
