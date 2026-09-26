/** ?flyover-debug: the flight drawn so its shape can be seen. On the map, in
 *  3D: where the camera goes (green), the middle of the view it looks at
 *  (white), a stick joining the two every quarter second, and a dot at each
 *  view. Under it, a chart of the flight over time: zoom, tilt, turn, the
 *  ground's height, and how fast the ground moves across the screen -- the
 *  line to watch for lurches -- with the views marked and a playhead.
 *
 *  And a log of each flight, frame by frame as it happens, saved as a text
 *  file to share: how long each frame took, what the camera did, which tiles
 *  arrived mid-flight (a tile arriving is a stutter's usual cause), and the
 *  browser's own reports of long frames, with a summary of the worst. */
import type { CustomLayerInterface, CustomRenderMethodInput, Map as MlMap } from 'maplibre-gl';
import { MercatorCoordinate, getVersion } from 'maplibre-gl';
import { cameraAt, type View } from './flyover';

type Flight = { duration: number; times: number[]; at: (t: number) => View };

const VS = `#version 300 es
in vec3 a_pos;
uniform mat4 u_matrix;
uniform float u_size;
void main() { gl_Position = u_matrix * vec4(a_pos, 1.0); gl_PointSize = u_size; }`;
const FS = `#version 300 es
precision mediump float;
uniform vec4 u_colour;
out vec4 colour;
void main() { colour = u_colour; }`;

export class FlightDebug {
  private map: MlMap;
  private flight: Flight | null = null;
  private chart: HTMLCanvasElement;
  private readout: HTMLElement;
  private series: { t: number; v: View; px: number }[] = [];
  private gl: WebGL2RenderingContext | null = null;
  private prog: WebGLProgram | null = null;
  private buf: WebGLBuffer | null = null;
  private parts: { mode: number; first: number; count: number; colour: number[]; size?: number }[] = [];
  private data = new Float32Array(0);
  /** The chart without its playhead, drawn once per flight. */
  private base = document.createElement('canvas');
  private stats: () => string;

  constructor(map: MlMap, host: HTMLElement, stats: () => string) {
    this.map = map;
    this.stats = stats;
    const box = document.createElement('div');
    box.className = 'fly-debug';
    box.innerHTML =
      '<div class="fly-debug-key"><i style="--c:#7fe0a8"></i>zoom <i style="--c:#6fb6ff"></i>tilt <i style="--c:#e8a23b"></i>turn ' +
      '<i style="--c:#b48cff"></i>ground height <i style="--c:#ff6b6b"></i>ground speed on screen</div>';
    this.chart = document.createElement('canvas');
    this.readout = document.createElement('p');
    this.readout.className = 'fly-debug-read';
    const save = document.createElement('button');
    save.type = 'button';
    save.className = 'fly-debug-save';
    save.textContent = 'Save log';
    save.addEventListener('click', () => this.save());
    box.append(this.chart, this.readout, save);
    host.append(box);
    this.listen();
    const layer: CustomLayerInterface = {
      id: 'flight-debug',
      type: 'custom',
      renderingMode: '3d',
      onAdd: (_m, gl) => this.setup(gl as WebGL2RenderingContext),
      render: (gl, opts) => this.draw(gl as WebGL2RenderingContext, opts),
    };
    const add = () => map.addLayer(layer);
    if (map.loaded()) add();
    else map.once('load', add);
  }

  /** A new flight (or none): the path rebuilt, the chart redrawn. */
  set(flight: Flight | null) {
    this.flight = flight && flight.times.length > 1 ? flight : null;
    this.build();
    this.plot(-1);
    this.map.triggerRepaint();
  }

  /** The playhead, `t` seconds in (or -1 for none): the chart as drawn,
   *  and one line over it. */
  private shown = 0;
  playhead(t: number, v?: View) {
    const c = this.chart;
    const ctx = c.getContext('2d')!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.drawImage(this.base, 0, 0);
    if (t >= 0 && this.flight) {
      const dpr = devicePixelRatio || 1;
      const X = (6 + (t / this.flight.duration) * (c.width / dpr - 12)) * dpr;
      ctx.strokeStyle = '#fff';
      ctx.beginPath();
      ctx.moveTo(X, 0);
      ctx.lineTo(X, c.height);
      ctx.stroke();
    }
    // The words a few times a second, not every frame.
    if (v && ++this.shown % 8 === 0)
      this.readout.textContent =
        `t ${t.toFixed(1)}s · zoom ${v.zoom.toFixed(2)} · tilt ${v.pitch.toFixed(0)}° · turn ${v.bearing.toFixed(0)}° · ` +
        `ground ${v.elevation.toFixed(0)} m · actual ground ${this.map.getCenterElevation().toFixed(0)} m`;
  }

