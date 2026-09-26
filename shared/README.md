# shared/ -- used by more than one part

| Where | What |
| --- | --- |
| `layouts/Shell.astro` | The page shell every page sits in. |
| `components/AnimalButton.astro` | The animal button, on the posts and the map. |
| `lib/paths.ts` | Every URL the site builds, including where map files come from. |
| `lib/study-style.ts`, `lib/terrain.ts` | The basemap's look, and the relief and 3D, for both maps. |
| `lib/compass.ts`, `lib/leave.ts` | The phone compass; the "leave this page?" check. |
| `tools/` | The map files both maps need, the tile host, and the offline cache (below). |

## tools/

- `extract-basemap.py`, `extract-terrain.py`: the basemap and the ground, cut from planet-wide files. Seconds each.
- `felt-layers.json`: every raster layer on the EcoScapes Felt maps, with the address of its values. Remake it only if the Felt maps change: `felt-layers.py <map_config.json>`.
- `fetch-felt-layer.py`: one Felt layer's values as a GeoTIFF. The map and Data Sandbox builds call it, sharing a cache in `~/.cache/ecoscapes-dst/`.
- `upload-tiles.py`: map files up to tiles.niallbell.com, and `tiles-manifest.json` rewritten (commit it). `r2-cors.json` is the bucket's one-time CORS setting.
- `sw-version.mjs`: run by the site build; versions the offline cache so visitors get changed files.
