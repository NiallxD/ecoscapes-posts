/** Where you are on the page, and how the arrows move you: no drawing here,
 *  so the desktop wheel and a phone layout (later) can walk the same path.
 *
 *  A goal's path is the goal itself (its statement and its targets), then
 *  each of its targets tab by tab: Focus, Achieve, Align. Past either
 *  end, on to the next goal, or back to the previous goal's last target's
 *  last tab, round and round. Supplementary material (40 years of change) is
 *  off the path: the arrows walk its own tabs, then leave it for the goal it
 *  was opened from. */

export type Tab = 'what' | 'how' | 'bigger';
/** `target` null: the goal itself. `map`: which of the target's maps is
 *  drawn, when it has more than one; null for its first. `home`: the page's
 *  opening words, before the path starts (the ring on the first goal). */
export type Place = { goal: number; target: string | null; tab: Tab; map: string | null; home?: boolean };
export const TABS: Tab[] = ['what', 'how', 'bigger'];
/** Each tab's name on screen and in the address: Focus, Achieve, Align.
 *  An address with the old names (what, how, bigger) still opens its tab. */
export const TAB_NAMES: Record<Tab, string> = { what: 'focus', how: 'achieve', bigger: 'align' };

/** Each goal's targets, in order, by goal index. */
export type Plan = string[][];

const mod = (n: number, k: number) => ((n % k) + k) % k;

export const goalOf = (plan: Plan, target: string) => plan.findIndex((ids) => ids.includes(target));

/** One move along the path, forward (1) or back (-1). */
export function stepBy(plan: Plan, at: Place, dir: 1 | -1): Place {
  // Home is before the path: on to the first goal, or back round to the end.
  if (at.home) return dir > 0 ? { goal: 0, target: null, tab: 'what', map: null } : stepBy(plan, { ...at, home: false }, -1);
  const path: [string | null, Tab][] = [[null, 'what'], ...plan[at.goal].flatMap((id) => TABS.map((tab) => [id, tab] as [string, Tab]))];
  const here = at.target === null ? 0 : path.findIndex(([id, tab]) => id === at.target && tab === at.tab);
  // Off the path (supplementary): its own tabs, then back to the goal's end,
  // or on to the next goal.
  if (at.target !== null && here < 0) {
    const t = TABS.indexOf(at.tab) + dir;
    if (t >= 0 && t < TABS.length) return { ...at, tab: TABS[t] };
    if (dir > 0) return { ...at, goal: mod(at.goal + 1, plan.length), target: null, tab: 'what', map: null };
    const [target, tab] = path.at(-1)!;
    return { ...at, target, tab, map: null };
  }
  const land = ([target, tab]: [string | null, Tab], goal = at.goal): Place => ({
    goal,
    target,
    tab,
    // A new target starts on its first map; another tab keeps the one chosen.
    map: target === at.target && goal === at.goal ? at.map : null,
  });
  const j = here + dir;
  if (j >= 0 && j < path.length) return land(path[j]);
  const goal = mod(at.goal + dir, plan.length);
  if (dir > 0) return land([null, 'what'], goal);
  const last = plan[goal].at(-1)!;
  return land([last, 'bigger'], goal);
}

/** The place in an address's ?goal=ES.1&target=T3&tab=how&map=..., whatever
 *  is missing or wrong in it put back to a sensible default: ES.1, the goal
 *  itself. No goal and no target, the bare address: home. `extra` are
 *  targets off the path that an address may still open. */
export function readPlace(plan: Plan, goalIds: string[], extra: string[], search: string): Place {
  const q = new URLSearchParams(search);
  const target = q.get('target') ?? '';
  const asked = goalIds.indexOf(q.get('goal') ?? '');
  const fromTarget = goalOf(plan, target);
  const goal = fromTarget >= 0 ? fromTarget : Math.max(0, asked);
  const asked_ = q.get('tab') ?? '';
  const named = (Object.entries(TAB_NAMES).find(([, name]) => name === asked_)?.[0] ?? asked_) as Tab;
  const tab = TABS.includes(named) ? named : 'what';
  const known = fromTarget >= 0 || extra.includes(target);
  const home = !q.has('goal') && !q.has('target');
  return { goal, target: known ? target : null, tab, map: known ? q.get('map') : null, home };
}

export function writePlace(p: Place, goalIds: string[]) {
  if (p.home) return location.pathname;
  const q = new URLSearchParams();
  q.set('goal', goalIds[p.goal]);
  if (p.target) {
    q.set('target', p.target);
    q.set('tab', TAB_NAMES[p.tab]);
    if (p.map) q.set('map', p.map);
  }
  return `${location.pathname}?${q}`;
}
