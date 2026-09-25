#!/usr/bin/env bash
# One map-portal layer, as a single PMTiles file the /explore/ page can read.
#
#   tools/prepare-layer.sh <input.tif> <id> [resampling] [colours.txt] [outdir] [format]
#
#   tools/prepare-layer.sh ~/Downloads/landcover-2024.tif landcover-2024
#   tools/prepare-layer.sh ~/Downloads/canopy.tif canopy bilinear
#   tools/prepare-layer.sh ~/Downloads/linkages.tif connectivity-linkages near \
#     tools/styles/connectivity-linkages.txt
#
# Writes public/tiles/layers/<id>.pmtiles; list it under `layers` in
# src/content/map/sea-to-sky.md to put it on the map.
#
# The input has to carry its own colours -- RGB(A), or a single band with a
# colour table (which is what a classed map exported from GIS usually is). A
# bare single band of numbers has nothing to draw with: style it in QGIS and
# export the rendered image (Export > Save as Image, or "Rendered image" in
# Save Raster Layer As) first -- or pass a colour file, and it is coloured
# here with gdaldem color-relief (see tools/styles/ for the format).
#
# Resampling defaults to nearest, which keeps classes crisp and never invents
# a colour that is not in the legend -- right for landcover. Pass bilinear for
# continuous surfaces (elevation, canopy height, probabilities).
#
# The deepest zoom is the first one whose resolution best matches the input's
# own pixels: z12 for TerrAdapt's 30 m Landsat grid at this latitude. Which
# integer zoom that is comes out of GDAL as a fractional number -- the
# reprojection to Web Mercator very rarely lands a pixel exactly on a zoom's
# nominal resolution, so it is always a hair finer or coarser than some zoom.
# ZOOM_LEVEL_STRATEGY=AUTO rounds that fraction to the nearest integer zoom,
# which is what "best matches" means; UPPER (this script's setting until it
# was measured against the fetched data) instead always rounds up, so a
# reprojected pixel that comes out even a fraction finer than a zoom's
# resolution buys a whole extra zoom level of pure upsampling -- half of every
# file, for a fetch this data never actually had the detail for. The map
# enlarges past the deepest zoom with nearest resampling, so nothing already
# this coarse is lost by not cutting a level no sharper than the one below it.
# Needs GDAL and the pmtiles CLI (brew install gdal pmtiles).
set -euo pipefail

IN="$1"
ID="$2"
RESAMPLE="${3:-near}"
COLOURS="${4:-}"
OUT="${5:-${OUT:-public/tiles/layers}}"
# webp: PNG re-encoded losslessly to WebP before the PMTiles convert, ~60%
# smaller at bit-identical pixels (fully transparent pixels may differ in RGB
# -- invisible, since alpha is 0). png: skip that step, keep GDAL's PNG as-is.
# GDAL's own MBTiles WEBP writer only takes a lossy QUALITY option, so it is
# never used here -- this script always has GDAL write PNG first regardless
# of FORMAT, then re-encodes the tiles table itself when FORMAT=webp.
FORMAT="${6:-webp}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# Bare values are coloured from the colour file, NoData left clear.
if [ -n "$COLOURS" ]; then
  grep -v '^#' "$COLOURS" > "$TMP/colours.txt"
  gdaldem color-relief -q -alpha "$IN" "$TMP/colours.txt" "$TMP/coloured.tif"
  IN="$TMP/coloured.tif"
fi

# A colour table is expanded to RGBA; anything else is passed through.
if gdalinfo "$IN" | grep -q "Color Table"; then EXPAND=(-expand rgba); else EXPAND=(); fi

# Web Mercator, the projection every tile on the map is in. The alpha band
# that warping adds is what keeps the area outside the data see-through.
gdal_translate -q ${EXPAND[@]+"${EXPAND[@]}"} "$IN" "$TMP/rgba.tif"
gdalwarp -q -t_srs EPSG:3857 -r "$RESAMPLE" -dstalpha -co COMPRESS=DEFLATE "$TMP/rgba.tif" "$TMP/merc.tif"

# Always PNG out of GDAL -- lossless, so a class boundary stays one colour on
# each side -- and AUTO for the deepest zoom (see the header comment above).
gdal_translate -q -of MBTILES -co TILE_FORMAT=PNG -co ZOOM_LEVEL_STRATEGY=AUTO \
  -co RESAMPLING="$([ "$RESAMPLE" = near ] && echo NEAREST || echo BILINEAR)" \
  "$TMP/merc.tif" "$TMP/layer.mbtiles"
# Lower zooms. Mode for classes: a coarse pixel takes the commonest class under
# it rather than an average that belongs to no class.
LEVELS=()
for ((i = 2; i <= 1 << 10; i *= 2)); do LEVELS+=("$i"); done
gdaladdo -q -r "$([ "$RESAMPLE" = near ] && echo mode || echo average)" "$TMP/layer.mbtiles" "${LEVELS[@]}"

# Re-encode every tile in place as lossless WebP, and say so in the mbtiles's
# own metadata -- pmtiles convert reads that to set the PMTiles header's tile
# type, which is how a reader (MapLibre, or /explore/'s own decode()) knows
# which image codec the bytes need. method=6 is libwebp's slowest, smallest
# lossless setting; there is no tile-count here that makes that slowness
# matter.
if [ "$FORMAT" = webp ]; then
  python3 - "$TMP/layer.mbtiles" <<'PYEOF'
import sqlite3, io, sys
from PIL import Image

conn = sqlite3.connect(sys.argv[1])
cur = conn.cursor()
rows = cur.execute("SELECT zoom_level, tile_column, tile_row, tile_data FROM tiles").fetchall()
updates = []
for z, x, y, data in rows:
    img = Image.open(io.BytesIO(data)).convert("RGBA")
    buf = io.BytesIO()
    img.save(buf, format="WEBP", lossless=True, method=6)
    updates.append((buf.getvalue(), z, x, y))
cur.executemany(
    "UPDATE tiles SET tile_data = ? WHERE zoom_level = ? AND tile_column = ? AND tile_row = ?",
    updates,
)
cur.execute("UPDATE metadata SET value = 'webp' WHERE name = 'format'")
conn.commit()
conn.execute("VACUUM")
conn.close()
PYEOF
fi

mkdir -p "$OUT"
pmtiles convert "$TMP/layer.mbtiles" "$OUT/$ID.pmtiles" >/dev/null
pmtiles show "$OUT/$ID.pmtiles" | grep -E "zoom|bounds" || true
echo "$OUT/$ID.pmtiles: $(du -h "$OUT/$ID.pmtiles" | cut -f1)"
