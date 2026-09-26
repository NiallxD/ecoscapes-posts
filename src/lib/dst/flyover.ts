/** A flyover: the camera carried through the recorded views on one smooth
 *  path, never stopping between them, easing in at the first and out at the
 *  last, and going exactly where the views say -- no zooming out on its own.
 *
 *  Zoom, turn, tilt and the height of the ground under the middle of the view
 *  each follow a curve through their values, timed so a long leg takes longer
 *  than a short one, and never overshooting a view's value (a zoom from 10 to
 *  12 never passes 12). The ground moves at an even pace on screen, however
 *  the zoom changes: across a leg, progress over the ground goes with how far
 *  out the camera is at that moment, as MapLibre's own flyTo does, so a zoom
 *  in does not end in a rush. */
export type View = { lng: number; lat: number; zoom: number; bearing: number; pitch: number; elevation: number };

// Web Mercator, the whole world 0..1 across and down.
const mx = (lng: number) => (lng + 180) / 360;
const my = (lat: number) => {
  const r = (lat * Math.PI) / 180;
  return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2;
};
const lngOf = (x: number) => x * 360 - 180;
const latOf = (y: number) => (Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180) / Math.PI;

/** Seconds for the ground to cross one screen, at speed 1. */
const PACE = 2.4;
/** Seconds per step of zoom, degrees of turn and of tilt a second, at speed 1. */
const ZOOM_S = 1.1;
const TURN_DPS = 25;
const TILT_DPS = 18;
/** Steps across a leg for pacing the ground by the zoom. */
const STEPS = 128;
/** Flights shorter than this (at speed 1) are slowed, the shorter the more:
 *  R seconds become sqrt(R * SHORT) -- 5 s to 10, 10 to 14 -- so a flight
 *  between two nearby views is not over in a blink. Longer ones as they are. */
const SHORT = 20;

const h00 = (s: number) => 2 * s ** 3 - 3 * s ** 2 + 1;
const h10 = (s: number) => s ** 3 - 2 * s ** 2 + s;
const h01 = (s: number) => -2 * s ** 3 + 3 * s ** 2;
const h11 = (s: number) => s ** 3 - s ** 2;

