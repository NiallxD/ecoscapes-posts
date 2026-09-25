import type { CustomLayerInterface, CustomRenderMethodInput, Map as MlMap } from 'maplibre-gl';
import { MAX_CRITERIA, RUNS, VARIATIONS, combineScores, criterionLut, valueOf, type Bivariate, type Criterion, type Op } from './model';
import type { TileReply, TileRequest } from './tile-worker';

export { MAX_CRITERIA, combineScores, scoreOf, criterionLut, band, valueOf } from './model';
export type { Bivariate, Criterion, Op, ValueLayer } from './model';

/** The planning map's scored surface: a MapLibre custom layer that scores
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
 *  Mercator only. */

const TILE = 256;
const MINZ = 6;
const MAXZ = 12;
/** Requests in flight to the tile worker at once. */
const INFLIGHT = 24;
/** Textures kept (64 KB each on the GPU); the least recently drawn go first. */
const KEEP = 700;

type Want = { key: string; src: string; z: number; x: number; y: number };

const VERT = `#version 300 es
uniform mat4 u_matrix;
uniform vec3 u_tile;   // mercator x, y, size
in vec2 a_pos;
out vec2 v_pos;
void main() {
  v_pos = a_pos;
  gl_Position = u_matrix * vec4(u_tile.xy + a_pos * u_tile.z, 0.0, 1.0);
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
vec3 ramp(float s) {
  // One hue, amber, from near the ground's own dark to bright: a low score
  // recedes into the basemap, a high one stands out of it.
  vec3 c0 = vec3(0.176, 0.137, 0.094);
  vec3 c1 = vec3(0.435, 0.278, 0.071);
  vec3 c2 = vec3(0.706, 0.431, 0.059);
  vec3 c3 = vec3(0.914, 0.620, 0.122);
  vec3 c4 = vec3(1.000, 0.867, 0.502);
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
  renderingMode = '2d' as const;

  private map!: MlMap;
  private gl!: WebGL2RenderingContext;
  private prog!: WebGLProgram;
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
    this.textures.set(r.key, { tex: m.data ? this.upload(m.data) : this.empty, used: this.frame });
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
    if (!('texStorage3D' in context)) throw new Error('The planning map needs WebGL2');
    const gl = (this.gl = context);
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader');
      return s;
    };
    const p = gl.createProgram()!;
    gl.attachShader(p, sh(gl.VERTEX_SHADER, VERT));
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'link');
    this.prog = p;
    for (const u of ['u_matrix', 'u_tile', 'u_v', 'u_lut', 'u_uv', 'u_n', 'u_op', 'u_w', 'u_axis', 'u_opacity',
      'u_cut', 'u_mode', 'u_brk', 'u_pal', 'u_only', 'u_steady', 'u_steadyCut', 'u_var'])
      this.loc[u] = gl.getUniformLocation(p, u);

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
    gl.deleteBuffer(this.buf);
    gl.deleteVertexArray(this.vao);
    this.worker.terminate();
  }

  /** Least recently drawn textures go once there are too many. */
  private evict() {
    if (this.textures.size <= KEEP) return;
    const old = [...this.textures.entries()]
      .filter(([, t]) => t.used < this.frame)
      .sort((a, b) => a[1].used - b[1].used)
      .slice(0, this.textures.size - KEEP + 100);
    for (const [k, t] of old) {
      if (t.tex !== this.empty) this.gl.deleteTexture(t.tex);
      this.textures.delete(k);
    }
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
    const tiles = this.map.coveringTiles({ tileSize: TILE, minzoom: MINZ, maxzoom: MAXZ });

    // What this view needs, nearest the middle first.
    const c = this.map.getCenter();
    const n = 2 ** (tiles[0]?.canonical.z ?? MINZ);
    const mx = ((c.lng + 180) / 360) * n;
    const lat = (c.lat * Math.PI) / 180;
    const my = ((1 - Math.log(Math.tan(lat) + 1 / Math.cos(lat)) / Math.PI) / 2) * n;
    const dist = (t: (typeof tiles)[number]) => (t.canonical.x + 0.5 - mx) ** 2 + (t.canonical.y + 0.5 - my) ** 2;
    const list: Want[] = [];
    const add = (z: number, x: number, y: number) => {
      for (const cr of cs) list.push({ key: `${cr.layer.id}/${z}/${x}/${y}`, src: cr.layer.src, z, x, y });
    };
    const sorted = [...tiles].sort((a, b) => dist(a) - dist(b));
    for (const t of sorted) add(t.canonical.z, t.canonical.x, t.canonical.y);
    this.visible = new Set(list.map((q) => q.key));
    // The ring round the view, once everything in it has come -- so it never
    // competes with what can be seen -- and not while zoomed far out, where
    // the view is most of the study area already.
    const z = tiles[0]?.canonical.z ?? MINZ;
    const inView = list.every((q) => this.textures.has(q.key));
    if (inView && z >= 9 && tiles.length) {
      const xs = tiles.map((t) => t.canonical.x), ys = tiles.map((t) => t.canonical.y);
      const [x0, x1, y0, y1] = [Math.min(...xs) - 1, Math.max(...xs) + 1, Math.min(...ys) - 1, Math.max(...ys) + 1];
      const ring: [number, number][] = [];
      for (let x = x0; x <= x1; x++) ring.push([x, y0], [x, y1]);
      for (let y = y0 + 1; y < y1; y++) ring.push([x0, y], [x1, y]);
      ring.sort((a, b) => (a[0] + 0.5 - mx) ** 2 + (a[1] + 0.5 - my) ** 2 - ((b[0] + 0.5 - mx) ** 2 + (b[1] + 0.5 - my) ** 2));
      for (const [x, y] of ring) if (x >= 0 && y >= 0 && x < 2 ** z && y < 2 ** z) add(z, x, y);
    }
    this.want(list);

    g.useProgram(this.prog);
    g.activeTexture(g.TEXTURE0 + MAX_CRITERIA);
    g.bindTexture(g.TEXTURE_2D, this.lutTex);
    if (this.lutDirty) {
      g.pixelStorei(g.UNPACK_ALIGNMENT, 1);
      g.texSubImage2D(g.TEXTURE_2D, 0, 0, 0, 256, MAX_CRITERIA, g.RED, g.UNSIGNED_BYTE, this.lut);
      this.lutDirty = false;
    }
    g.uniformMatrix4fv(this.loc.u_matrix, false, opts.defaultProjectionData.mainMatrix as Float32Array);
    g.uniform1iv(this.loc.u_v, UNITS);
    g.uniform1i(this.loc.u_lut, MAX_CRITERIA);
    g.uniform1i(this.loc.u_n, cs.length);
    g.uniform1i(this.loc.u_op, this.op === 'and' ? 1 : this.op === 'or' ? 2 : 0);
    const pad = (a: number[]) => [...a, ...Array(MAX_CRITERIA - a.length).fill(0)];
    g.uniform1fv(this.loc.u_w, pad(cs.map((c) => c.weight)));
    g.uniform1fv(this.loc.u_axis, pad(cs.map((c) => c.axis ?? 0)));
    g.uniform1f(this.loc.u_opacity, this.opacity);
    g.uniform1f(this.loc.u_cut, this.cut);
    const steady = this.steady !== null && !this.bi && this.op === 'mean';
    g.uniform1i(this.loc.u_steady, steady ? 1 : 0);
    if (steady) {
      g.uniform1f(this.loc.u_steadyCut, this.steady!);
      g.uniform4fv(this.loc.u_var, VARIATIONS);
    }
    const bi = this.bi;
    g.uniform1i(this.loc.u_mode, bi ? 1 : 0);
    if (bi) {
      g.uniform4f(this.loc.u_brk, bi.breaks[0][0], bi.breaks[0][1], bi.breaks[1][0], bi.breaks[1][1]);
      g.uniform3fv(this.loc.u_pal, bi.palette.flatMap(rgb01));
      g.uniform1i(this.loc.u_only, bi.only);
    }

    g.bindVertexArray(this.vao);
    g.enable(g.BLEND);
    g.blendFunc(g.ONE, g.ONE_MINUS_SRC_ALPHA);
    g.disable(g.DEPTH_TEST);
    g.disable(g.STENCIL_TEST);

    const uv = new Float32Array(3 * MAX_CRITERIA);
    tile: for (const id of tiles) {
      const { z, x, y } = id.canonical;
      for (let i = 0; i < cs.length; i++) {
        const f = this.find(cs[i].layer.id, z, x, y);
        // Every layer needs something here before the tile is drawn.
        if (!f) continue tile;
        f.t.used = this.frame;
        g.activeTexture(g.TEXTURE0 + i);
        g.bindTexture(g.TEXTURE_2D, f.t.tex);
        uv[i * 3] = f.u;
        uv[i * 3 + 1] = f.v;
        uv[i * 3 + 2] = f.s;
      }
      const size = 1 / 2 ** z;
      g.uniform3fv(this.loc.u_uv, uv);
      g.uniform3f(this.loc.u_tile, x * size + id.wrap, y * size, size);
      g.drawArrays(g.TRIANGLE_STRIP, 0, 4);
    }
    g.bindVertexArray(null);
    g.activeTexture(g.TEXTURE0);
    this.evict();
  }
}

const UNITS = Array.from({ length: MAX_CRITERIA }, (_, i) => i);
const rgb01 = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);

/** A threshold in a layer's own units as the byte it would be stored as. */
export function thresholdByte(layer: { lo: number; hi: number }, t: number) {
  return 1 + ((t - layer.lo) / (layer.hi - layer.lo || 1)) * 254;
}
