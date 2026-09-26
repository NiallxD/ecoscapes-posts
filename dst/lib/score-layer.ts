import type { CustomLayerInterface, CustomRenderMethodInput, Map as MlMap, OverscaledTileID } from 'maplibre-gl';
import { MAX_CRITERIA, RUNS, VARIATIONS, combineScores, criterionLut, valueOf, type Bivariate, type Criterion, type Op } from './model';
import type { TileReply, TileRequest } from './tile-worker';
import { PALETTES } from './palettes';

export { MAX_CRITERIA, combineScores, scoreOf, criterionLut, band, valueOf } from './model';
export type { Bivariate, Criterion, Op, ValueLayer } from './model';

/** The Data Sandbox's scored surface: a MapLibre custom layer that scores
 *  every pixel of up to eight layers' value tiles on the GPU.
 *
 *  - Each layer's tiles are fetched and decoded in a worker (tile-worker.ts)
 *    and kept as one small texture per layer per tile. Adding, removing or
 *    re-weighting a layer never touches the others' textures.
 *  - Each criterion's scoring is a 256-entry lookup table (model.ts), one row
 *    of a small texture. A slider changes that row and some uniforms: the map
 *    recolours on the next frame with no fetch and no decode.
 *  - A tile not yet loaded is drawn from the nearest ancestor that is, per
 *    layer, over just its own square -- never a blank while panning, and
 *    never two layers of colour on one spot. A tile is drawn only once every
 *    layer has something for it, so a half-loaded model never shows a score
 *    it does not have.
 *  - Requests are made nearest the middle of the view first, and dropped when
 *    the view moves on before they are answered. Behind them, a ring of tiles
 *    just outside the view, so a pan finds its new edge already loaded.
 *
 *  - In 3D the surface is laid on the terrain itself: drawn over MapLibre's
 *    own terrain tiles, on the same grid of points with the same triangles,
 *    lifted by the same elevation texture through the same matrix -- so it
 *    lies exactly on the ground, hidden behind a ridge as the ground is. The
 *    scoring is untouched, so the sliders are as quick as flat.
 *
 *  Mercator only. */

const TILE = 256;
const MINZ = 6;
const MAXZ = 12;
/** Requests in flight to the tile worker at once. */
const INFLIGHT = 24;
/** Textures kept (64 KB each on the GPU); the least recently drawn go first. */
const KEEP = 700;

/** Units across a tile in MapLibre's tile space, and the points across one
 *  of its terrain tiles (Terrain.meshSize). */
const EXTENT = 8192;
const MESH = 128;
/** Terrain tiles are drawn four times the size of a score tile (a 512 px
 *  source, one zoom down: TerrainTileManager.deltaZoom), so each is covered
 *  by scores from two zooms finer. */
const GROUND_DZ = 2;
/** Texture unit for the terrain's elevation, clear of the layers' and the
 *  lookup table's. */
const DEM_UNIT = MAX_CRITERIA + 1;

type Want = { key: string; src: string; z: number; x: number; y: number };
/** A square to score: a tile of the value layers, and in 3D the terrain tile
 *  it is drawn on and where in it. */
type Quad = {
  z: number;
  x: number;
  y: number;
  wrap: number;
  ground?: { id: OverscaledTileID; ox: number; oy: number; size: number; seg: number };
};

const VERT = `#version 300 es
uniform mat4 u_matrix;
uniform vec3 u_tile;   // mercator x, y, size
in vec2 a_pos;
out vec2 v_pos;
void main() {
  v_pos = a_pos;
  gl_Position = u_matrix * vec4(u_tile.xy + a_pos * u_tile.z, 0.0, 1.0);
}`;

