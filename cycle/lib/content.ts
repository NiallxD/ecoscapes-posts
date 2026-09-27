import { z } from 'astro/zod';
import layersData from '../../dst/content/dst-layers.json';
import { PALETTES } from '../../dst/lib/palettes';
import { asset, tile } from '../../shared/lib/paths';
import targetsJson from '../content/targets.json';
import frameworksJson from '../content/frameworks.json';
import mapsJson from '../content/maps.json';
import toolsJson from '../content/tools.json';

/** The targets' icons (content/icons/), the IcoMoon set the map app uses:
 *  one 32 × 32 drawing each, kept as its path. */
const iconFiles = import.meta.glob<string>('../content/icons/*.svg', { query: '?raw', import: 'default', eager: true });

/** The page's words, maps and tools, read from cycle/content/ and checked at
 *  build time: a target naming a goal, a map, a tool, an SDG or a Data
 *  Sandbox layer that isn't there stops the build with the file and the name
 *  to fix. The page (and a phone layout, later) reads only what this
 *  returns. */

const hex = z.string().regex(/^#[0-9a-f]{6}$/i, 'a colour as #rrggbb');
const GoalId = z.string().regex(/^ES\.[1-4]$/, 'an EcoScapes goal, ES.1 to ES.4');
/** KMGBF and Canada 2030 share goals A–D; X is a target that runs across
 *  all four. */
const WorldGoal = z.enum(['A', 'B', 'C', 'D', 'X']);

const Goal = z.object({
  id: GoalId,
  name: z.string(),
  statement: z.string(),
  /** A line under the statement, where it helps (ES.2 and ES.3 both
   *  restore). */
  note: z.string().optional(),
  /** A line under its targets, marked with an asterisk. */
  footnote: z.string().optional(),
  colour: hex,
});
const Sdg = z.object({ n: z.number().int().min(1).max(17), name: z.string(), colour: hex });
const Frameworks = z.object({
  /** The tag on every Align tab until Murray has signed it off; ""
   *  takes it away. */
  draft: z.string(),
  /** The page's opening words, before any goal: what you're about to see
   *  and how to get round it. `body` paragraphs may use <b>. */
  home: z.object({ eyebrow: z.string(), title: z.string(), lede: z.string(), body: z.array(z.string()).min(1), start: z.string() }),
  goals: z.array(Goal).length(4),
  kmgbfGoals: z.record(WorldGoal, z.string()),
  /** 40 years of change supports every goal, so none of their colours. */
  supplementaryColour: hex,
  sdgs: z.array(Sdg),
  /** The poster's two-score key: row-major from low/low, row = the second
   *  score (up), column = the first (across). */
  posterKey: z.array(hex).length(9),
});

/** One layer of a map's model, as the Data Sandbox would start it: from its
 *  usual thresholds unless `q` (shares of its area) or `bad` and `good` (in
 *  its own units) say otherwise. */
const MapLayer = z.object({
  id: z.string(),
  weight: z.number().min(0.1).max(5).default(1),
  higher: z.enum(['better', 'worse']).optional(),
  axis: z.union([z.literal(0), z.literal(1)]).default(0),
  q: z.tuple([z.number().min(0).max(1), z.number().min(0).max(1)]).optional(),
  bad: z.number().optional(),
  good: z.number().optional(),
});
/** A map, drawn live as a Data Sandbox model. Defined once, and listed by
 *  every target it serves. */
const MapDef = z.object({
  title: z.string(),
  about: z.string(),
  /** Where the data comes from, on the legend. */
  source: z.string().optional(),
  /** Not drawn yet: its layers aren't in the Sandbox, or are being redone. */
  updating: z.boolean().default(false),
  /** Which run of the model this is, on the legend. */
  version: z.string().optional(),
  /** One score: the Sandbox palette it is drawn in, and the key's two ends. */
  palette: z.string().optional(),
  ends: z.tuple([z.string(), z.string()]).optional(),
  /** Two scores: their names, across then up. */
  axes: z.tuple([z.string().max(24), z.string().max(24)]).optional(),
  layers: z.array(MapLayer).default([]),
});
/** A tool, a guide, a course or an agreement: what drives action where a
 *  map doesn't, or beside one. `href` a full address, or a path on this
 *  site. A document with a `cover` (a picture in content/docs/) is shown
 *  where the map would be, as a document to open; `title` is its full
 *  title there. */
const Tool = z.object({
  name: z.string(),
  title: z.string().optional(),
  by: z.string().optional(),
  text: z.string(),
  href: z.string().optional(),
  cover: z.string().optional(),
});

const Action = z.union([z.object({ map: z.string() }).strict(), z.object({ tool: z.string() }).strict()]);
const Level = z.object({
  goal: WorldGoal,
  /** "3", or "14, 21 & 22"; null where only a goal applies. */
  target: z.string().nullable(),
  text: z.string(),
});
const Target = z.object({
  id: z.string(),
  /** Its EcoScapes goal. None for supplementary material, which supports
   *  them all. */
  goal: GoalId.optional(),
  supplementary: z.boolean().default(false),
  /** What its circle on the ring says, when not its Canada target's number
   *  (1F and 1S: EcoScapes' two halves of Target 1). */
  chip: z.string().max(3).optional(),
  /** Which part of its Canada target it is, when EcoScapes splits one:
   *  "functional half". */
  half: z.string().optional(),
  name: z.string(),
  /** Its icon, a file in content/icons/ without the .svg: shown faint on its
   *  goal's arc of the ring. */
  icon: z.string().optional(),
  /** One line under its name. */
  short: z.string().max(90, 'one short line: 90 characters at most'),
  text: z.string(),
  act: z.string(),
  who: z.string(),
  /** What drives action on it: maps and tools, in the order shown. */
  actions: z.array(Action).min(1),
  /** The bigger picture, read from the bottom up. */
  levels: z.object({
    global: Level.extend({ sdg: z.array(z.number().int()).min(1), indicator: z.string().nullable() }),
    national: Level,
    regional: z.object({ indicator: z.string() }),
  }),
});

export type Goal = z.infer<typeof Goal>;
export type Target = z.infer<typeof Target>;
export type MapDef = z.infer<typeof MapDef>;
export type Tool = z.infer<typeof Tool>;
export type Frameworks = z.infer<typeof Frameworks>;

function parse<T>(schema: z.ZodType<T>, data: unknown, file: string): T {
  const r = schema.safeParse(data);
  if (r.success) return r.data;
  const lines = r.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
  throw new Error(`cycle/content/${file} doesn't read:\n${lines}`);
}

export function readCycle() {
  const frameworks = parse(Frameworks, frameworksJson, 'frameworks.json');
  const targets = parse(z.array(Target), targetsJson, 'targets.json');
  const maps = parse(z.record(z.string(), MapDef), mapsJson, 'maps.json');
  const tools = parse(z.record(z.string(), Tool), toolsJson, 'tools.json');

  const fail = (file: string, what: string) => {
    throw new Error(`cycle/content/${file}: ${what}`);
  };
  const goalIds = frameworks.goals.map((g) => g.id);
  if (new Set(goalIds).size !== 4) fail('frameworks.json', 'the four goals need four different ids');
  if (new Set(targets.map((t) => t.id)).size !== targets.length) fail('targets.json', 'two targets share an id');
  const sdgs = new Set(frameworks.sdgs.map((s) => s.n));
  const layers = new Map(layersData.map((l) => [l.id, l]));
  const palettes = new Set(PALETTES.map((p) => p.id));

  for (const t of targets) {
    if (t.supplementary ? t.goal : !t.goal) fail('targets.json', `${t.id} needs a "goal" (ES.1 to ES.4), unless it is "supplementary"`);
    if (t.goal && !goalIds.includes(t.goal)) fail('targets.json', `${t.id} names goal ${t.goal}, which isn't in frameworks.json`);
    for (const n of t.levels.global.sdg) if (!sdgs.has(n)) fail('targets.json', `${t.id} names SDG ${n}, which isn't in frameworks.json`);
    for (const a of t.actions) {
      if ('map' in a && !maps[a.map]) fail('targets.json', `${t.id} lists map "${a.map}", which isn't in maps.json`);
      if ('tool' in a && !tools[a.tool]) fail('targets.json', `${t.id} lists tool "${a.tool}", which isn't in tools.json`);
    }
  }
  for (const g of goalIds) if (!targets.some((t) => t.goal === g)) fail('targets.json', `goal ${g} has no targets`);

  const icons: Record<string, string> = {};
  for (const t of targets) {
    if (!t.icon) continue;
    const svg = iconFiles[`../content/icons/${t.icon}.svg`];
    if (!svg) fail('targets.json', `${t.id}'s icon "${t.icon}" isn't in cycle/content/icons/`);
    if (!/viewBox="0 0 32 32"/.test(svg!)) fail(`icons/${t.icon}.svg`, 'needs to be drawn 32 × 32 (viewBox="0 0 32 32"), like the rest of the set');
    icons[t.icon] = [...svg!.matchAll(/<path[^>]*\sd="([^"]+)"/g)].map((m) => m[1]).join('');
  }

  for (const [id, m] of Object.entries(maps)) {
    if (m.updating) continue;
    if (!m.layers.length) fail('maps.json', `${id} has no layers (or mark it "updating": true)`);
    for (const l of m.layers) {
      const known = layers.get(l.id);
      if (!known) fail('maps.json', `${id} uses "${l.id}", which isn't a Data Sandbox layer (dst/content/dst-layers.json)`);
      // Scored kind by kind in the Sandbox, which a recipe here can't say yet.
      if (known && 'categorical' in known) fail('maps.json', `${id} uses "${l.id}", a layer of kinds, which this page can't score yet`);
    }
    if (m.axes) {
      if (!m.layers.some((l) => l.axis === 0) || !m.layers.some((l) => l.axis === 1))
        fail('maps.json', `${id} has two scores, so it needs a layer on each ("axis": 0 and "axis": 1)`);
    } else {
      if (m.layers.some((l) => l.axis === 1)) fail('maps.json', `${id} has one score, so no layer takes "axis": 1 (or give it "axes")`);
      if (!m.palette || !palettes.has(m.palette)) fail('maps.json', `${id} needs a "palette", one of: ${[...palettes].join(', ')}`);
      if (!m.ends) fail('maps.json', `${id} needs "ends", the key's two labels`);
    }
  }
  // A path on this site, under whatever base it is served from.
  for (const tool of Object.values(tools)) if (tool.href?.startsWith('/')) tool.href = asset(tool.href);

  // What the page's script needs of each layer a map uses: where its tiles
  // are, its range, and its histogram (for where the thresholds start).
  const used = new Set(Object.values(maps).flatMap((m) => (m.updating ? [] : m.layers.map((l) => l.id))));
  const mapLayers = layersData
    .filter((l) => used.has(l.id))
    .map((l) => ({ id: l.id, name: l.name, src: tile(l.src), lo: l.lo, hi: l.hi, higher: l.higher as 'better' | 'worse', hist: l.hist }));

  return { frameworks, targets, maps, tools, mapLayers, icons };
}
