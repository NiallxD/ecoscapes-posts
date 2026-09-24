#!/usr/bin/env bash
# Polygons (a GeoPackage, shapefile, GeoJSON...) burned into a single-colour
# raster the map can take as a layer, via tools/prepare-layer.sh.
#
#   tools/rasterize-polygons.sh <input> <output.tif> <r,g,b> [zoom]
#
#   tools/rasterize-polygons.sh habitat.gpkg /tmp/habitat.tif 112,168,0
#   tools/prepare-layer.sh /tmp/habitat.tif habitat-cores
#
# Burned straight onto the web map's own pixel grid at <zoom> (default 13,
# about 19 m a pixel), so tiling it afterwards is a copy rather than a
# resample and the edges stay as crisp as the zoom allows. Every polygon in
# the first layer is burned; outside them is transparent.
set -euo pipefail

IN="$1"
OUT="$2"
IFS=, read -r R G B <<< "$3"
ZOOM="${4:-13}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# Metres a pixel at this zoom in Web Mercator.
RES=$(node -e "console.log(40075016.68557849 / 256 / 2 ** $ZOOM)")

ogr2ogr -q -t_srs EPSG:3857 -nlt PROMOTE_TO_MULTI "$TMP/merc.gpkg" "$IN"
LAYER=$(ogrinfo -q "$TMP/merc.gpkg" | head -1 | sed -E 's/^[0-9]+: ([^ ]+).*/\1/')
gdal_rasterize -q -l "$LAYER" -tr "$RES" "$RES" -tap -ot Byte -a_nodata none \
  -init 0 -burn "$R" -burn "$G" -burn "$B" -burn 255 -co COMPRESS=DEFLATE \
  -co PHOTOMETRIC=RGB -co ALPHA=YES "$TMP/merc.gpkg" "$OUT"
gdalinfo "$OUT" | grep -E "^Size is"