export function flight(views: View[], screen: { w: number; h: number }, speed = 1) {
  const side = Math.min(screen.w, screen.h);
  const n = views.length;
  // Where each view is on the world, and its turn taken the short way round
  // from the one before.
  const P = views.map((v) => [mx(v.lng), my(v.lat)]);
  const bearings: number[] = [];
  for (const v of views) {
    const prev = bearings[bearings.length - 1];
    bearings.push(prev === undefined ? v.bearing : v.bearing + 360 * Math.round((prev - v.bearing) / 360));
  }
  const scalars = views.map((v, i) => [v.zoom, bearings[i], v.pitch, v.elevation]);

  // How long each leg takes: the longest of its parts -- the ground crossing
  // the screen, the zoom, the turn, the tilt -- since they happen together.
  const times = [0];
  for (let i = 1; i < n; i++) {
    const [za, zb] = [views[i - 1].zoom, views[i].zoom];
    const dist = Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]);
    // The mean of 2^zoom as the zoom runs evenly from one to the other.
    const scale = Math.abs(zb - za) < 1e-6 ? 2 ** za : (2 ** zb - 2 ** za) / (Math.LN2 * (zb - za));
    const screens = (dist * 512 * scale) / side;
    const secs = Math.max(
      1.2,
      screens * PACE,
      Math.abs(zb - za) * ZOOM_S,
      Math.abs(bearings[i] - bearings[i - 1]) / TURN_DPS,
      Math.abs(views[i].pitch - views[i - 1].pitch) / TILT_DPS,
    );
    times.push(times[i - 1] + secs);
  }
  const raw = times[n - 1] ?? 0;
  const stretch = (raw > 0 && raw < SHORT ? Math.sqrt(raw * SHORT) / raw : 1) / speed;
  for (let i = 0; i < n; i++) times[i] *= stretch;
  const duration = times[n - 1] ?? 0;

  // The slope of each number through each view: level at the two ends (the
  // ease in and out) and wherever it turns back; elsewhere from its
  // neighbours, held low enough that the curve cannot overshoot
  // (Fritsch-Carlson).
  const slopes = scalars.map((row, i) =>
    row.map((v, d) => {
      if (i === 0 || i === n - 1) return 0;
      const [hl, hr] = [times[i] - times[i - 1], times[i + 1] - times[i]];
      const [dl, dr] = [(v - scalars[i - 1][d]) / hl, (scalars[i + 1][d] - v) / hr];
      if (dl * dr <= 0) return 0;
      const m = (dl * hr + dr * hl) / (hl + hr);
      return Math.sign(m) * Math.min(Math.abs(m), 3 * Math.abs(dl), 3 * Math.abs(dr));
    }),
  );
  const scalarAt = (i: number, t: number) => {
    const h = times[i + 1] - times[i];
    const s = (t - times[i]) / h;
    return scalars[i].map((a, d) => h00(s) * a + h10(s) * h * slopes[i][d] + h01(s) * scalars[i + 1][d] + h11(s) * h * slopes[i + 1][d]);
  };

  // Which way the path runs through each view: from the view before to the
  // one after, still at the two ends.
  const dirs = P.map((p, i) => {
    if (i === 0 || i === n - 1) return [0, 0];
    const [dx, dy] = [P[i + 1][0] - P[i - 1][0], P[i + 1][1] - P[i - 1][1]];
    const len = Math.hypot(dx, dy);
    return len ? [dx / len, dy / len] : [0, 0];
  });
  // Each leg's shape on the ground, and its length measured along it, for
  // turning a distance travelled into a point.
  const curve = (i: number, s: number) => {
    const len = Math.hypot(P[i + 1][0] - P[i][0], P[i + 1][1] - P[i][1]);
    return [0, 1].map((d) => h00(s) * P[i][d] + h10(s) * len * dirs[i][d] + h01(s) * P[i + 1][d] + h11(s) * len * dirs[i + 1][d]);
  };
  const arcs = views.slice(1).map((_, i) => {
    const acc = [0];
    let prev = curve(i, 0);
    for (let k = 1; k <= STEPS; k++) {
      const next = curve(i, k / STEPS);
      acc.push(acc[k - 1] + Math.hypot(next[0] - prev[0], next[1] - prev[1]));
      prev = next;
    }
    return acc;
  });

  // The pace over the ground, as speed on screen: ground covered is that
  // speed times how far out the camera is (2^-zoom). One smooth speed for the
  // whole flight -- from rest, through each view at the slower of its two
  // legs' own paces so it never jumps there, back to rest -- with each leg's
  // middle lifted or lowered so the leg covers exactly its ground.
  const out = views.slice(1).map((_, i) =>
    Array.from({ length: STEPS + 1 }, (_, k) => 2 ** -scalarAt(i, times[i] + ((times[i + 1] - times[i]) * k) / STEPS)[0]),
  );
  /** Trapezoid sum of f over the steps of a leg. */
  const sum = (f: (k: number) => number) => {
    let acc = 0;
    for (let k = 1; k <= STEPS; k++) acc += (f(k - 1) + f(k)) / 2;
    return acc;
  };
  const own = out.map((w, i) => {
    const reach = sum((k) => w[k]) * ((times[i + 1] - times[i]) / STEPS);
    return reach ? arcs[i][STEPS] / reach : 0;
  });
  const through = views.map((_, k) => (k === 0 || k === n - 1 ? 0 : Math.min(own[k - 1], own[k])));
  // Ground covered by each step of each leg, as a share of the leg.
  const progress = out.map((w, i) => {
    const dt = (times[i + 1] - times[i]) / STEPS;
    const lin = (k: number) => through[i] + (through[i + 1] - through[i]) * (k / STEPS);
    const bump = (k: number) => (k / STEPS) * (1 - k / STEPS);
    const base = sum((k) => lin(k) * w[k]) * dt;
    const lift = sum((k) => bump(k) * w[k]) * dt;
    const c = lift ? (arcs[i][STEPS] - base) / lift : 0;
    const v = (k: number) => Math.max(0, lin(k) + c * bump(k)) * w[k];
    const acc = [0];
    for (let k = 1; k <= STEPS; k++) acc.push(acc[k - 1] + ((v(k - 1) + v(k)) / 2) * dt);
    const total = acc[STEPS] || 1;
    return acc.map((a) => a / total);
  });
  /** The point on leg `i` a share `f` of the way along its ground. */
  const along = (i: number, f: number) => {
    const a = arcs[i];
    const want = f * a[STEPS];
    let k = 0;
    while (k < STEPS - 1 && a[k + 1] < want) k++;
    const span = a[k + 1] - a[k];
    return curve(i, (k + (span ? (want - a[k]) / span : 0)) / STEPS);
  };

  const leg = (t: number) => {
    let i = 0;
    while (i < n - 2 && t > times[i + 1]) i++;
    return i;
  };

  /** Where the camera is `t` seconds in. */
  function at(t: number): View {
    if (n === 1) return { ...views[0] };
    t = Math.min(Math.max(t, 0), duration);
    const i = leg(t);
    const [zoom, bearing, pitch, elevation] = scalarAt(i, t);
    // How far along the leg's ground, from the paced progress.
    const f = ((t - times[i]) / (times[i + 1] - times[i])) * STEPS;
    const k = Math.min(STEPS - 1, Math.floor(f));
    const xy = along(i, progress[i][k] + (progress[i][k + 1] - progress[i][k]) * (f - k));
    return { lng: lngOf(xy[0]), lat: latOf(xy[1]), zoom, bearing, pitch: Math.min(80, Math.max(0, pitch)), elevation };
  }
  return { duration, times, at };
}

