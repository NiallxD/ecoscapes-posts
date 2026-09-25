import type { Map as MlMap } from 'maplibre-gl';

/** The ground's shape, from one file of Mapterhorn elevation
 *  (tools/extract-terrain.sh): shaded relief on every map, and on /map/ and
 *  /ecoscapes-dst/ a 3D view to tilt and turn.
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

/** Flat and straight down, or tilted over the ground in 3D. Turning and
 *  tilting by hand only in 3D: flat, the map stays north-up as it always has. */
export function setThreeD(map: MlMap, url: string, on: boolean) {
  if (on) {
    if (!map.getSource('terrain')) map.addSource('terrain', dem(url));
    map.setTerrain({ source: 'terrain', exaggeration: EXAGGERATION });
    map.setMaxPitch(MAX_PITCH);
    map.dragRotate.enable();
    map.touchZoomRotate.enableRotation();
    map.touchPitch.enable();
    map.keyboard.enableRotation();
    map.easeTo({ pitch: PITCH, duration: 900 });
  } else {
    flat(map);
    // The ground stays raised until the map is level again, so it lowers
    // with the camera rather than dropping out from under it.
    map.easeTo({ pitch: 0, bearing: 0, duration: 700 });
    map.once('moveend', () => {
      if (map.getPitch() === 0) map.setTerrain(null);
    });
  }
}

/** The 3D button, and the tilt slider that slides out of it while 3D is on.
 *  The slider follows the map as well as leading it: a right-drag or a
 *  keyboard tilt moves it too. */
export function threeDButton(map: MlMap, url: string, button: HTMLElement, tilt: HTMLElement) {
  const input = tilt.querySelector('input')!;
  const show = (on: boolean) => {
    tilt.classList.toggle('open', on);
    tilt.setAttribute('aria-hidden', String(!on));
    input.tabIndex = on ? 0 : -1;
  };
  button.addEventListener('click', () => {
    const on = button.getAttribute('aria-pressed') !== 'true';
    button.setAttribute('aria-pressed', String(on));
    show(on);
    setThreeD(map, url, on);
  });
  input.addEventListener('input', () => map.setPitch(Number(input.value)));
  map.on('pitch', () => {
    if (document.activeElement !== input) input.value = String(Math.round(map.getPitch()));
  });
}

/** The hand controls for a flat map: no turning, no tilting. */
export function flat(map: MlMap) {
  map.dragRotate.disable();
  map.touchZoomRotate.disableRotation();
  map.touchPitch.disable();
  map.keyboard.disableRotation();
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
