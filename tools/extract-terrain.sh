#!/usr/bin/env bash
# The maps' ground: elevation for the whole EcoScapes study area, cut from
# Mapterhorn's planet terrain (https://mapterhorn.com), so the relief and the
# 3D view load nothing from anywhere but this site. One file serves /explore/
# (shaded relief), /map/ and /ecoscapes-dst/ (relief and 3D): the corridor
# sits inside the study area, and PMTiles only fetches the tiles in view.
#
#  * public/tiles/terrain.pmtiles -- 512 px Terrarium-encoded WebP tiles, cut
#    to `limit` in src/content/ecoscapes/sea-to-sky.md (keep the two in step).
#    Zoom 11 is about 25 m a pixel here: finer than the relief needs, and
#    MapLibre overzooms it smoothly. Zoom 12 would be about 220 MB.
#
#   tools/extract-terrain.sh
#
# BBOX, MAXZOOM and OUT_FILE are overridable through the environment, as in
# tools/extract-basemap.sh. Needs the pmtiles CLI (brew install pmtiles).
set -euo pipefail

BBOX="${BBOX:--124.69,48.94,-121.43,51.26}"
MAXZOOM="${MAXZOOM:-11}"
OUT="public/tiles"
OUT_FILE="${OUT_FILE:-terrain.pmtiles}"

mkdir -p "$OUT"
pmtiles extract https://download.mapterhorn.com/planet.pmtiles "$OUT/$OUT_FILE" \
  --bbox="$BBOX" --maxzoom="$MAXZOOM"
echo "terrain: $(du -h "$OUT/$OUT_FILE" | cut -f1)"