// In 3D: a grid over part of a terrain tile, each point lifted as MapLibre's
// terrain shader lifts it (get_elevation in its prelude, copied here with
// plain uniforms) and projected with that tile's matrix.
const VERT3D = `#version 300 es
uniform mat4 u_matrix;
uniform vec3 u_quad;   // in the terrain tile: x, y, size (tile units)
uniform sampler2D u_terrain;
uniform mat4 u_terrain_matrix;
uniform vec4 u_terrain_unpack;
uniform float u_terrain_dim;
uniform float u_terrain_exaggeration;
in vec2 a_pos;
out vec2 v_pos;
float ele(ivec2 p) {
  vec4 rgb = (texelFetch(u_terrain, p, 0) * 255.0) * u_terrain_unpack;
  return rgb.r + rgb.g + rgb.b - u_terrain_unpack.a;
}
float elevation(vec2 pos) {
  vec2 coord = (u_terrain_matrix * vec4(pos, 0.0, 1.0)).xy * u_terrain_dim + 1.5;
  vec2 f = fract(coord);
  ivec2 c = ivec2(floor(coord));
  ivec2 hi = textureSize(u_terrain, 0) - 1;
  float tl = ele(clamp(c, ivec2(0), hi));
  float tr = ele(clamp(c + ivec2(1, 0), ivec2(0), hi));
  float bl = ele(clamp(c + ivec2(0, 1), ivec2(0), hi));
  float br = ele(clamp(c + ivec2(1, 1), ivec2(0), hi));
  return mix(mix(tl, tr, f.x), mix(bl, br, f.x), f.y) * u_terrain_exaggeration;
}
void main() {
  v_pos = a_pos;
  vec2 p = u_quad.xy + a_pos * u_quad.z;
  gl_Position = u_matrix * vec4(p, elevation(p), 1.0);
}`;

// One block per layer, written out rather than looped: GLSL ES 3.00 only
// indexes an array of samplers with a constant.
const slot = (i: number) => `
  if (u_n > ${i}) {
    float b = floor(texture(u_v[${i}], u_uv[${i}].xy + v_pos * u_uv[${i}].z).r * 255.0 + 0.5);
    if (b > 0.5) {
      float s = texelFetch(u_lut, ivec2(int(b), ${i}), 0).r;
      sv[${i}] = s;
      hv[${i}] = true;
      int k = u_mode == 1 && u_axis[${i}] > 0.5 ? 1 : 0;
      sum[k] += s * u_w[${i}];
      wsum[k] += u_w[${i}];
      lo[k] = min(lo[k], s);
      hi[k] = max(hi[k], s);
      seen[k]++;
    }
  }`;

