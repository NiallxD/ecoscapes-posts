#!/usr/bin/env bash
# One map-portal layer, as a single PMTiles file the /map/ page can read.
#
#   tools/prepare-layer.sh <input.tif> <id> [resampling] [colours.txt]
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
# The deepest zoom is the first one at least as fine as the input's own
# pixels: z12 for TerrAdapt's 30 m Landsat grid at this latitude. The map
# enlarges past it, so there is nothing to gain from cutting deeper.
# Needs GDAL and the pmtiles CLI (brew install gdal pmtiles).
set -euo pipefail

IN="$1"
ID="$2"
RESAMPLE="${3:-near}"
COLOURS="${4:-}"
OUT="public/tiles/layers"
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

# PNG, not WebP: lossless, so a class boundary stays one colour on each side,
# and flat categorical colour compresses well as PNG anyway.
gdal_translate -q -of MBTILES -co TILE_FORMAT=PNG -co ZOOM_LEVEL_STRATEGY=UPPER \
  -co RESAMPLING="$([ "$RESAMPLE" = near ] && echo NEAREST || echo BILINEAR)" \
  "$TMP/merc.tif" "$TMP/layer.mbtiles"
# Lower zooms. Mode for classes: a coarse pixel takes the commonest class under
# it rather than an average that belongs to no class.
LEVELS=()
for ((i = 2; i <= 1 << 10; i *= 2)); do LEVELS+=("$i"); done
gdaladdo -q -r "$([ "$RESAMPLE" = near ] && echo mode || echo average)" "$TMP/layer.mbtiles" "${LEVELS[@]}"

mkdir -p "$OUT"
pmtiles convert "$TMP/layer.mbtiles" "$OUT/$ID.pmtiles" >/dev/null
pmtiles show "$OUT/$ID.pmtiles" | grep -E "zoom|bounds" || true
echo "$OUT/$ID.pmtiles: $(du -h "$OUT/$ID.pmtiles" | cut -f1)"
