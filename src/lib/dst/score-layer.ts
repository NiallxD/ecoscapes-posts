import type { CustomLayerInterface, CustomRenderMethodInput, Map as MlMap } from 'maplibre-gl';
import { PMTiles } from 'pmtiles';

/** The decision-support map's scored surface: a MapLibre custom layer that
 *  reads each criterion's value tiles (tools/prepare-value-layer.py -- one
 *  byte a pixel, 0 for no data) and scores every pixel on the GPU. The value
 *  tiles are fetched once; a slider only changes the uniforms, so the map
 *  recolours on the next frame with no fetch and no re-decode -- the same
 *  promise as the RRN demo's paint expressions, on a 24 m grid rather than
 *  hexagons. Mercator only. */

export type Op = 'mean' | 'and' | 'or';
export type ValueLayer = { id: string; src: string; lo: number; hi: number };
/** `axis` only matters in two-score mode: which of the two scores a layer
 *  feeds (0 across, 1 up). */
export type Criterion = { layer: ValueLayer; weight: number; good: number; bad: number; axis?: 0 | 1 };
/** Two-score (bivariate) settings: where each axis breaks into low / middle /
 *  high (0..1), the nine colours (row = second axis, low to high; column =
 *  first), and one cell to show alone, or -1. */
export type Bivariate = { breaks: [[number, number], [number, number]]; palette: string[]; only: number };

const TILE = 256;
const MINZ = 6;
const MAXZ = 12;
/** Criteria the shader takes at once. WebGL2 guarantees far more texture
 *  layers than this; the limit is what a person can weigh against each other. */
export const MAX_CRITERIA = 8;

const VERT = `#version 300 es
uniform mat4 u_matrix;
uniform vec3 u_tile;   // mercator x, y, size
uniform vec3 u_uv;     // texture u, v, size (a sub-rect when drawing an ancestor)
in vec2 a_pos;
out vec2 v_uv;
void main() {
  v_uv = u_uv.xy + a_pos * u_uv.z;
  gl_Position = u_matrix * vec4(u_tile.xy + a_pos * u_tile.z, 0.0, 1.0);
}`;

// Scores in byte space: a threshold is turned into the byte it would be
// stored as, so the shader never needs a layer's range. Same ramp as RRN's
// fuzzyConvert -- 0 at \`bad\`, 1 at \`good\`, straight between, clamped; a
// good below bad simply means lower is better.
const FRAG = `#version 300 es
precision highp float;
precision highp sampler2DArray;
uniform sampler2DArray u_vals;
uniform int u_n;
uniform int u_op;              // 0 weighted mean, 1 and (min), 2 or (max)
uniform float u_w[${MAX_CRITERIA}];
uniform float u_bad[${MAX_CRITERIA}];
uniform float u_good[${MAX_CRITERIA}];
uniform float u_opacity;
uniform float u_cut;           // below this score, nothing drawn (0 = all)
uniform int u_mode;            // 0 one score, 1 two scores (bivariate)
uniform float u_axis[${MAX_CRITERIA}];
uniform vec4 u_brk;            // first axis low/high break, second axis low/high
uniform vec3 u_pal[9];
uniform int u_only;            // two scores: the one cell to draw, or -1
in vec2 v_uv;
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
  // Both scores in one pass; in one-score mode everything counts as the first.
  float sum[2] = float[2](0.0, 0.0), wsum[2] = float[2](0.0, 0.0);
  float lo[2] = float[2](1.0, 1.0), hi[2] = float[2](0.0, 0.0);
  int seen[2] = int[2](0, 0);
  for (int i = 0; i < ${MAX_CRITERIA}; i++) {
    if (i >= u_n) break;
    float b = floor(texture(u_vals, vec3(v_uv, float(i))).r * 255.0 + 0.5);
    if (b < 0.5) continue;                       // no data: left out
    float d = u_good[i] - u_bad[i];
    float s = abs(d) < 1e-4 ? step(u_good[i], b) : clamp((b - u_bad[i]) / d, 0.0, 1.0);
    int k = u_mode == 1 && u_axis[i] > 0.5 ? 1 : 0;
    sum[k] += s * u_w[i];
    wsum[k] += u_w[i];
    lo[k] = min(lo[k], s);
    hi[k] = max(hi[k], s);
    seen[k]++;
  }
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
  float score = combine(u_op, sum[0], wsum[0], lo[0], hi[0]);
  if (score < u_cut) discard;
  float a = u_opacity * mix(0.55, 0.95, score);
  frag = vec4(ramp(score) * a, a);
}`;

