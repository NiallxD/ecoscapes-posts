/** The colour ramps the Data Sandbox can draw one score in: five stops, low
 *  score to high, as 0..255 RGB. Each starts close to the ground's own dark,
 *  so a poor fit recedes into the basemap and a good one stands out of it;
 *  the brightest stop is also the best places' pins. The two-score key keeps
 *  its own nine colours. */
export type Palette = { id: string; name: string; stops: [number, number, number][] };

export const PALETTES: Palette[] = [
  { id: 'gold', name: 'Gold', stops: [[45, 35, 24], [111, 71, 18], [180, 110, 15], [233, 158, 31], [255, 221, 128]] },
  { id: 'ember', name: 'Ember', stops: [[44, 24, 22], [112, 28, 28], [190, 54, 26], [240, 122, 32], [255, 216, 124]] },
  { id: 'glacier', name: 'Glacier', stops: [[20, 32, 44], [26, 66, 112], [44, 116, 184], [112, 176, 232], [218, 240, 255]] },
  { id: 'lichen', name: 'Lichen', stops: [[22, 38, 34], [18, 88, 82], [26, 142, 124], [92, 204, 164], [206, 246, 214]] },
  { id: 'fireweed', name: 'Fireweed', stops: [[88, 10, 60], [161, 27, 115], [211, 67, 164], [222, 146, 198], [241, 218, 234]] },
  { id: 'clear', name: 'Clear sight', stops: [[52, 22, 70], [62, 82, 140], [34, 144, 140], [96, 200, 98], [248, 228, 48]] },
  { id: 'jungle', name: 'Jungle', stops: [[33, 46, 30], [110, 118, 45], [210, 107, 39], [225, 142, 89], [235, 179, 144]] },
];

export const paletteById = (id: string | null) => PALETTES.find((p) => p.id === id) ?? PALETTES[0];

export const rgb = (c: number[]) => `rgb(${c.map(Math.round).join(',')})`;