  private build() {
    const f = this.flight;
    this.series = [];
    this.parts = [];
    if (!f) {
      this.data = new Float32Array(0);
      return;
    }
    const h = this.map.getContainer().clientHeight;
    const fov = this.map.getVerticalFieldOfView();
    const pos = (v: View) => cameraAt(v, h, fov, MercatorCoordinate.fromLngLat([v.lng, v.lat]).meterInMercatorCoordinateUnits());
    const step = 1 / 30;
    const cams: number[] = [];
    const centres: number[] = [];
    const sticks: number[] = [];
    const dots: number[] = [];
    let prev: View | null = null;
    for (let t = 0; t <= f.duration + 1e-9; t += step) {
      const v = f.at(t);
      const p = pos(v);
      cams.push(...p.camera);
      centres.push(...p.centre);
      if (Math.round(t / step) % 8 === 0) sticks.push(...p.camera, ...p.centre);
      // Ground speed on screen: how far the middle of the view moved, in
      // screen pixels at this zoom, per second.
      let px = 0;
      if (prev) {
        const a = MercatorCoordinate.fromLngLat([prev.lng, prev.lat]);
        const b = MercatorCoordinate.fromLngLat([v.lng, v.lat]);
        px = (Math.hypot(b.x - a.x, b.y - a.y) * 512 * 2 ** v.zoom) / step;
      }
      this.series.push({ t, v, px });
      prev = v;
    }
    for (const t of f.times) dots.push(...pos(f.at(t)).camera);
    const all = [cams, centres, sticks, dots];
    let first = 0;
    const spec = [
      { mode: 3 /* LINE_STRIP */, colour: [0.5, 0.88, 0.66, 1] },
      { mode: 3, colour: [1, 1, 1, 0.7] },
      { mode: 1 /* LINES */, colour: [1, 1, 1, 0.25] },
      { mode: 0 /* POINTS */, colour: [1, 0.87, 0.5, 1], size: 10 },
    ];
    all.forEach((a, k) => {
      this.parts.push({ ...spec[k], first, count: a.length / 3 });
      first += a.length / 3;
    });
    this.data = new Float32Array(all.flat());
    if (this.gl && this.buf) {
      this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.buf);
      this.gl.bufferData(this.gl.ARRAY_BUFFER, this.data, this.gl.STATIC_DRAW);
    }
  }

  private setup(gl: WebGL2RenderingContext) {
    this.gl = gl;
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      return s;
    };
    const p = gl.createProgram()!;
    gl.attachShader(p, sh(gl.VERTEX_SHADER, VS));
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(p);
    this.prog = p;
    this.buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.bufferData(gl.ARRAY_BUFFER, this.data, gl.STATIC_DRAW);
  }

  private draw(gl: WebGL2RenderingContext, opts: CustomRenderMethodInput) {
    if (!this.prog || !this.data.length) return;
    gl.useProgram(this.prog);
    gl.uniformMatrix4fv(gl.getUniformLocation(this.prog, 'u_matrix'), false, new Float32Array(opts.defaultProjectionData.mainMatrix));
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    const loc = gl.getAttribLocation(this.prog, 'a_pos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 3, gl.FLOAT, false, 0, 0);
    // Seen through the ground: this is for looking at, not for realism.
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    for (const part of this.parts) {
      if (!part.count) continue;
      gl.uniform4fv(gl.getUniformLocation(this.prog, 'u_colour'), part.colour);
      gl.uniform1f(gl.getUniformLocation(this.prog, 'u_size'), part.size ?? 1);
      gl.drawArrays(part.mode, part.first, part.count);
    }
  }

  private plot(head: number) {
    this.drawBase();
    this.playhead(head);
  }
  private drawBase() {
    const c = this.base;
    const dpr = devicePixelRatio || 1;
    const [W, H] = [this.chart.clientWidth || 560, this.chart.clientHeight || 150];
    c.width = this.chart.width = W * dpr;
    c.height = this.chart.height = H * dpr;
    const ctx = c.getContext('2d')!;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, W, H);
    const f = this.flight;
    if (!f || !this.series.length) {
      ctx.fillStyle = '#9aa79f';
      ctx.font = '12px system-ui';
      ctx.fillText('Add two views to see the flight.', 10, 20);
      return;
    }
    const pad = 6;
    const x = (t: number) => pad + (t / f.duration) * (W - 2 * pad);
    ctx.strokeStyle = 'rgba(255,221,128,0.45)';
    for (const t of f.times) {
      ctx.beginPath();
      ctx.moveTo(x(t), 0);
      ctx.lineTo(x(t), H);
      ctx.stroke();
    }
    const line = (colour: string, get: (s: (typeof this.series)[number]) => number) => {
      const vals = this.series.map(get);
      let [lo, hi] = [Math.min(...vals), Math.max(...vals)];
      if (hi - lo < 1e-6) [lo, hi] = [lo - 1, hi + 1];
      ctx.strokeStyle = colour;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      this.series.forEach((s, k) => {
        const y = H - pad - ((vals[k] - lo) / (hi - lo)) * (H - 2 * pad);
        if (k) ctx.lineTo(x(s.t), y);
        else ctx.moveTo(x(s.t), y);
      });
      ctx.stroke();
    };
    line('#7fe0a8', (s) => s.v.zoom);
    line('#6fb6ff', (s) => s.v.pitch);
    line('#e8a23b', (s) => s.v.bearing);
    line('#b48cff', (s) => s.v.elevation);
    line('#ff6b6b', (s) => s.px);
  }

  // ---- The log ---------------------------------------------------------------
  private lines: { at: number; kind: string; text: string }[] = [];
  private frames: { at: number; dt: number; t: number }[] = [];
  private head: string[] = [];
  private logging = false;
  private t0 = 0;
  private lastFrame = 0;
  private terrain = false;

  /** Anything the map or the browser reports while a flight is logged. */
  private listen() {
    const tileOf = (e: { tile?: { tileID?: { canonical?: { z: number; x: number; y: number } } } }) => {
      const c = e.tile?.tileID?.canonical;
      return c ? `${c.z}/${c.x}/${c.y}` : '';
    };
    this.map.on('sourcedataloading', (e) => {
      const t = tileOf(e as never);
      if (t) this.note('tile-start', `${e.sourceId} ${t}`);
    });
    this.map.on('sourcedata', (e) => {
      const t = tileOf(e as never);
      if (t) this.note('tile-in', `${e.sourceId} ${t}`);
    });
    this.map.on('render', () => {
      if (this.logging && this.lastFrame) this.note('render', `done ${(performance.now() - this.lastFrame).toFixed(1)} ms into the frame`);
    });
    // The browser's own reports of frames and tasks that ran long, where it
    // makes them (Chrome; not Safari).
    for (const type of ['long-animation-frame', 'longtask']) {
      try {
        new PerformanceObserver((list) => {
          for (const e of list.getEntries()) {
            const scripts = ((e as unknown as { scripts?: { invoker?: string; sourceURL?: string; duration: number }[] }).scripts ?? [])
              .map((sc) => `${sc.invoker ?? '?'} ${Math.round(sc.duration)}ms ${(sc.sourceURL ?? '').split('/').pop()}`)
              .join('; ');
            this.note(type, `${Math.round(e.duration)} ms, from ${(e.startTime - this.t0).toFixed(1)}${scripts ? ` -- ${scripts}` : ''}`);
          }
        }).observe({ type, buffered: false });
      } catch {}
    }
  }

  /** A line in the log, while one is being kept. */
  note(kind: string, text = '') {
    if (!this.logging) return;
    if (this.lines.length > 200000) return;
    this.lines.push({ at: performance.now(), kind, text });
  }

  /** A new log, for a flight about to be readied and flown. */
  begin(about: Record<string, unknown>) {
    this.lines = [];
    this.frames = [];
    this.lastFrame = 0;
    this.t0 = performance.now();
    this.logging = true;
    this.terrain = !!this.map.getTerrain();
    let gpu = '?';
    try {
      const gl = this.map.getCanvas().getContext('webgl2');
      const ext = gl?.getExtension('WEBGL_debug_renderer_info');
      gpu = ext ? String(gl!.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : '?';
    } catch {}
    const cv = this.map.getCanvas();
    this.head = [
      'EcoScapes Data Sandbox flyover log',
      `when       ${new Date().toISOString()}`,
      `page       ${location.href}`,
      `browser    ${navigator.userAgent}`,
      `gpu        ${gpu}`,
      `maplibre   ${getVersion()}`,
      `screen     ${innerWidth}x${innerHeight} css px at ${devicePixelRatio}x, map canvas ${cv.width}x${cv.height}`,
      ...Object.entries(about).map(([k, v]) => `${k.padEnd(10)} ${typeof v === 'string' ? v : JSON.stringify(v)}`),
    ];
  }

  /** One frame of the flight: when, how long since the last, and where. */
  frame(now: number, t: number, v: View, jumpMs: number) {
    if (!this.logging) return;
    const dt = this.lastFrame ? now - this.lastFrame : 0;
    this.lastFrame = now;
    this.frames.push({ at: now, dt, t });
    const on = !!this.map.getTerrain();
    if (on !== this.terrain) this.note('terrain', on ? '3D ground on' : '3D ground off');
    this.terrain = on;
    this.lines.push({
      at: now,
      kind: 'frame',
      text:
        `dt ${dt.toFixed(1)}  t ${t.toFixed(3)}  zoom ${v.zoom.toFixed(3)} tilt ${v.pitch.toFixed(1)} turn ${v.bearing.toFixed(1)} ` +
        `elev ${v.elevation.toFixed(0)}  jumpTo ${jumpMs.toFixed(1)}ms  ${this.stats()}`,
    });
  }

  /** The flight over (or stopped): the log kept for saving. */
  end(why: string) {
    if (!this.logging) return;
    this.note('end', why);
    this.logging = false;
  }

  private summary() {
    const f = this.frames.slice(1);
    if (!f.length) return ['no frames flown'];
    const dts = f.map((x) => x.dt).sort((a, b) => a - b);
    const q = (p: number) => dts[Math.min(dts.length - 1, Math.floor(p * dts.length))].toFixed(1);
    const over = (ms: number) => f.filter((x) => x.dt > ms).length;
    const span = (f[f.length - 1].at - f[0].at) / 1000;
    const out = [
      `frames     ${f.length} in ${span.toFixed(1)} s, ${(f.length / span).toFixed(1)} fps`,
      `frame ms   median ${q(0.5)}, 95% ${q(0.95)}, 99% ${q(0.99)}, worst ${dts[dts.length - 1].toFixed(1)}`,
      `slow       ${over(20)} over 20 ms, ${over(34)} over 34 ms (a dropped frame or more), ${over(50)} over 50 ms`,
      '',
      'worst frames, with what happened since the frame before:',
    ];
    for (const w of [...f].sort((a, b) => b.dt - a.dt).slice(0, 15)) {
      const during = this.lines.filter((l) => l.kind !== 'frame' && l.kind !== 'render' && l.at > w.at - w.dt && l.at <= w.at);
      const counts = new Map<string, number>();
      for (const l of during) counts.set(l.kind, (counts.get(l.kind) ?? 0) + 1);
      out.push(
        `  ${w.dt.toFixed(1).padStart(6)} ms at t ${w.t.toFixed(2)} s (${(w.at - this.t0).toFixed(0)} ms in): ` +
          ([...counts].map(([k, n]) => `${n} ${k}`).join(', ') || 'nothing logged'),
      );
    }
    return out;
  }

  private save() {
    const body = this.lines.map((l) => `${(l.at - this.t0).toFixed(1).padStart(9)}  ${l.kind.padEnd(20)} ${l.text}`);
    const text = [...this.head, '', ...this.summary(), '', 'ms since Play, what, details:', ...body].join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    a.download = `flyover-log-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.txt`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
}