const FRAG = `#version 300 es
precision highp float;
uniform sampler2D u_v[${MAX_CRITERIA}];
uniform sampler2D u_lut;       // 256 x ${MAX_CRITERIA}: each criterion's score for each byte
uniform vec3 u_uv[${MAX_CRITERIA}];     // where in its texture this tile's square is
uniform int u_n;
uniform int u_op;              // 0 weighted mean, 1 and (min), 2 or (max)
uniform float u_w[${MAX_CRITERIA}];
uniform float u_axis[${MAX_CRITERIA}];
uniform float u_opacity;
uniform float u_cut;           // one score: below this, nothing drawn (0 = all)
uniform int u_mode;            // 0 one score, 1 two scores (bivariate)
uniform vec4 u_brk;            // first axis low/high break, second axis low/high
uniform vec3 u_pal[9];
uniform int u_only;            // two scores: the one cell to draw, or -1
uniform int u_steady;          // 1: how steady, not the score (one score, weighted mean)
uniform float u_steadyCut;     // the cut-off each variation is judged against
uniform vec4 u_var[${RUNS * 2}];       // the ${RUNS} weight variations, ${MAX_CRITERIA} a run in two vec4s
in vec2 v_pos;
out vec4 frag;
uniform vec3 u_ramp[5];         // the palette (palettes.ts), low to high
vec3 ramp(float s) {
  // From near the ground's own dark to bright: a low score recedes into the
  // basemap, a high one stands out of it.
  vec3 c0 = u_ramp[0], c1 = u_ramp[1], c2 = u_ramp[2], c3 = u_ramp[3], c4 = u_ramp[4];
  s = clamp(s, 0.0, 1.0) * 4.0;
  if (s < 1.0) return mix(c0, c1, s);
  if (s < 2.0) return mix(c1, c2, s - 1.0);
  if (s < 3.0) return mix(c2, c3, s - 2.0);
  return mix(c3, c4, s - 3.0);
}
float combine(int op, float sum, float wsum, float lo, float hi) {
  return op == 1 ? lo : op == 2 ? hi : (wsum > 0.0 ? sum / wsum : 0.0);
}
int band(float s, float lo, float hi) {
  return s < lo ? 0 : s < hi ? 1 : 2;
}
void main() {
  // Both scores in one pass; with one score everything counts as the first.
  float sum[2] = float[2](0.0, 0.0), wsum[2] = float[2](0.0, 0.0);
  float lo[2] = float[2](1.0, 1.0), hi[2] = float[2](0.0, 0.0);
  int seen[2] = int[2](0, 0);
  float sv[${MAX_CRITERIA}];
  bool hv[${MAX_CRITERIA}];
  for (int i = 0; i < ${MAX_CRITERIA}; i++) { sv[i] = 0.0; hv[i] = false; }
${Array.from({ length: MAX_CRITERIA }, (_, i) => slot(i)).join('')}
  if (u_mode == 1) {
    // A place needs both scores to have a cell.
    if (seen[0] == 0 || seen[1] == 0) discard;
    int cell = band(combine(u_op, sum[1], wsum[1], lo[1], hi[1]), u_brk.z, u_brk.w) * 3 +
               band(combine(u_op, sum[0], wsum[0], lo[0], hi[0]), u_brk.x, u_brk.y);
    if (u_only >= 0 && cell != u_only) discard;
    float a = u_opacity * 0.92;
    frag = vec4(u_pal[cell] * a, a);
    return;
  }
  if (seen[0] == 0) discard;
  if (u_steady == 1) {
    // The same model with each weight nudged, ${RUNS} times: in how many does
    // this place still clear the cut-off?
    int pass = 0;
    for (int v = 0; v < ${RUNS}; v++) {
      vec4 a = u_var[v * 2], c = u_var[v * 2 + 1];
      float nudge[${MAX_CRITERIA}] = float[${MAX_CRITERIA}](a.x, a.y, a.z, a.w, c.x, c.y, c.z, c.w);
      float sm = 0.0, ws = 0.0;
      for (int i = 0; i < ${MAX_CRITERIA}; i++) {
        if (i >= u_n) break;
        if (!hv[i]) continue;
        float w = u_w[i] * nudge[i];
        sm += sv[i] * w;
        ws += w;
      }
      if (ws > 0.0 && sm / ws >= u_steadyCut) pass++;
    }
    float f = float(pass) / ${RUNS}.0;
    float a = u_opacity * mix(0.55, 0.95, f);
    frag = vec4(ramp(f) * a, a);
    return;
  }
  float score = combine(u_op, sum[0], wsum[0], lo[0], hi[0]);
  if (score < u_cut) discard;
  float a = u_opacity * mix(0.55, 0.95, score);
  frag = vec4(ramp(score) * a, a);
}`;

type Tex = { tex: WebGLTexture; used: number };

export class ScoreLayer implements CustomLayerInterface {
  id: string;
  type = 'custom' as const;
  /** In 3D, MapLibre's depth test and range for 3D -- the ones the terrain
   *  was drawn with, so the surface matches it depth for depth. */
  get renderingMode() {
    return this.map?.terrain ? ('3d' as const) : ('2d' as const);
  }

  private map!: MlMap;
  private gl!: WebGL2RenderingContext;
  private prog!: WebGLProgram;
  private prog3!: WebGLProgram;
  private loc3: Record<string, WebGLUniformLocation | null> = {};
  /** Grids for 3D, by points across: an array, its vertices and indices. */
  private meshes = new Map<number, { vao: WebGLVertexArrayObject; bufs: WebGLBuffer[]; count: number }>();
  private vao!: WebGLVertexArrayObject;
  private buf!: WebGLBuffer;
  private lutTex!: WebGLTexture;
  private empty!: WebGLTexture;
  private loc: Record<string, WebGLUniformLocation | null> = {};

  private criteria: Criterion[] = [];
  private op: Op = 'mean';
  private opacity = 0.85;
  private cut = 0;
  private bi: Bivariate | null = null;
  /** How steady, against this cut-off (0..1), or null for the score. */
  private steady: number | null = null;
  private lut = new Uint8Array(256 * MAX_CRITERIA);
  private ramp = new Float32Array(PALETTES[0].stops.flat().map((v) => v / 255));
  private lutDirty = true;