/** Where the camera itself is for a view, in Web Mercator units (x, y, and
 *  height), for drawing the path: back from the middle of the view along the
 *  way it looks, as far as MapLibre puts it for that zoom and screen. */
export function cameraAt(v: View, screenH: number, fovDeg: number, metre: number) {
  const d = (0.5 / Math.tan((fovDeg * Math.PI) / 360)) * screenH / (512 * 2 ** v.zoom);
  const [b, p] = [(v.bearing * Math.PI) / 180, (v.pitch * Math.PI) / 180];
  const [cx, cy, cz] = [mx(v.lng), my(v.lat), v.elevation * metre];
  return {
    centre: [cx, cy, cz],
    camera: [cx - d * Math.sin(p) * Math.sin(b), cy + d * Math.sin(p) * Math.cos(b), cz + d * Math.cos(p)],
  };
}

/** Web Mercator units to the metre at a latitude. */
export const metreAt = (lat: number) => 1 / (40075016.686 * Math.cos((lat * Math.PI) / 180));

/** The other way from cameraAt: the view whose camera stands at `cam`,
 *  looking this way at this zoom -- for turning the camera where it stands.
 *  The middle of the view is then wherever that gaze puts it, off the ground
 *  as often as not. */
export function lookFrom(cam: number[], bearing: number, pitch: number, zoom: number, screenH: number, fovDeg: number) {
  const d = (0.5 / Math.tan((fovDeg * Math.PI) / 360)) * screenH / (512 * 2 ** zoom);
  const [b, p] = [(bearing * Math.PI) / 180, (pitch * Math.PI) / 180];
  const [x, y] = [cam[0] + d * Math.sin(p) * Math.sin(b), cam[1] - d * Math.sin(p) * Math.cos(b)];
  const lat = latOf(y);
  return { lng: lngOf(x), lat, elevation: (cam[2] - d * Math.cos(p)) / metreAt(lat) };
}
