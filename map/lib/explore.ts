/** Where the map starts when it opens with nothing on: the map dimmed, and
 *  over it one question -- "What do you want to explore?" -- with a search
 *  box whose hint turns through things to try, and beside it the two other
 *  ways in: the network, and the web of every map and how they connect.
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
// Lined up with the question (ASKS, the same beat): a place comes round with
// "Where", a map with years with "When".
const TRIES = ['grizzly bear', 'Squamish', 'wildfire', 'land cover', 'frogs', 'Pemberton', 'protected areas', 'forest loss'];
/** The question's first word, turning: there is more than one way to ask. */
const ASKS = ['What', 'Where', 'How', 'When'];
/** How long each word of the question stays, in ms. */
const ASK_TURN = 3400;
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
  /** The EcoScapes logo, over the question. */
  logo: string;
  layers: ExploreLayer[];
  /** Short names (connections.json) and everyday words (search-words.json). */
  names: Record<string, string>;
  searchWords: Record<string, string[]>;
  /** A layer's colour dot, and the line under it: where it sits. */
  colourOf: (id: string) => string;
  whereOf: (l: ExploreLayer) => string;
  /** Open with the map dimmed and the question up. */
  open: boolean;
  /** Places to be found by name (shared/lib/towns.ts), and one picked:
   *  the map taken there. */
  places: { name: string; kind: 'town' | 'mountain' | 'lake'; lng: number; lat: number }[];
  onPlace: (p: { name: string; lng: number; lat: number }) => void;
  /** A result picked: put it on the map. True to stay open for more (the
   *  roster), false to give way (the network or the web took it). */
  onPick: (id: string) => boolean;
  /** The maps on now, and one taken off from the roster. */
  current: () => string[];
  onRemove: (id: string) => void;
  /** A way in chosen: the page shows its card under the row (panel()), the
   *  question and the row staying up to change one's mind. */
  onNetwork: () => void;
  /** The web of every map and its connections: opened on its own, the
   *  landing giving way to it. */
  onWeb: () => void;
  /** Maps through the years: opened on its own, as the web is. */
  onTime: () => void;
  /** The card under the row given up: back to searching, or the landing
   *  shut. */
  onPanelGone?: () => void;
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
    `<img class="ex-logo" src="${esc(opts.logo)}" alt="EcoScapes" width="800" height="184" />` +
    // Read as the one question; seen, its first word turns (ASKS).
    `<h2 id="ex-title"><span class="ex-sr">What do you want to explore?</span>` +
    // The word's slot as wide as the widest of them (each laid in it unseen),
    // the word against its right side: "do you want to explore?" stays put.
    `<span aria-hidden="true"><span class="ex-ask">${ASKS.map((w) => `<span class="ex-size">${w}</span>`).join('')}` +
    `<span class="ex-reel"></span>` +
    `</span> do you want to explore?</span></h2>` +
    `<div class="ex-row">` +
    `<div class="ex-box">` +
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="6.5" /><path d="M16 16l4.5 4.5" /></svg>` +
    `<input class="ex-input" type="search" autocomplete="off" spellcheck="false" aria-label="What do you want to explore?" aria-controls="ex-results" aria-autocomplete="list" />` +
    // "Try" stays; only the thing to try turns, in its quotes.
    `<span class="ex-hint" aria-hidden="true">Try <span class="ex-try"></span></span>` +
    `</div>` +
    // Each opens out, with its words, over the search's room as it is
    // pointed at (see the row's data-wide, below).
    `<button class="step ex-mode" type="button" data-mode="network" aria-label="Map Network">` +
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="12" cy="12" r="3" /><circle cx="12" cy="3.8" r="2" /><circle cx="19.1" cy="16.1" r="2" /><circle cx="4.9" cy="16.1" r="2" /><path d="M12 9V5.8M14.6 13.5l2.8 1.6M9.4 13.5l-2.8 1.6" /></svg>` +
    `<span class="ex-label" aria-hidden="true">Map Network</span></button>` +
    `<button class="step ex-mode" type="button" data-mode="time" aria-label="Through Time">` +
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="13.5" r="7.5" /><path d="M12 13.5V9.5M10 2.5h4M12 2.5v3.5M18.2 6.8l1.3-1.3" /></svg>` +
    `<span class="ex-label" aria-hidden="true">Through Time</span></button>` +
    `<button class="step ex-mode" type="button" data-mode="web" aria-label="The Web">` +
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><circle cx="12" cy="12" r="8.5" /><path d="M12 3.5C11 9 7 13 4.6 16.3M19.4 16.3C16 14 10 13 4.6 16.3M12 3.5c1 5.5 4.5 9.5 7.4 12.8M3.6 11c5 .5 11.5.5 16.8 0" stroke-width="1.1" /></svg>` +
    `<span class="ex-label" aria-hidden="true">The Web</span></button>` +
    `</div>` +
    `<ul class="ex-results" id="ex-results" role="listbox" aria-label="Maps" hidden></ul>` +
    // What has been put on so far, to keep adding to, and Go to see it.
    `<p class="ex-sub">Keep adding layers by searching for more</p>` +
    `<div class="ex-roster" hidden><ul class="ex-chips" aria-label="On the map"></ul>` +
    `<button class="ex-go" type="button">Go</button></div>` +
    // A mode's card, under the row (the network's start card, for now).
    `<div class="ex-panel" hidden></div>` +
    `</div>`;
  const input = root.querySelector<HTMLInputElement>('.ex-input')!;
  const hint = root.querySelector<HTMLElement>('.ex-hint')!;
  const tryEl = root.querySelector<HTMLElement>('.ex-try')!;
  const list = root.querySelector<HTMLElement>('.ex-results')!;
  const panelEl = root.querySelector<HTMLElement>('.ex-panel')!;
  const rosterEl = root.querySelector<HTMLElement>('.ex-roster')!;
  const chipsEl = root.querySelector<HTMLElement>('.ex-chips')!;
  const byId = new Map(opts.layers.map((l) => [l.id, l]));

  // ---- The roster: what is on, in the order it went on ------------------------
  let roster: string[] = [];
  const drawRoster = () => {
    const on = opts.current();
    roster = [...roster.filter((id) => on.includes(id)), ...on.filter((id) => !roster.includes(id))];
    rosterEl.hidden = !roster.length;
    chipsEl.innerHTML = roster
      .map(
        (id) =>
          `<li class="ex-chip"><i style="background:${esc(opts.colourOf(id))}"></i><span>${esc(byId.get(id)?.name ?? id)}</span>` +
          `<button type="button" data-off="${esc(id)}" aria-label="Take ${esc(byId.get(id)?.name ?? id)} off">` +
          `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17" /></svg></button></li>`,
      )
      .join('');
  };
  chipsEl.addEventListener('click', (e) => {
    const b = (e.target as Element).closest<HTMLElement>('[data-off]');
    if (!b) return;
    opts.onRemove(b.dataset.off!);
    drawRoster();
    draw();
  });
  root.querySelector('.ex-go')!.addEventListener('click', () => close());

  // ---- The question's first word, turning -----------------------------------
  // Rolled down, a letter at a time from the first: the old word's letters
  // drop out of the bottom of its window as the new one's drop in from the
  // top, each a beat after the one before it -- a wave across the word.
  const reel = root.querySelector<HTMLElement>('.ex-reel')!;
  let ask = 0;
  let askTimer = 0;
  const still = matchMedia('(prefers-reduced-motion: reduce)');
  const word = (w: string, cls = '') => {
    const el = document.createElement('span');
    el.className = `ex-word ${cls}`;
    el.innerHTML = [...w].map((c, i) => `<span style="--i:${i}">${c}</span>`).join('');
    return el;
  };
  const nextAsk = () => {
    ask = (ask + 1) % ASKS.length;
    const old = reel.querySelector('.ex-word:not(.out)');
    if (old) {
      old.classList.add('out');
      setTimeout(() => old.remove(), 900);
    }
    reel.append(word(ASKS[ask], 'in'));
  };
  /** Turning while the question is up and nothing is typed. */
  const asking = (on: boolean) => {
    clearInterval(askTimer);
    // The hint below turns with it, on the same beat.
    if (on && !still.matches)
      askTimer = window.setInterval(() => {
        nextAsk();
        if (!input.value) showHint();
      }, ASK_TURN);
  };

  // ---- The hint: things to try, turning --------------------------------------
  let turn = 0;
  let timer = 0;
  const showHint = () => {
    tryEl.classList.remove('in');
    // Out, then the next one in: a frame between so the fade restarts.
    requestAnimationFrame(() => {
      tryEl.textContent = `“${TRIES[turn % TRIES.length]}”`;
      tryEl.classList.add('in');
      turn++;
    });
  };
  /** The hint shown afresh; after that it turns with the question (asking),
   *  or on its own where the question stays still (less motion asked for). */
  const turning = (on: boolean) => {
    clearInterval(timer);
    if (on && !input.value) {
      showHint();
      if (still.matches) timer = window.setInterval(showHint, ASK_TURN);
    }
  };
  // Hidden while there is typing to show instead.
  const syncHint = () => (hint.hidden = !!input.value);

  // ---- Results ---------------------------------------------------------------
  // ---- Places: "where" ------------------------------------------------------
  // A town, mountain or lake whose name every word typed starts or matches
  // -- "squam", "pember", "chief", "garibaldi lake" -- a few at most, above
  // the maps.
  const placeWords = opts.places.map((p) => words(p.name));
  const findPlaces = (query: string) => {
    const qs = words(query).filter((w) => !STOP.has(w));
    if (!qs.length) return [];
    return opts.places
      .map((p, i) => {
        let score = 0;
        for (const q of qs) {
          const best = Math.max(0, ...placeWords[i].map((w) => match(q, w)));
          if (best < 0.45) return null;
          score += best;
        }
        return { p, score };
      })
      .filter((x): x is { p: (typeof opts.places)[number]; score: number } => !!x)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map((x) => x.p);
  };

  /** What is under the box, places first then maps, in the order a key
   *  steps through them. */
  type Item = { place: (typeof opts.places)[number] } | { hit: Hit };
  let items: Item[] = [];
  let hits: Hit[] = [];
  let active = -1;
  const draw = () => {
    const { hits: found, near } = search(input.value);
    const places = findPlaces(input.value);
    hits = found;
    items = [...places.map((place) => ({ place })), ...(near && places.length ? [] : hits).map((hit) => ({ hit }))];
    active = items.length ? 0 : -1;
    list.hidden = !input.value.trim();
    if (list.hidden) return;
    const row = (it: Item, i: number) =>
      'place' in it
        ? `<li role="option" id="ex-opt-${i}" data-place="${i}" aria-selected="${i === active}" class="ex-place">` +
          `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s6-5.1 6-10.2a6 6 0 10-12 0C6 15.9 12 21 12 21z" /><circle cx="12" cy="10.8" r="2.2" /></svg>` +
          `<span><b>${esc(it.place.name)}</b><span class="ex-why">${{ town: 'Town', mountain: 'Mountain', lake: 'Lake' }[it.place.kind]} · go there on the map</span></span></li>`
        : `<li role="option" id="ex-opt-${i}" data-id="${esc(it.hit.l.id)}" aria-selected="${i === active}"${roster.includes(it.hit.l.id) ? ' class="is-on"' : ''}>` +
          `<i style="background:${esc(opts.colourOf(it.hit.l.id))}"></i>` +
          `<span><b>${esc(it.hit.l.name)}</b><span class="ex-why">${roster.includes(it.hit.l.id) ? '✓ On the map' : esc(it.hit.why ?? opts.whereOf(it.hit.l))}</span></span></li>`;
    list.innerHTML =
      (near && hits.length && !places.length ? `<li class="ex-near" role="presentation">Nothing by that name. The closest we have:</li>` : '') +
      (items.length ? items.map(row).join('') : `<li class="ex-near" role="presentation">No maps yet for that. Try one of the hints.</li>`);
    input.setAttribute('aria-activedescendant', active >= 0 ? `ex-opt-${active}` : '');
  };
  const choose = (i: number) => {
    active = i;
    list.querySelectorAll('[role="option"]').forEach((li, j) => li.setAttribute('aria-selected', String(j === i)));
    input.setAttribute('aria-activedescendant', `ex-opt-${i}`);
    list.querySelector(`#ex-opt-${i}`)?.scrollIntoView({ block: 'nearest' });
  };
  /** Put on, and -- unless the network or the web took it -- the search
   *  kept up for the next, emptied. One already on stays as it is. */
  const pick = (id: string) => {
    if (roster.includes(id)) return;
    if (!opts.onPick(id)) return close();
    input.value = '';
    syncHint();
    drawRoster();
    draw();
    turning(true);
    input.focus({ preventScroll: true });
  };

  input.addEventListener('input', () => {
    syncHint();
    turning(!input.value);
    asking(!input.value);
    draw();
  });
  /** A place: the map taken there behind the landing, which stays up -- a
   *  layer is still to be found to see anything there -- the box emptied
   *  for it, and the line under it saying where the map now is. */
  const subEl = root.querySelector<HTMLElement>('.ex-sub')!;
  const SUB = subEl.textContent!;
  const goTo = (p: (typeof opts.places)[number]) => {
    opts.onPlace(p);
    subEl.textContent = `At ${p.name} · keep adding layers by searching for more`;
    input.value = '';
    syncHint();
    draw();
    turning(true);
    asking(true);
    input.focus({ preventScroll: true });
  };
  const take = (it: Item) => ('place' in it ? goTo(it.place) : pick(it.hit.l.id));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' && items.length) {
      e.preventDefault();
      choose((active + 1) % items.length);
    } else if (e.key === 'ArrowUp' && items.length) {
      e.preventDefault();
      choose((active - 1 + items.length) % items.length);
    } else if (e.key === 'Enter' && active >= 0) {
      e.preventDefault();
      take(items[active]);
    } else if (e.key === 'Enter' && !input.value.trim() && roster.length) {
      // Nothing typed, something picked: Go.
      e.preventDefault();
      close();
    }
  });
  list.addEventListener('click', (e) => {
    const li = (e.target as HTMLElement).closest<HTMLElement>('[data-id], [data-place]');
    if (!li) return;
    if (li.dataset.place) return take(items[Number(li.dataset.place)]);
    pick(li.dataset.id!);
  });
  // Pointed at (or reached by the keyboard), a mode opens out to the
  // search's width with its words, and the search draws in to a circle. It
  // stays that way until another is pointed at -- the other mode, or the
  // search's circle, which opens the search again -- rather than springing
  // back as the pointer leaves: the row moves under the pointer as it
  // changes, and a spring back had it flicking to and fro.
  const row = root.querySelector<HTMLElement>('.ex-row')!;
  const box = root.querySelector<HTMLElement>('.ex-box')!;
  /** The mode chosen, its card up under the row: it holds its place until
   *  the search is taken up again, or the card closed. */
  let chosen: string | undefined;
  const widen = (mode?: string) => {
    if (chosen && mode !== chosen) return;
    if ((row.dataset.wide ?? '') === (mode ?? '')) return;
    if (mode) row.dataset.wide = mode;
    else delete row.dataset.wide;
    // Drawn in to a circle, the search lets go of the keyboard, and so of its
    // lit edge.
    if (mode && document.activeElement === input) input.blur();
  };
  root.querySelectorAll<HTMLButtonElement>('.ex-mode').forEach((b) => {
    b.addEventListener('click', () => pickMode(b.dataset.mode!));
    b.addEventListener('pointerenter', (e) => e.pointerType === 'mouse' && widen(b.dataset.mode));
    b.addEventListener('focus', () => b.matches(':focus-visible') && widen(b.dataset.mode));
  });
  /** A way in chosen: its card under the row (the page gives it, panel()),
   *  the row held on it until the search is taken up again or the card
   *  closed. */
  function pickMode(mode: string) {
    // The web has no card here: it opens on its own, over the map.
    if (mode === 'web') return opts.onWeb();
    if (mode === 'time') return opts.onTime();
    if (chosen === mode) return;
    if (chosen) {
      panel(null);
      opts.onPanelGone?.();
    }
    chosen = undefined;
    widen(mode);
    chosen = mode;
    (mode === 'network' ? opts.onNetwork : opts.onWeb)();
  }
  /** Back to searching: any mode's card let go. */
  const searchAgain = () => {
    if (chosen) {
      chosen = undefined;
      panel(null);
      opts.onPanelGone?.();
    }
    widen();
  };
  box.addEventListener('pointerenter', (e) => e.pointerType === 'mouse' && widen());
  box.addEventListener('click', () => {
    searchAgain();
    input.focus();
  });
  input.addEventListener('focus', searchAgain);

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

  /** A card under the row, or none. The element is moved here, not copied:
   *  the page takes it back when it is let go. */
  function panel(el: HTMLElement | null) {
    panelEl.hidden = !el;
    if (el) panelEl.replaceChildren(el);
    else panelEl.replaceChildren();
    root.classList.toggle('has-panel', !!el);
  }

  function close() {
    if (root.hidden) return;
    if (chosen) {
      chosen = undefined;
      panel(null);
      opts.onPanelGone?.();
    }
    root.classList.add('leaving');
    turning(false);
    asking(false);
    setTimeout(() => {
      root.hidden = true;
      root.classList.remove('leaving');
    }, 220);
  }
  /** Up over the map. `modes` false for the search alone -- opened from its
   *  own button, when the network has a button of its own beside
   *  it -- and the two ways in only when the map opens fresh. */
  function open(modes = true) {
    root.hidden = false;
    root.classList.toggle('search-only', !modes);
    widen();
    input.value = '';
    roster = [];
    subEl.textContent = SUB;
    drawRoster();
    syncHint();
    draw();
    turning(true);
    ask = 0;
    reel.replaceChildren(word(ASKS[0]));
    asking(true);
    // The keyboard only where there is one: on a phone it would cover the
    // question before it has been read.
    if (matchMedia('(pointer: fine)').matches) input.focus({ preventScroll: true });
  }
  if (opts.open) open(true);
  else root.hidden = true;

  return {
    open,
    close,
    panel,
    choose: pickMode,
    isOpen: () => !root.hidden,
    /** The card closed from within: back to the row, nothing chosen. */
    unchoose: () => {
      chosen = undefined;
      panel(null);
      widen();
    },
  };
}
