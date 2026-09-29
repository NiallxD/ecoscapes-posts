# map/ -- the EcoScapes map, `/map/`

| Where | What |
| --- | --- |
| `content/ecoscapes-layers.json` | Every data layer, however it was made (from the Felt maps, a GeoPackage, TerrAdapt): its file, name, source, legend, heading and one-line description. The last is drawn on top. A new layer is a new entry here. |
| `content/ecoscapes-themes.json` | The headings the layer list is grouped under. |
| `content/sea-to-sky.md` | The site's own words: the map's area, opening text, the Bear, the "you're standing in…" cards (by layer id), pins. The Data Sandbox reads its area and basemap from here too. |
| `MapPage.astro` | The page. |
| `lib/lens.ts` | The lens: the circle dragged over the map. |
| `content/timeseries.json` | The layers that have years (Through time, in `MapPage.astro`): where each year's file is, and its legend. |
| `tools/` | Making the map's layer files (below). |

## tools/

- `build-map.py`: every layer, from `map-catalogue.json` (each layer and where it comes from: a Felt layer, or a polygon file) to `public/tiles/ecoscapes/`. Skips a layer already built; `--force <id>` or `--all` rebuilds.
- `styles/ecoscapes/<id>.txt`: each layer's colours. Written from Felt's own style the first time (`gen-style.py`), then kept; edit by hand, or `build-map.py --restyle <id>` to take Felt's again.
- `prepare-layer.py <tif> <id>`: one coloured raster to a map layer.
- `rasterize-polygons.py <gpkg> <tif> r,g,b`: polygons to a raster, for `prepare-layer.py`.
- `fetch-terradapt-series.py`: a TerrAdapt layer's years, rebuilt from its dashboard tiles as one GeoTIFF a year (to `~/.cache/ecoscapes-terradapt/`).
- `build-series.py <id>`: those years to one PMTiles file each in `public/tiles/ecoscapes/<id>/`.
