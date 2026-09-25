import type { StyleSpecification } from 'maplibre-gl';
import { layers as basemapLayers, namedFlavor } from '@protomaps/basemaps';

type LngLat = [number, number];

/** The study-area map's ground: the Protomaps dark style taken toward the
 *  site's greens, the towns and nothing else written on it, and the area's
 *  edge drawn with the world beyond it darkened. The same look as /map/ --
 *  written out here for /ecoscapes-dst/; /map/ still carries its own copy. */
export function studyStyle(opts: { basemap: string; glyphs: string; limit: [LngLat, LngLat] }): StyleSpecification {
  const flavor = {
    ...namedFlavor('dark'),
    background: '#0b100e',
    earth: '#141b17',
    park_a: '#16201a',
    park_b: '#16201a',
    wood_a: '#1b2c20',
    wood_b: '#1b2c20',
    scrub_a: '#18221b',
    scrub_b: '#18221b',
    glacier: '#9aa8a4',
    water: '#0f344a',
    buildings: '#2e3833',
    other: '#48524d',
    minor_a: '#5a6560',
    minor_b: '#5a6560',
    major: '#838d88',
    highway: '#b0b8b3',
  };
  const [[w, s], [e, n]] = opts.limit;
  const ring: LngLat[] = [[w, s], [e, s], [e, n], [w, n], [w, s]];
  return {
    version: 8,
    glyphs: opts.glyphs,
    sources: {
      beyond: {
        type: 'geojson',
        data: {
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'Polygon',
            coordinates: [
              [[w - 5, s - 5], [e + 5, s - 5], [e + 5, n + 5], [w - 5, n + 5], [w - 5, s - 5]],
              [...ring].reverse(),
            ],
          },
        },
      },
      edge: { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: ring } } },
      protomaps: {
        type: 'vector',
        url: `pmtiles://${opts.basemap}`,
        attribution:
          '<a href="https://protomaps.com">Protomaps</a> © <a href="https://openstreetmap.org/copyright">OpenStreetMap</a>',
      },
    },
    layers: [
      ...basemapLayers('protomaps', flavor, { lang: 'en' }).filter(
        (l) => l.type !== 'symbol' && !l.id.startsWith('boundaries'),
      ),
      {
        id: 'towns',
        type: 'symbol',
        source: 'protomaps',
        'source-layer': 'places',
        filter: [
          'all',
          ['==', ['get', 'kind'], 'locality'],
          [
            'any',
            ['in', ['get', 'kind_detail'], ['literal', ['city', 'town']]],
            ['all', ['==', ['get', 'kind_detail'], 'village'], ['>=', ['zoom'], 10]],
          ],
        ],
        layout: {
          'text-field': ['coalesce', ['get', 'name:en'], ['get', 'name']],
          'text-font': ['Noto Sans Medium'],
          'text-size': [
            'interpolate', ['linear'], ['zoom'],
            8, ['match', ['get', 'kind_detail'], 'village', 11, 12.5],
            13, ['match', ['get', 'kind_detail'], 'village', 13, 16],
          ],
          'text-letter-spacing': 0.02,
          'text-anchor': 'bottom',
          'text-offset': [0, -0.7],
          'text-max-width': 8,
          'symbol-sort-key': ['-', 0, ['coalesce', ['get', 'population'], 0]],
        },
        paint: {
          'text-color': ['match', ['get', 'kind_detail'], 'village', '#b9c3be', '#e6ece9'],
          'text-halo-color': 'rgba(11, 16, 14, 0.9)',
          'text-halo-width': 1.5,
          'text-halo-blur': 0.5,
        },
      },
      { id: 'beyond', type: 'fill', source: 'beyond', paint: { 'fill-color': '#0b100e', 'fill-opacity': 0.93 } },
      {
        id: 'edge',
        type: 'line',
        source: 'edge',
        paint: { 'line-color': '#9aa79f', 'line-width': 1.2, 'line-opacity': 0.8, 'line-dasharray': [4, 3] },
      },
    ],
  };
}
