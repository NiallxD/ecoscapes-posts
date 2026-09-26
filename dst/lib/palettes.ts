/** The colour ramps the Data Sandbox can draw one score in: five stops, low
 *  score to high, as 0..255 RGB. Each starts close to the ground's own dark,
 *  so a poor fit recedes into the basemap and a good one stands out of it;
 *  the brightest stop is also the best places' pins. The two-score key keeps
 *  its own nine colours. */
export type Palette = { id: string; name: string; stops: [number, number, number][] };

export const PALETTES: Palette[] = [
  { id: 'ember', name: 'Ember', stops: [[44, 24, 22], [112, 28, 28], [190, 54, 26], [240, 122, 32], [255, 216, 124]] },
  { id: 'gold', name: 'Gold', stops: [[45, 35, 24], [111, 71, 18], [180, 110, 15], [233, 158, 31], [255, 221, 128]] },
  { id: 'glacier', name: 'Glacier', stops: [[3, 0, 29], [10, 15, 78], [22, 43, 125], [42, 80, 163], [75, 124, 191]] },
  { id: 'forrest', name: 'Forrest', stops: [[2, 15, 4], [16, 73, 17], [47, 122, 38], [91, 163, 68], [144, 182, 121]] },
  { id: 'clear', name: 'Clear sight', stops: [[52, 22, 70], [62, 82, 140], [34, 144, 140], [96, 200, 98], [248, 228, 48]] },
  { id: 'jungle', name: 'Jungle', stops: [[19, 34, 18], [66, 76, 28], [128, 121, 34], [200, 130, 30], [243, 115, 33]] },
];

export const paletteById = (id: string | null) => PALETTES.find((p) => p.id === id) ?? PALETTES[0];

export const rgb = (c: number[]) => `rgb(${c.map(Math.round).join(',')})`;
