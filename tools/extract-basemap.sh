#!/usr/bin/env bash
# The map's base layer, cut from the Protomaps daily planet build, and the
# one font the town names are set in -- so /map/ and /ecoscapes-dst/ load
# nothing from anywhere but this site and the tile host.
#
# public/tiles/basemap-study.pmtiles is the whole EcoScapes study area, at
# zoom 13, cut to `limit` in src/content/ecoscapes/sea-to-sky.md and 0.3 deg
# of longitude, 0.2 of latitude round it (about 20 km): the margin the maps
# fade to black over, the same on every side (BUFFER in src/lib/study-style.ts;
# keep the three in step). The same zoom 14 would run to about 94 MB; zoom 13 halves it, at
# the cost of the finest detail close in (small buildings, footpaths) -- the
# map overzooms vector tiles cleanly past it.
#
#   tools/extract-basemap.sh              # latest build
#   tools/extract-basemap.sh 20260923     # a given day
#
# BBOX, MAXZOOM and OUT_FILE are overridable through the environment. (The
# corridor-only file this used to make by default, basemap.pmtiles at zoom 14,
# is gone: BBOX=-123.9,49.28,-122.05,50.45 MAXZOOM=14 OUT_FILE=basemap.pmtiles.)
#
# Needs the pmtiles CLI (brew install pmtiles). Only reads the byte ranges it
# needs from the 130 GB planet file, so this takes seconds, not hours.
set -euo pipefail

BBOX="${BBOX:--124.99,48.74,-121.13,51.46}"
MAXZOOM="${MAXZOOM:-13}"
OUT="public/tiles"
OUT_FILE="${OUT_FILE:-basemap-study.pmtiles}"

BUILD="${1:-$(curl -fsS https://build-metadata.protomaps.dev/builds.json |
  node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).at(-1).key.replace(".pmtiles","")))')}"

mkdir -p "$OUT"
pmtiles extract "https://build.protomaps.com/${BUILD}.pmtiles" "$OUT/$OUT_FILE" \
  --bbox="$BBOX" --maxzoom="$MAXZOOM"
echo "basemap: build $BUILD, $(du -h "$OUT/$OUT_FILE" | cut -f1)"

# Glyphs: Latin, Latin Extended A, combining marks (the diacritics in names
# such as Líl̓wat and Q'aLaTKú7eM), Latin Extended Additional and punctuation.
# Any other range is simply not drawn.
FONT="Noto Sans Medium"
mkdir -p "$OUT/fonts/$FONT"
for start in 0 256 768 7680 8192; do
  range="$start-$((start + 255))"
  curl -fsS "https://protomaps.github.io/basemaps-assets/fonts/${FONT// /%20}/$range.pbf" -o "$OUT/fonts/$FONT/$range.pbf"
done

du -sh "$OUT"
