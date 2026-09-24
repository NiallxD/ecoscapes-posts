#!/usr/bin/env bash
# The map's base layer, cut from the Protomaps daily planet build to the
# Sea-to-Sky corridor, and the one font the town names are set in -- so /map/
# loads nothing from anywhere but this site.
#
#   tools/extract-basemap.sh            # latest build
#   tools/extract-basemap.sh 20260923   # a given day's build
#
# Needs the pmtiles CLI (brew install pmtiles). Only reads the byte ranges it
# needs from the 130 GB planet file, so this takes seconds, not hours.
#
# The box is the map's area -- `limit` in src/content/map/sea-to-sky.md, where
# the map draws its edge -- so keep the two in step. Its size is what bounds
# it: this box at zoom 14 is 28 MB, while the whole EcoScapes study area at
# the same detail is ~94 MB, against GitHub's 100 MB a file. Zoom 13 halves
# any box at the cost of the finest detail close in (small buildings,
# footpaths); the map overzooms vector tiles cleanly past whichever is cut.
set -euo pipefail

BBOX="-123.9,49.28,-122.05,50.45"
MAXZOOM=14
OUT="public/tiles"

BUILD="${1:-$(curl -fsS https://build-metadata.protomaps.dev/builds.json |
  node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).at(-1).key.replace(".pmtiles","")))')}"

mkdir -p "$OUT"
pmtiles extract "https://build.protomaps.com/${BUILD}.pmtiles" "$OUT/basemap.pmtiles" \
  --bbox="$BBOX" --maxzoom="$MAXZOOM"
echo "basemap: build $BUILD, $(du -h "$OUT/basemap.pmtiles" | cut -f1)"

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
