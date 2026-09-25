# EcoScapes planning support tool

A weighted, multi-criteria planning map for the Sea-to-Sky, at
**`/ecoscapes-dst/`**. It does what the RRN demo did — pick layers, say what
counts as good, weigh them, combine them — on this region's own data, at 24 m
detail, as a **static site with no server**.

> **Status:** prototype, on the local branch **`DST`** (not pushed, not on
> `main`, so it does not deploy). The examples, layer descriptions and default
> thresholds are provisional until the final data arrives and the data owners
> have been consulted.

---

## Contents

1. [At a glance](#at-a-glance)
2. [Running it](#running-it)
3. [What it can do](#what-it-can-do)
4. [How it works](#how-it-works)
5. [The data](#the-data)
6. [Accuracy — what was checked](#accuracy--what-was-checked)
7. [Performance — what was measured](#performance--what-was-measured)
8. [Compared with RRN](#compared-with-rrn)
9. [Maintaining it](#maintaining-it)
10. [Known limits and next steps](#known-limits-and-next-steps)
11. [File map](#file-map)

---

## At a glance

| | |
|---|---|
| **Where** | `src/pages/ecoscapes-dst.astro` → `/ecoscapes-dst/` |
| **Layers** | 44 (20 from the Drive originals, 24 from Felt) |
| **Detail** | ~24 m pixels (z12), real values, not colours |
| **Data size** | 368 MB of tiles + 8.5 MB of area samples |
| **Server** | None. Static files; everything is computed in the browser |
| **Browsers tested** | Chromium and WebKit (Safari's engine), 33 automated checks each |
| **Speed** | Slider changes redraw in ~8 ms a frame on a real GPU |

---

## Running it

```bash
npm run build && npm run preview          # http://localhost:4331/ecoscapes-dst/

python3 tools/build-dst.py                # build any layer that is missing
python3 tools/build-dst.py --all          # rebuild every layer (~25 min)

node tools/test-dst.mjs                   # end-to-end checks, Chromium
node tools/test-dst.mjs --browser webkit  # the same in Safari's engine
node tools/bench-dst.mjs                  # performance run (4G-like network)
node tools/bench-dst.mjs --gpu            # …on this machine's real GPU
```

WebKit for the tests is a one-off `npx playwright install webkit`.

The tile files (`public/tiles/dst/`) are **not in git** — they are generated,
and belong in R2 eventually. On a fresh checkout, run `tools/build-dst.py`.

---

## What it can do

**Build a model**

- **Eight examples** to start from — Wildlife strongholds, Under pressure,
  Room to roam, Bear country, Life at the water's edge, Quiet and intact,
  Value × pressure, Habitat × climate — each explained in a line, and each
  marked as an example, not a recommendation. The page opens empty.
- **Add any of 44 layers** from a grouped menu (up to 8 at once).
- **Say what counts as good** with two thresholds, *Poor at* and *Best at*, in
  the layer's own units, over a histogram of its real values. Swap the ends to
  make low values the good ones.
- **Score a categorical layer kind by kind** — land cover's 18 kinds each get
  Poor / Fair / Good.
- **Weigh** each layer ×0.5 to ×5, and **combine** by *Weigh up* (weighted
  mean), *All must pass* (fuzzy and) or *Any one* (fuzzy or).
- **Show one layer alone** (the eye) to see what it contributes.

**Read the result**

- **The map recolours instantly** as any slider moves.
- **Tap anywhere** for why it scored what it did: every layer's value there,
  its score, its weight, and the total.
- **How much fits** — the share and area scoring at or above a cut-off, and
  the spread of scores by area, which is also the map's key.
- **Whole area / This view / Draw** — count across the study area, just what
  is on screen, or inside any area you **draw** (click round it,
  double-click to finish).
- **Only show places above the cut-off.**
- **How steady is it?** — every weight nudged up and down sixteen times; the
  map shows where the answer holds however the weights shift and where it
  hinges on exactly how they were set, with the area split into always /
  mostly / sometimes / never.
- **Two scores (bivariate)** — sort layers into two named groups (e.g. Value
  and Pressure) and see where they coincide on a 3×3 key. Hover a cell for
  its area, click to show it alone, move each axis's low/high breaks.

**Go further**

- **Best places** — the five strongest ~3 km areas for the model, pinned and
  named by the nearest town ("12 km north-east of Pemberton"); click one to
  fly there and have it explained.
- **Take the tour** — flies through the five in turn; touch the map to stop.
- **Score where I am** — the locate button scores the spot you are on.
- **Share** — the whole model (and any drawn area) lives in the address;
  the link button copies it.
- **Take it away** — the map as an image (with the model and numbers drawn
  under it) and the numbers as a CSV.

---

## How it works

```
 Drive GeoTIFFs ─┐                                        ┌─ tile worker ──► GPU textures ─► shader ─► map
 Felt values ────┼─► prepare-value-layer.py ─► PMTiles ───┤   (fetch + decode)   (one per layer per tile)
                 │    (1 byte a pixel)       + sample ────┴─ stats worker ──► numbers, best places
 catalogue ──────┘    build-dst.py            (every ~200 m)   (area counts)
```

### 1. Values, not colours

`tools/prepare-value-layer.py` turns any GDAL-readable raster into a PMTiles
file of **values**:

- Each pixel is **one byte**: `0` = no data, `1–255` = the value scaled
  between the layer's own minimum and maximum. 254 steps is far finer than
  any threshold a person sets, and one byte a pixel keeps files small.
- Tiles are **lossless WebP**, 256 px, z6–z12. Lossless matters: a lossy
  codec would quietly move values across thresholds.
- **Zoomed-out tiles keep one real pixel** of each 2×2 block rather than an
  average. A threshold applied to an average is not the average of the
  thresholded pixels — a block half excellent and half cleared would score
  "moderate" everywhere. Kept pixels are true full-detail values, so every
  zoom agrees with the numbers.
- Alongside each file, an **area sample**: one real value every ~200 m on a
  grid all layers share (~1.5 million points), as a lossless WebP.

### 2. Scoring on the GPU

`src/lib/dst/score-layer.ts` is a MapLibre custom layer.

- A **worker** (`tile-worker.ts`) fetches and decodes tiles, so the main
  thread never stalls. Each becomes **one texture per layer per tile**:
  adding a layer loads only that layer.
- Every criterion becomes a **256-entry lookup table** — its 0–1 score for
  every possible byte (`model.ts`). The shader, the area counts and
  tap-to-explain all read the same tables, so they cannot disagree. The same
  mechanism serves thresholds and per-category scores.
- A slider changes a table row and some uniforms: **the map recolours on the
  next frame** with nothing fetched or decoded.
- Tiles not yet loaded are drawn from the **nearest loaded ancestor**, per
  layer, over just their own square. A tile is drawn only once every layer
  has something for it, so a half-loaded model never shows a wrong score.
- Requests go **nearest the middle first**, are **cancelled** when the view
  moves on, and once the view is complete a **ring of tiles just outside it**
  is fetched, so pans find their new edge already loaded. Hovering an example
  **warms** its files before the click.

### 3. Counting areas

`src/lib/dst/stats-worker.ts` counts from the area samples, off the main
thread, weighting each point by the ground it stands for (which shrinks
northward on a Mercator grid). The whole area is counted **once per model**
and cached; the view or a drawn area is counted over **just its own cells**
(a drawn outline is filled scanline by scanline). The same pass finds the
**best places** and the **steadiness** breakdown.

### 4. The page

`src/pages/ecoscapes-dst.astro` holds the panel, the key and the wiring. The
model lives in one place (a list of layers with thresholds, weights, axis and
category scores), and is written to the address as it changes.

---

## The data

44 layers, listed in `tools/dst-catalogue.json` (the one file to edit).

| Group | Layers | Source |
|---|---|---|
| Ecosystem health | Habitat suitability, Landscape permeability, Ecosystem resilience, Ecosystem services, Biodiversity index, Ecosystem vulnerability, Conservation priorities | Drive (priorities: Felt) |
| Land cover | Land cover (18 kinds, scored per kind) | Drive |
| Pressures | Cumulative human impacts, Change in human footprint, Built-up density, Closeness to trails, Wildfire hazard | Drive |
| Change over 40 years | Forest, Riparian, Mesic vegetation, Xeric vegetation (loss / no change / gain) | Drive |
| Climate | Climate refugia (regional and local), Climate conservation value, Climate restoration value | Drive (1 km) |
| Connectivity | Connectivity linkages | Felt |
| Species habitat | Grizzly bear, Wolverine, Canada lynx, Pacific fisher, Hoary marmot, Coyote, Douglas squirrel, Yellow-pine chipmunk, Beaver, Mink, Northern red-legged frog, Western toad, Pacific tree frog, Ensatina / Northwestern / Long-toed salamanders, Northern alligator lizard, Common garter snake, Black bear (summer, fall), Black-tailed deer (A, B) | Felt |

**Where the data comes from**

- **Drive** — the Felt originals in *EcoScapes / EcoScapes-Felt-Maps /
  archive / Biodiversity*, read as they are.
- **Felt** — layers not in the Drive, fetched as real values from Felt's
  public value tiles. `tools/felt-layers.py` rebuilds the list of Felt layers
  (`archive/felt_layers_full.json`) from the embed links in the map portal's
  `map_config.json`, with no API token.

**Things found in the data, and what was done**

| Finding | What was done |
|---|---|
| `Distance2Trails` is 0 in remote country and ~48 on the Chief trail: higher means **closer**, not further | Named *Closeness to trails*; low is good by default |
| Wildfire hazard has codes −3 to −1 besides classes 1–10, meaning unknown | Treated as no data (`valid: [1, 10]`) |
| Wolverine habitat and Conservation priorities fill the whole box, ocean included, with zeros — doubling the "area covered" and diluting every percentage | Clipped to the study area's footprint (`mask`) |
| Land cover codes run 1–18; Felt's labels belong to code − 1; code 1 has no label | Labels corrected; code 1 shown as *Unlabelled (class 1)* |
| Black bear and deer each have several Felt datasets all named "Habitat Suitability" | Matched to `/map`'s fall/summer and A/B by each dataset's minimum value |
| `conservation-areas.tif` has six classes and no labels | Left out |
| Several layers are likely **composites** of others (e.g. cumulative impacts includes human footprint) | Not yet handled — see next steps |

**Descriptions to confirm with the data owners:** *Climate conservation value*
and *Climate restoration value* are read from file names; the direction of
*Ecosystem vulnerability* for planning; which of the resilience variants Felt
shows.

---

## Accuracy — what was checked

| Check | Result |
|---|---|
| **Tap value vs the original GeoTIFF**, 60 random points × 8 layers | 93% identical to within half an encoding step; every other one equals a neighbouring source pixel (the unavoidable half-pixel shift of reprojecting BC Albers 24.2 m onto the web grid). No-data agreed at every point. |
| **Area sample vs full detail** | Sampling every ~200 m instead of ~100 m changes study-area shares by at most **0.02 percentage points** (6 layers) |
| **Sample vs full-resolution histogram** | Share in the top half of each range matches within **0.1 points** (0.6 for the 1 km climate layer) |
| **Drawn area** | A triangle round Squamish: **276 km² counted, 276 km² drawn** |
| **Steadiness** | always + mostly + sometimes + never = the whole area, to the km² |
| **Lossless round trip** | Every sample image decodes pixel-identical after re-encoding |
| **Browsers** | Every check passes in Chromium and WebKit with identical numbers |

---

## Performance — what was measured

`tools/bench-dst.mjs`: a fixed script on a 4G-like link (40 ms a request,
12 Mbit/s), service worker off, so every tile comes over the network.

| | Start of the night | Now |
|---|---|---|
| Open an example (5 layers) | 3.5 s, 5.2 MB | **1.6 s, 2.5 MB** |
| Pans after the first | 0.5–0.7 s each | **instant** (already loaded) |
| Area count (5 layers) | ~250 ms | **~55–75 ms** |
| Main-thread stalls | none | **none** |
| Slider drag, real GPU (M2 Pro) | — | **7.8 ms a frame** |
| …with *how steady* on (16× the work) | — | **9.0 ms a frame** |

**What made the difference:** decoding in a worker; one texture per layer per
tile; shared lookup tables; area samples every ~200 m (a quarter of the
bytes); counting only what changed; warming on hover; the ring round the
view.

**Reading the numbers:** the local preview server speaks HTTP/1.1 (six
connections at a time), so request-heavy steps are *pessimistic* here.
GitHub Pages and R2 serve HTTP/2, which fetches them all at once. Without
`--gpu` the benchmark renders in software, so its frame times are much
slower than any real device.

---

## Compared with RRN

| RRN | This tool |
|---|---|
| Fuzzy thresholds, direction, weights | ✅ Same maths, as lookup tables |
| Weighted union, and, or | ✅ (plain union = equal weights; xor left out as rarely useful) |
| Instant recolour | ✅ GPU, every frame |
| Histograms under thresholds | ✅ |
| Category mapping | ✅ Per-kind scores (land cover) |
| Bivariate colouring | ✅ 3×3, palette checked for colour-blind readers |
| Parcel totals (Analyse mode) | ✅ **Any drawn area**, not only fixed parcels |
| Save a custom stack | ✅ **Shareable link** |
| Screenshot | ✅ Image with the model and numbers under it |
| H3 hexagons | ➕ **24 m pixels** instead |
| Django + PostGIS + tile cache + host | ➕ **No server** |
| — | ➕ Tap-to-explain, best places and tour, how steady, where I am |
| Nested groups of criteria | ❌ Not yet |
| Upload through an admin page | ❌ By design: one script run instead |

---

## Maintaining it

**Add or replace a layer** — one entry in `tools/dst-catalogue.json`, then
`python3 tools/build-dst.py`:

```json
{
  "id": "habitat-grizzly-bear",
  "name": "Grizzly bear",
  "group": "Species habitat",
  "higher": "better",
  "about": "How well the land suits the grizzly bear.",
  "source": { "drive": "path/under/the/Drive/archive.tif" }
}
```

Optional: `"classes": true` (classed values), `"labels": [{ "value": 1,
"label": "…" }]`, `"categorical": true` (score per kind), `"valid": [min,
max]` (other values are no data), `"mask": { "drive": "…" }` (clip to another
layer's footprint), or `"source": { "felt": "<dataset id>" }`.

**When the final data arrives** — point each entry's `source` at the new
file (any GDAL format), `build-dst.py --all`, then `node tools/test-dst.mjs`.
Ask for, with each layer: real values (not styled), a stated no-data value,
units, which way is good, and labels for any classes. The Felt tools
(`felt-layers.py`, `fetch-felt-layer.py`) are then no longer needed.

**After changing the page** — `npm run build && npm run preview`, then the
tests in both browsers, and the benchmark to compare.

---

## Known limits and next steps

1. **Host the tiles on R2** behind a custom domain with caching (about the
   same speed as now, pennies a month, no git bloat). Needs CORS on the
   bucket and the service worker taught the tiles' domain.
2. **Composite layers** — tag layers built from others, and warn when a
   composite and its own ingredients are weighed together. Needs the lineage
   from the data owners. Two examples (*Wildlife strongholds*, *Under
   pressure*) likely double-count human footprint today.
3. **Thresholds from the data owners** — defaults are the 25th/95th
   percentiles of each layer, i.e. "good *for this region*", not an absolute
   standard.
4. **Nested groups** (RRN's criteria tree), if wanted after the composites
   discussion.
5. **Test on an iPhone.** WebKit passes every check, but a real device is
   the last word.
6. **Mobile layout** works but was not a focus.

---

## File map

| File | What it is |
|---|---|
| `src/pages/ecoscapes-dst.astro` | The page: panel, key, all interaction |
| `src/lib/dst/model.ts` | Shared scoring: types, lookup tables, weight variations |
| `src/lib/dst/score-layer.ts` | The GPU layer: tiles, textures, shader, explain |
| `src/lib/dst/tile-worker.ts` | Fetches and decodes value tiles |
| `src/lib/dst/stats-worker.ts` | Area counts, drawn areas, best places, steadiness |
| `src/lib/study-style.ts` | The shared dark basemap style |
| `src/data/dst-layers.json` | Generated: the page's layer list |
| `tools/dst-catalogue.json` | **The layer catalogue — the file to edit** |
| `tools/build-dst.py` | Builds every layer in the catalogue |
| `tools/prepare-value-layer.py` | One raster → value PMTiles + area sample |
| `tools/felt-layers.py` | Rebuilds the Felt layer list from public embeds |
| `tools/fetch-felt-layer.py` | Fetches one Felt layer's real values |
| `tools/test-dst.mjs` | End-to-end checks (Chromium / WebKit) |
| `tools/bench-dst.mjs` | Performance run |
| `archive/felt_layers_full.json` | The rebuilt Felt layer list |