  private worker = new Worker(new URL('./tile-worker.ts', import.meta.url), { type: 'module' });
  /** Textures by `layer id/z/x/y`; a tile with no data shares `empty`. */
  private textures = new Map<string, Tex>();
  /** Requests in flight, by key, with the id the worker knows them by. */
  private inflight = new Map<string, number>();
  private queue: Want[] = [];
  private nextId = 1;
  private byId = new Map<number, { key: string; resolve?: (b: number) => void }>();
  private frame = 0;
  /** How many textures to keep: more while a flyover wants its whole path
   *  kept ready. */
  keep = KEEP;
  /** Told of each tile as it arrives, and how long its upload took (for the
   *  flyover's log). */
  onTile: ((key: string, ms: number) => void) | null = null;

  constructor(id: string) {
    this.id = id;
    this.worker.onmessage = (e: MessageEvent<TileReply>) => this.reply(e.data);
  }

  // ---- State ---------------------------------------------------------------
  /** Tiles still to come for the view itself (not the ring round it): 0 once
   *  everything in view is drawn. */
  get pending() {
    let n = 0;
    for (const k of this.visible) if (!this.textures.has(k)) n++;
    return n;
  }
  private visible = new Set<string>();
  /** Tiles asked of the worker or waiting to be, and textures held. */
  get loading() {
    return this.inflight.size + this.queue.length;
  }
  get held() {
    return this.textures.size;
  }

  setModel(criteria: Criterion[], op: Op) {
    this.criteria = criteria.slice(0, MAX_CRITERIA);
    this.op = op;
    this.criteria.forEach((c, i) => this.lut.set(criterionLut(c), i * 256));
    this.lutDirty = true;
    this.map?.triggerRepaint();
  }
  /** Two scores (bivariate) with these settings, or one score with null. */
  setBivariate(bi: Bivariate | null) {
    this.bi = bi;
    this.map?.triggerRepaint();
  }
  /** The colours one score is drawn in: five stops, low to high, 0..255. */
  setPalette(stops: number[][]) {
    this.ramp = new Float32Array(stops.flat().map((v) => v / 255));
    this.map?.triggerRepaint();
  }
  setOpacity(o: number) {
    this.opacity = o;
    this.map?.triggerRepaint();
  }
  /** Show how steady the result is -- in how many of the weight variations
   *  each place clears `cut` -- or null to show the score. */
  setSteady(cut: number | null) {
    this.steady = cut;
    this.map?.triggerRepaint();
  }
  /** Draw only places scoring at least this (0..1); 0 draws everything. */
  setCut(c: number) {
    this.cut = c;
    this.map?.triggerRepaint();
  }

  /** Get these layers' files ready (their headers and directories), so their
   *  first tiles are one request each when they are wanted. */
  warm(srcs: string[]) {
    this.post({ type: 'warm', srcs });
  }

  // ---- Tiles ---------------------------------------------------------------
  private post(m: TileRequest) {
    this.worker.postMessage(m);
  }

  private reply(m: TileReply) {
    const r = this.byId.get(m.id);
    this.byId.delete(m.id);
    if (!r) return;
    if (m.type === 'value') {
      r.resolve?.(m.byte);
      return;
    }
    this.inflight.delete(r.key);
    if (!this.gl) return;
    const t0 = performance.now();
    this.textures.set(r.key, { tex: m.data ? this.upload(m.data) : this.empty, used: this.frame });
    this.onTile?.(r.key, performance.now() - t0);
    this.pump();
    this.map.triggerRepaint();
  }