type GpuTile = { tex: WebGLTexture; sig: string; used: number };

export class ScoreLayer implements CustomLayerInterface {
  id: string;
  type = 'custom' as const;
  renderingMode = '2d' as const;

  private map!: MlMap;
  private gl!: WebGL2RenderingContext;
  private prog!: WebGLProgram;
  private buf!: WebGLBuffer;
  private vao!: WebGLVertexArrayObject;
  private loc: Record<string, WebGLUniformLocation | null> = {};

  private criteria: Criterion[] = [];
  private op: Op = 'mean';
  private opacity = 0.85;
  private cut = 0;
  private bi: Bivariate | null = null;

  private archives = new Map<string, PMTiles>();
  /** Decoded value tiles, per layer and tile: shared by the GPU upload and
   *  by explaining a point. */
  private values = new Map<string, Promise<Uint8Array | null>>();
  private gpu = new Map<string, GpuTile>();
  private building = new Set<string>();
  private frame = 0;

  constructor(id: string) {
    this.id = id;
  }

  // ---- State ---------------------------------------------------------------
  /** Two scores (bivariate) with these settings, or one score with null. */
  setBivariate(bi: Bivariate | null) {
    this.bi = bi;
    this.map?.triggerRepaint();
  }

  setModel(criteria: Criterion[], op: Op) {
    const sig = (cs: Criterion[]) => cs.map((c) => c.layer.id).join(',');
    if (sig(criteria) !== sig(this.criteria)) this.dropGpu();
    this.criteria = criteria.slice(0, MAX_CRITERIA);
    this.op = op;
    this.map?.triggerRepaint();
  }
  setOpacity(o: number) {
    this.opacity = o;
    this.map?.triggerRepaint();
  }
  /** Draw only places scoring at least this (0..1); 0 draws everything. */
  setCut(c: number) {
    this.cut = c;
    this.map?.triggerRepaint();
  }

  // ---- Values --------------------------------------------------------------
  private archive(layer: ValueLayer) {
    let a = this.archives.get(layer.id);
    if (!a) this.archives.set(layer.id, (a = new PMTiles(new URL(layer.src, location.href).href)));
    return a;
  }

  /** One layer's bytes for one tile, 256x256, or null where it has no data. */
  tileValues(layer: ValueLayer, z: number, x: number, y: number): Promise<Uint8Array | null> {
    const key = `${layer.id}/${z}/${x}/${y}`;
    let p = this.values.get(key);
    if (!p) {
      p = (async () => {
        const t = await this.archive(layer).getZxy(z, x, y);
        if (!t) return null;
        // Straight bytes out: no colour management, no premultiplying. The
        // tiles are greyscale with no alpha, so R is the value.
        const bmp = await createImageBitmap(new Blob([t.data], { type: 'image/webp' }), {
          colorSpaceConversion: 'none',
          premultiplyAlpha: 'none',
        });
        const c = new OffscreenCanvas(TILE, TILE);
        const ctx = c.getContext('2d', { willReadFrequently: true })!;
        ctx.drawImage(bmp, 0, 0);
        bmp.close();
        const rgba = ctx.getImageData(0, 0, TILE, TILE).data;
        const out = new Uint8Array(TILE * TILE);
        for (let i = 0; i < out.length; i++) out[i] = rgba[i * 4];
        return out;
      })().catch(() => null);
      this.values.set(key, p);
      // A soft cap: about 25 MB of decoded tiles.
      if (this.values.size > 400) this.values.delete(this.values.keys().next().value!);
    }
    return p;
  }

