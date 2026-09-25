import type { Map as MlMap } from 'maplibre-gl';

/** The ground's shape, from one file of Mapterhorn elevation
 *  (tools/extract-terrain.sh): shaded relief on every map, and on /map/ and
 *  /ecoscapes-dst/ the ground raised whenever the map is tilted.
 *
 *  Two sources on the one file, as MapLibre advises: the relief and the 3D
 *  mesh want their tiles at different zooms, and sharing a source would have
 *  each evict the other's. */

export const TERRAIN_ATTRIBUTION = '<a href="https://mapterhorn.com/attribution">© Mapterhorn</a>';

/** How much taller than life the 3D ground stands. The corridor's relief is
 *  dramatic already; a little more reads better from above at a slant. */
const EXAGGERATION = 1.3;
const PITCH = 60;
/** How far over it can be tilted by hand: down near the ground, looking along
 *  the valleys rather than into them. (MapLibre's own limit is 85.) */
const MAX_PITCH = 80;

const dem = (url: string) =>
  ({ type: 'raster-dem', url: `pmtiles://${url}`, encoding: 'terrarium', tileSize: 512, attribution: TERRAIN_ATTRIBUTION }) as const;

/** Shaded relief over the land, under the water and everything after it --
 *  lakes and the sound stay flat, and every layer drawn later sits over the
 *  shading rather than being muddied by it. Call on 'load'. */
export function addRelief(map: MlMap, url: string) {
  map.addSource('relief', dem(url));
  const before = map.getStyle().layers.find((l) => l.id === 'water')?.id;
  map.addLayer(
    {
      id: 'relief',
      type: 'hillshade',
      source: 'relief',
      paint: {
        // Lit from the north-west, as relief is read. Shadows down toward the
        // ground's own near-black, highlights a faint lift: the mountains show
        // without the dark map turning grey.
        'hillshade-method': 'igor',
        'hillshade-exaggeration': 0.55,
        'hillshade-illumination-direction': 315,
        'hillshade-shadow-color': 'rgba(2, 5, 4, 0.85)',
        'hillshade-highlight-color': 'rgba(214, 232, 222, 0.16)',
        'hillshade-accent-color': 'rgba(2, 5, 4, 0.5)',
      },
    },
    before,
  );
}

/** Below this pitch the map counts as flat: the ground goes up as a tilt
 *  passes it, and comes down as a levelling map falls through it -- in the
 *  middle of the move either way (see tilting). A map left tilted less than
 *  this settles back to level. */
const LEVEL = 3;

/** One map, flat or tilted, with nothing to switch between them: tilting it
 *  by hand -- a right- or ctrl-drag with a mouse, two fingers up or down the
 *  screen on a touch one -- raises the ground into 3D as it goes, and bringing
 *  it back level lays it flat and north-up again, as it always was.
 *
 *  The 3D button and the tilt slider that slides out of it are shortcuts to
 *  the same thing, and follow the map however it got there: the button is lit
 *  whenever the map is tilted, and a tap on it levels it; unlit, a tap tilts
 *  it over. Turning with two fingers only while tilted, so a pinch on the flat
 *  map never twists it. */
export function tilting(map: MlMap, url: string, button: HTMLElement, tilt: HTMLElement) {
  const input = tilt.querySelector('input')!;
  let raised = false;

  const show = (on: boolean) => {
    button.setAttribute('aria-pressed', String(on));
    tilt.classList.toggle('open', on);
    tilt.setAttribute('aria-hidden', String(!on));
    input.tabIndex = on ? 0 : -1;
  };

  // The ground up the moment the map leaves level, so it rises with the tilt
  // rather than arriving at the end of it.
  const raise = () => {
    if (raised) return;
    raised = true;
    if (!map.getSource('terrain')) map.addSource('terrain', dem(url));
    map.setTerrain({ source: 'terrain', exaggeration: EXAGGERATION });
    map.touchZoomRotate.enableRotation();
    show(true);
  };
  // ...and down once it is level again: kept up until then, so it lowers with
  // the camera rather than dropping out from under it.
  const lower = () => {
    if (!raised) return;
    raised = false;
    map.setTerrain(null);
    map.touchZoomRotate.disableRotation();
    show(false);
  };

  map.setMaxPitch(MAX_PITCH);
  map.dragRotate.enable();
  map.touchPitch.enable();
  map.keyboard.enableRotation();
  map.touchZoomRotate.disableRotation();

  // Up and down in the middle of a move, never at rest: with the ground
  // raised, high ground sits a few pixels off where the flat map draws it,
  // and that shift is only seen as a jump when nothing else is moving.
  let last = 0;
  map.on('pitch', () => {
    const p = map.getPitch();
    if (p > LEVEL) raise();
    else if (p < last) lower();
    last = p;
    if (document.activeElement !== input) input.value = String(Math.round(p));
  });
  map.on('moveend', () => {
    if (map.getPitch() > LEVEL) return;
    // Near enough level, or turned while flat (a mouse drag turns as it
    // tilts): eased onto level and north.
    if (map.getPitch() !== 0 || map.getBearing() !== 0) map.easeTo({ pitch: 0, bearing: 0, duration: 400 });
    else lower();
  });

  button.addEventListener('click', () => {
    // The tilt raises the ground as it goes, as a hand's would.
    if (raised) map.easeTo({ pitch: 0, bearing: 0, duration: 700 });
    else map.easeTo({ pitch: PITCH, duration: 900 });
  });
  input.addEventListener('input', () => map.setPitch(Number(input.value)));
}

/** The sky and haze a tilted view looks out into: the ground's own dark at
 *  the top, a little green at the horizon, and the far hills fading into it.
 *  Nothing shows while the map is flat. */
export function addSky(map: MlMap) {
  map.setSky({
    'sky-color': '#0b100e',
    'horizon-color': '#1f2b25',
    'fog-color': '#0b100e',
    'sky-horizon-blend': 0.6,
    'horizon-fog-blend': 0.7,
    'fog-ground-blend': 0.35,
    'atmosphere-blend': 0,
  });
}