  private upload(data: Uint8Array) {
    const gl = this.gl;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, TILE, TILE, 0, gl.RED, gl.UNSIGNED_BYTE, data);
    this.nearest();
    return tex;
  }

  private nearest() {
    const gl = this.gl;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  /** Send queued requests, nearest the middle first, up to the limit. */
  private pump() {
    while (this.inflight.size < INFLIGHT && this.queue.length) {
      const q = this.queue.shift()!;
      if (this.textures.has(q.key) || this.inflight.has(q.key)) continue;
      const id = this.nextId++;
      this.inflight.set(q.key, id);
      this.byId.set(id, { key: q.key });
      this.post({ type: 'tile', id, src: q.src, z: q.z, x: q.x, y: q.y });
    }
  }

  /** The tiles this view wants, in order: the queue is rebuilt from them, and
   *  anything in flight they no longer include is called off. */
  private want(list: Want[]) {
    const keys = new Set(list.map((q) => q.key));
    const drop: number[] = [];
    for (const [key, id] of this.inflight)
      if (!keys.has(key)) {
        drop.push(id);
        this.inflight.delete(key);
        this.byId.delete(id);
      }
    if (drop.length) this.post({ type: 'cancel', ids: drop });
    this.queue = list.filter((q) => !this.textures.has(q.key) && !this.inflight.has(q.key));
    this.pump();
  }

  /** The best texture for a layer's tile: its own, or the nearest ancestor's
   *  with where in it this tile sits. */
  private find(layerId: string, z: number, x: number, y: number) {
    for (let az = z, ax = x, ay = y; az >= MINZ; az--, ax >>= 1, ay >>= 1) {
      const t = this.textures.get(`${layerId}/${az}/${ax}/${ay}`);
      if (t) {
        const k = 2 ** (z - az);
        return { t, u: (x - ax * k) / k, v: (y - ay * k) / k, s: 1 / k };
      }
    }
    return null;
  }

  // ---- Explaining a point ------------------------------------------------------
  private byteAt(src: string, lng: number, lat: number) {
    const n = 2 ** MAXZ;
    const fx = ((lng + 180) / 360) * n;
    const r = (lat * Math.PI) / 180;
    const fy = ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n;
    const x = Math.floor(fx), y = Math.floor(fy);
    const px = Math.min(TILE - 1, Math.floor((fx - x) * TILE));
    const py = Math.min(TILE - 1, Math.floor((fy - y) * TILE));
    return new Promise<number>((resolve) => {
      const id = this.nextId++;
      this.byId.set(id, { key: '', resolve });
      this.post({ type: 'value', id, src, z: MAXZ, x, y, px, py });
    });
  }

  /** Every criterion's value and score at a point at full detail, and the
   *  combined score -- from the same lookup tables as the map, so the number
   *  a tap gives is the one the map draws. */
  async explain(lng: number, lat: number) {
    const cs = this.criteria;
    const lut = this.lut.slice();
    const rows = await Promise.all(
      cs.map(async (c, i) => {
        const b = await this.byteAt(c.layer.src, lng, lat);
        if (!b) return { c, value: null as number | null, score: null as number | null };
        return { c, value: valueOf(c.layer, b), score: lut[i * 256 + b] / 255 };
      }),
    );
    // One score, or with two scores one for each axis.
    const total = (axis?: 0 | 1) =>
      combineScores(
        rows
          .filter((r) => r.score !== null && (axis === undefined || (r.c.axis ?? 0) === axis))
          .map((r) => ({ score: r.score!, weight: r.c.weight })),
        this.op,
      );
    return this.bi ? { rows, total: total(0), second: total(1) } : { rows, total: total(), second: null };
  }

  // ---- GL ------------------------------------------------------------------
  onAdd(map: MlMap, context: WebGLRenderingContext | WebGL2RenderingContext) {
    this.map = map;
    if (!('texStorage3D' in context)) throw new Error('The Data Sandbox needs WebGL2');
    const gl = (this.gl = context);
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader');
      return s;
    };
    const link = (vert: string, loc: Record<string, WebGLUniformLocation | null>, extra: string[]) => {
      const p = gl.createProgram()!;
      gl.attachShader(p, sh(gl.VERTEX_SHADER, vert));
      gl.attachShader(p, sh(gl.FRAGMENT_SHADER, FRAG));
      gl.bindAttribLocation(p, 0, 'a_pos');
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'link');
      for (const u of ['u_matrix', 'u_ramp', 'u_v', 'u_lut', 'u_uv', 'u_n', 'u_op', 'u_w', 'u_axis', 'u_opacity',
        'u_cut', 'u_mode', 'u_brk', 'u_pal', 'u_only', 'u_steady', 'u_steadyCut', 'u_var', ...extra])
        loc[u] = gl.getUniformLocation(p, u);
      return p;
    };
    const p = (this.prog = link(VERT, this.loc, ['u_tile']));
    this.prog3 = link(VERT3D, this.loc3, ['u_quad', 'u_terrain', 'u_terrain_matrix', 'u_terrain_unpack',
      'u_terrain_dim', 'u_terrain_exaggeration']);

    // Its own vertex array, so nothing here touches MapLibre's.
    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);
    this.buf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(p, 'a_pos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);

    // The lookup tables, and one pixel of "no data" for tiles that have none.
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    this.lutTex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.lutTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, 256, MAX_CRITERIA, 0, gl.RED, gl.UNSIGNED_BYTE, this.lut);
    this.nearest();
    this.empty = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.empty);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, 1, 1, 0, gl.RED, gl.UNSIGNED_BYTE, new Uint8Array(1));
    this.nearest();
  }

  onRemove() {
    const gl = this.gl;
    for (const t of this.textures.values()) if (t.tex !== this.empty) gl.deleteTexture(t.tex);
    this.textures.clear();
    gl.deleteTexture(this.lutTex);
    gl.deleteTexture(this.empty);
    gl.deleteProgram(this.prog);
    gl.deleteProgram(this.prog3);
    for (const m of this.meshes.values()) {
      gl.deleteVertexArray(m.vao);
      for (const b of m.bufs) gl.deleteBuffer(b);
    }
    this.meshes.clear();
    gl.deleteBuffer(this.buf);
    gl.deleteVertexArray(this.vao);
    this.worker.terminate();
  }

  /** Least recently drawn textures go once there are too many. */
  private evict() {
    if (this.textures.size <= this.keep) return;
    const old = [...this.textures.entries()]
      .filter(([, t]) => t.used < this.frame)
      .sort((a, b) => a[1].used - b[1].used)
      .slice(0, this.textures.size - this.keep + 100);
    for (const [k, t] of old) {
      if (t.tex !== this.empty) this.gl.deleteTexture(t.tex);
      this.textures.delete(k);
    }
  }

  /** A grid `seg` squares across over 0..1, split into triangles as the
   *  terrain's own mesh is (Terrain.getTerrainMesh): each square from its
   *  top left to its bottom right. */
  private mesh(seg: number) {
    const have = this.meshes.get(seg);
    if (have) return have;
    const gl = this.gl;
    const n = seg + 1;
    const pos = new Float32Array(n * n * 2);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) pos.set([x / seg, y / seg], (y * n + x) * 2);
    const idx = new Uint16Array(seg * seg * 6);
    let k = 0;
    for (let y = 0; y < seg; y++)
      for (let x = 0; x < seg; x++) {
        const a = y * n + x;
        idx.set([a, a + n, a + n + 1, a, a + n + 1, a + 1], k);
        k += 6;
      }
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    const vb = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, vb);
    gl.bufferData(gl.ARRAY_BUFFER, pos, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    const ib = gl.createBuffer()!;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    const m = { vao, bufs: [vb, ib], count: idx.length };
    this.meshes.set(seg, m);
    return m;
  }

  /** The squares to score in 3D: every terrain tile MapLibre is drawing, cut
   *  into the score tiles two zooms finer (or coarser, at the ends of the
   *  layers' zoom range). Each gets the part of the terrain tile's grid it
   *  covers, so its points are the terrain's own. */
  private onGround(terrain: NonNullable<MlMap['terrain']>): Quad[] {
    const quads: Quad[] = [];
    for (const tile of terrain.tileManager.getRenderableTiles()) {
      if (!tile) continue;
      const id = tile.tileID;
      const { z, x, y } = id.canonical;
      const cz = Math.min(MAXZ, Math.max(MINZ, z + GROUND_DZ));
      const d = Math.min(Math.log2(MESH), Math.max(0, cz - z));
      const n = 1 << d;
      const size = EXTENT / n;
      for (let j = 0; j < n; j++)
        for (let i = 0; i < n; i++)
          quads.push({
            z: z + d, x: x * n + i, y: y * n + j, wrap: id.wrap,
            ground: { id, ox: i * size, oy: j * size, size, seg: MESH >> d },
          });
    }
    return quads;
  }

  render(gl: WebGLRenderingContext | WebGL2RenderingContext, opts: CustomRenderMethodInput) {
    const g = gl as WebGL2RenderingContext;
    const cs = this.criteria;
    if (!cs.length) {
      this.visible = new Set();
      this.want([]);
      return;
    }
    this.frame++;
    const terrain = this.map.terrain;
    const quads: Quad[] = terrain
      ? this.onGround(terrain)
      : this.map.coveringTiles({ tileSize: TILE, minzoom: MINZ, maxzoom: MAXZ }).map((t) => ({
          z: t.canonical.z, x: t.canonical.x, y: t.canonical.y, wrap: t.wrap,
        }));

    // What this view needs, nearest the middle first -- measured across the
    // world, as in 3D the squares are of many zooms.
    const c = this.map.getCenter();
    const mx = (c.lng + 180) / 360;
    const lat = (c.lat * Math.PI) / 180;
    const my = (1 - Math.log(Math.tan(lat) + 1 / Math.cos(lat)) / Math.PI) / 2;
    const dist = (z: number, x: number, y: number) => ((x + 0.5) / 2 ** z - mx) ** 2 + ((y + 0.5) / 2 ** z - my) ** 2;
    const list: Want[] = [];
    const seen = new Set<string>();
    const add = (z: number, x: number, y: number) => {
      // Past the layers' finest zoom, the tile there that holds this one.
      if (z > MAXZ) [x, y, z] = [x >> (z - MAXZ), y >> (z - MAXZ), MAXZ];
      if (seen.has(`${z}/${x}/${y}`)) return;
      seen.add(`${z}/${x}/${y}`);
      for (const cr of cs) list.push({ key: `${cr.layer.id}/${z}/${x}/${y}`, src: cr.layer.src, z, x, y });
    };
    const sorted = [...quads].sort((a, b) => dist(a.z, a.x, a.y) - dist(b.z, b.x, b.y));
    for (const q of sorted) add(q.z, q.x, q.y);
    this.visible = new Set(list.map((q) => q.key));
    // The ring round the view, once everything in it has come -- so it never
    // competes with what can be seen -- and not while zoomed far out, where
    // the view is most of the study area already. Flat only: tilted, the
    // view already reaches to the horizon.
    const z = quads[0]?.z ?? MINZ;
    const inView = list.every((q) => this.textures.has(q.key));
    if (!terrain && inView && z >= 9 && quads.length) {
      const xs = quads.map((t) => t.x), ys = quads.map((t) => t.y);
      const [x0, x1, y0, y1] = [Math.min(...xs) - 1, Math.max(...xs) + 1, Math.min(...ys) - 1, Math.max(...ys) + 1];
      const ring: [number, number][] = [];
      for (let x = x0; x <= x1; x++) ring.push([x, y0], [x, y1]);
      for (let y = y0 + 1; y < y1; y++) ring.push([x0, y], [x1, y]);
      ring.sort((a, b) => dist(z, a[0], a[1]) - dist(z, b[0], b[1]));
      for (const [x, y] of ring) if (x >= 0 && y >= 0 && x < 2 ** z && y < 2 ** z) add(z, x, y);
    }
    this.want(list);

    const loc = terrain ? this.loc3 : this.loc;
    g.useProgram(terrain ? this.prog3 : this.prog);
    g.activeTexture(g.TEXTURE0 + MAX_CRITERIA);
    g.bindTexture(g.TEXTURE_2D, this.lutTex);
    if (this.lutDirty) {
      g.pixelStorei(g.UNPACK_ALIGNMENT, 1);
      g.texSubImage2D(g.TEXTURE_2D, 0, 0, 0, 256, MAX_CRITERIA, g.RED, g.UNSIGNED_BYTE, this.lut);
      this.lutDirty = false;
    }
    if (!terrain) g.uniformMatrix4fv(loc.u_matrix, false, opts.defaultProjectionData.mainMatrix as Float32Array);
    g.uniform1iv(loc.u_v, UNITS);
    g.uniform1i(loc.u_lut, MAX_CRITERIA);
    g.uniform3fv(loc.u_ramp, this.ramp);
    g.uniform1i(loc.u_n, cs.length);
    g.uniform1i(loc.u_op, this.op === 'and' ? 1 : this.op === 'or' ? 2 : 0);
    const pad = (a: number[]) => [...a, ...Array(MAX_CRITERIA - a.length).fill(0)];
    g.uniform1fv(loc.u_w, pad(cs.map((c) => c.weight)));
    g.uniform1fv(loc.u_axis, pad(cs.map((c) => c.axis ?? 0)));
    g.uniform1f(loc.u_opacity, this.opacity);
    g.uniform1f(loc.u_cut, this.cut);
    const steady = this.steady !== null && !this.bi && this.op === 'mean';
    g.uniform1i(loc.u_steady, steady ? 1 : 0);
    if (steady) {
      g.uniform1f(loc.u_steadyCut, this.steady!);
      g.uniform4fv(loc.u_var, VARIATIONS);
    }
    const bi = this.bi;
    g.uniform1i(loc.u_mode, bi ? 1 : 0);
    if (bi) {
      g.uniform4f(loc.u_brk, bi.breaks[0][0], bi.breaks[0][1], bi.breaks[1][0], bi.breaks[1][1]);
      g.uniform3fv(loc.u_pal, bi.palette.flatMap(rgb01));
      g.uniform1i(loc.u_only, bi.only);
    }

    g.enable(g.BLEND);
    g.blendFunc(g.ONE, g.ONE_MINUS_SRC_ALPHA);
    g.disable(g.STENCIL_TEST);
    if (terrain) {
      // Tested against the ground MapLibre has drawn (its depth test and
      // range, from renderingMode) but not written: the layers drawn after
      // this one still lie on the ground rather than behind the scores. Drawn
      // a hair toward the eye so the two surfaces never fight.
      g.depthMask(false);
      g.enable(g.POLYGON_OFFSET_FILL);
      g.polygonOffset(-1, -2);
      g.uniform1i(loc.u_terrain, DEM_UNIT);
    } else {
      g.bindVertexArray(this.vao);
      g.disable(g.DEPTH_TEST);
    }

    const uv = new Float32Array(3 * MAX_CRITERIA);
    let on: OverscaledTileID | null = null;
    quad: for (const q of quads) {
      for (let i = 0; i < cs.length; i++) {
        const f = this.find(cs[i].layer.id, q.z, q.x, q.y);
        // Every layer needs something here before the square is drawn.
        if (!f) continue quad;
        f.t.used = this.frame;
        g.activeTexture(g.TEXTURE0 + i);
        g.bindTexture(g.TEXTURE_2D, f.t.tex);
        uv[i * 3] = f.u;
        uv[i * 3 + 1] = f.v;
        uv[i * 3 + 2] = f.s;
      }
      g.uniform3fv(loc.u_uv, uv);
      const gr = q.ground;
      if (!gr || !terrain) {
        const size = 1 / 2 ** q.z;
        g.uniform3f(loc.u_tile, q.x * size + q.wrap, q.y * size, size);
        g.drawArrays(g.TRIANGLE_STRIP, 0, 4);
        continue;
      }
      // The terrain tile's elevation and matrix, once for all its squares.
      if (on !== gr.id) {
        on = gr.id;
        const td = terrain.getTerrainData(gr.id);
        g.activeTexture(g.TEXTURE0 + DEM_UNIT);
        g.bindTexture(g.TEXTURE_2D, td.texture);
        g.uniformMatrix4fv(loc.u_terrain_matrix, false, Float32Array.from(td.u_terrain_matrix as ArrayLike<number>));
        g.uniform4fv(loc.u_terrain_unpack, td.u_terrain_unpack);
        g.uniform1f(loc.u_terrain_dim, td.u_terrain_dim);
        g.uniform1f(loc.u_terrain_exaggeration, td.u_terrain_exaggeration);
        const pd = opts.getProjectionData({ tileID: { wrap: gr.id.wrap, canonical: gr.id.canonical }, applyTerrainMatrix: false });
        g.uniformMatrix4fv(loc.u_matrix, false, pd.mainMatrix as Float32Array);
      }
      g.uniform3f(loc.u_quad, gr.ox, gr.oy, gr.size);
      const m = this.mesh(gr.seg);
      g.bindVertexArray(m.vao);
      g.drawElements(g.TRIANGLES, m.count, g.UNSIGNED_SHORT, 0);
    }
    g.bindVertexArray(null);
    g.disable(g.POLYGON_OFFSET_FILL);
    g.depthMask(true);
    g.activeTexture(g.TEXTURE0);
    this.evict();
  }
}

const UNITS = Array.from({ length: MAX_CRITERIA }, (_, i) => i);
const rgb01 = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