  /** Every criterion's value and score at a point, and the combined score --
   *  the same arithmetic as the shader, for saying why a place scored what it
   *  did. */
  async explain(lng: number, lat: number) {
    const n = 2 ** MAXZ;
    const fx = ((lng + 180) / 360) * n;
    const r = (lat * Math.PI) / 180;
    const fy = ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n;
    const x = Math.floor(fx), y = Math.floor(fy);
    const px = Math.min(TILE - 1, Math.floor((fx - x) * TILE));
    const py = Math.min(TILE - 1, Math.floor((fy - y) * TILE));
    const rows = await Promise.all(
      this.criteria.map(async (c) => {
        const v = await this.tileValues(c.layer, MAXZ, x, y);
        const b = v ? v[py * TILE + px] : 0;
        if (!b) return { c, value: null as number | null, score: null as number | null };
        const value = c.layer.lo + ((b - 1) / 254) * (c.layer.hi - c.layer.lo);
        return { c, value, score: scoreOf(c, value) };
      }),
    );
    // One score, or in two-score mode one for each axis.
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
    if (!('texStorage3D' in context)) throw new Error('The decision-support map needs WebGL2');
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
    for (const u of ['u_matrix', 'u_tile', 'u_uv', 'u_vals', 'u_n', 'u_op', 'u_w', 'u_bad', 'u_good', 'u_opacity', 'u_cut', 'u_mode', 'u_axis', 'u_brk', 'u_pal', 'u_only'])
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
  }

  onRemove() {
    this.dropGpu();
    this.gl.deleteProgram(this.prog);
    this.gl.deleteBuffer(this.buf);
    this.gl.deleteVertexArray(this.vao);
  }

  private dropGpu() {
    for (const t of this.gpu.values()) this.gl?.deleteTexture(t.tex);
    this.gpu.clear();
    this.building.clear();
  }

  private sig() {
    return this.criteria.map((c) => c.layer.id).join(',');
  }

