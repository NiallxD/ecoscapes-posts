# dst/ -- the Data Sandbox, `/ecoscapes-dst/`

| Where | What |
| --- | --- |
| `content/layer-descriptions.md` | The longer text behind each layer's (i), also printed on the full map image. |
| `content/flyover-cards/cards.md` | The flyover's cards, with their pictures beside it. |
| `content/dst-layers.json` | Made by `tools/build-dst.py`; edit `tools/dst-catalogue.json` instead. |
| `DstPage.astro` | The page. |
| `lib/` | Scoring, palettes, the flyover and its video, and the workers that count areas and draw tiles. |
| `tools/` | Making the layer files, and checks (below). |

## tools/

- `build-dst.py`: every layer, from `dst-catalogue.json` (each layer's source -- a file on the EcoScapes Drive, or a Felt layer -- and its words) to `public/tiles/dst/` and `content/dst-layers.json`. Skips a layer already built; `--force <id>`, `--all`, or `--list-only`.
- `prepare-value-layer.py <tif> <id>`: one raster's values to a Data Sandbox layer.
- `prepare-flyover-cards.mjs`: the flyover card pictures to WebP, no wider than 2000 px.
- `test-dst.mjs`, `bench-dst.mjs`: checks and timings in a real browser.