  /** One tile's criteria as a texture array, built once they have all
   *  arrived. */
  private build(z: number, x: number, y: number) {
    const sig = this.sig();
    const key = `${z}/${x}/${y}|${sig}`;
    if (this.building.has(key) || this.gpu.has(key)) return;
    this.building.add(key);
    const cs = this.criteria;
    Promise.all(cs.map((c) => this.tileValues(c.layer, z, x, y))).then((vals) => {
      if (!this.building.delete(key) || sig !== this.sig()) return;
      const gl = this.gl;
      const tex = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex);
      gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.R8, TILE, TILE, Math.max(1, cs.length));
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      const empty = new Uint8Array(TILE * TILE);
      vals.forEach((v, i) =>
        gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, i, TILE, TILE, 1, gl.RED, gl.UNSIGNED_BYTE, v ?? empty),
      );
      for (const [p, v] of [
        [gl.TEXTURE_MIN_FILTER, gl.NEAREST],
        [gl.TEXTURE_MAG_FILTER, gl.NEAREST],
        [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE],
        [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE],
      ])
        gl.texParameteri(gl.TEXTURE_2D_ARRAY, p, v);
      this.gpu.set(key, { tex, sig, used: this.frame });
      // Keep the GPU side bounded: the least recently drawn go first.
      if (this.gpu.size > 160) {
        const old = [...this.gpu.entries()].sort((a, b) => a[1].used - b[1].used).slice(0, 40);
        for (const [k, t] of old) {
          gl.deleteTexture(t.tex);
          this.gpu.delete(k);
        }
      }
      this.map.triggerRepaint();
    });
  }

  render(gl: WebGLRenderingContext | WebGL2RenderingContext, opts: CustomRenderMethodInput) {
    const g = gl as WebGL2RenderingContext;
    const cs = this.criteria;
    if (!cs.length) return;
    this.frame++;
    const sig = this.sig();
    const tiles = this.map.coveringTiles({ tileSize: TILE, minzoom: MINZ, maxzoom: MAXZ });

    g.useProgram(this.prog);
    g.uniformMatrix4fv(this.loc.u_matrix, false, opts.defaultProjectionData.mainMatrix as Float32Array);
    g.uniform1i(this.loc.u_vals, 0);
    g.uniform1i(this.loc.u_n, cs.length);
    g.uniform1i(this.loc.u_op, this.op === 'and' ? 1 : this.op === 'or' ? 2 : 0);
    const code = (c: Criterion, t: number) => thresholdByte(c.layer, t);
    const pad = (a: number[]) => [...a, ...Array(MAX_CRITERIA - a.length).fill(0)];
    g.uniform1fv(this.loc.u_w, pad(cs.map((c) => c.weight)));
    g.uniform1fv(this.loc.u_bad, pad(cs.map((c) => code(c, c.bad))));
    g.uniform1fv(this.loc.u_good, pad(cs.map((c) => code(c, c.good))));
    g.uniform1f(this.loc.u_opacity, this.opacity);
    g.uniform1f(this.loc.u_cut, this.cut);
    const bi = this.bi;
    g.uniform1i(this.loc.u_mode, bi ? 1 : 0);
    g.uniform1fv(this.loc.u_axis, pad(cs.map((c) => c.axis ?? 0)));
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
    g.activeTexture(g.TEXTURE0);

    for (const id of tiles) {
      const { z, x, y } = id.canonical;
      const size = 1 / 2 ** z;
      // The world copy this tile is drawn in.
      const mx = x * size + id.wrap;
      const my = y * size;
      this.build(z, x, y);
      // Its own texture if ready, otherwise the nearest ancestor's, drawn
      // over just this tile's square -- never a blank while panning, and
      // never two layers of colour on one spot.
      let tex: GpuTile | undefined;
      let az = z, ax = x, ay = y;
      for (; az >= MINZ; az--, ax >>= 1, ay >>= 1) {
        tex = this.gpu.get(`${az}/${ax}/${ay}|${sig}`);
        if (tex) break;
      }
      if (!tex) continue;
      tex.used = this.frame;
      const k = 2 ** (z - az);
      g.bindTexture(g.TEXTURE_2D_ARRAY, tex.tex);
      g.uniform3f(this.loc.u_tile, mx, my, size);
      g.uniform3f(this.loc.u_uv, (x - ax * k) / k, (y - ay * k) / k, 1 / k);
      g.drawArrays(g.TRIANGLE_STRIP, 0, 4);
    }
    g.bindVertexArray(null);
  }
}

const rgb01 = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);

/** Combine 0..1 scores the way the shader does. */
export function combineScores(scores: { score: number; weight: number }[], op: Op) {
  if (!scores.length) return null;
  if (op === 'and') return Math.min(...scores.map((r) => r.score));
  if (op === 'or') return Math.max(...scores.map((r) => r.score));
  const w = scores.reduce((s, r) => s + r.weight, 0);
  return w ? scores.reduce((s, r) => s + r.score * r.weight, 0) / w : 0;
}

/** A threshold in a layer's own units as the byte it would be stored as --
 *  what the shader and the area count both compare against. */
export function thresholdByte(layer: ValueLayer, t: number) {
  return 1 + ((t - layer.lo) / (layer.hi - layer.lo || 1)) * 254;
}

/** A criterion's 0..1 score for a real value. */
export function scoreOf(c: Criterion, value: number) {
  const d = c.good - c.bad;
  if (Math.abs(d) < 1e-9) return value >= c.good ? 1 : 0;
  return Math.min(1, Math.max(0, (value - c.bad) / d));
}
