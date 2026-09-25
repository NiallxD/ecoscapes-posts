#!/usr/bin/env bash
# The map's base layer, cut from the Protomaps daily planet build, and the
# one font the town names are set in -- so /explore/ and /map/ load nothing
# from anywhere but this site. Two files come out of this script:
#
#  * public/tiles/basemap.pmtiles -- the Sea-to-Sky corridor, at zoom 14. This
#    is /explore/'s base layer, cut to `limit` in src/content/map/sea-to-sky.md
#    (keep the two in step). At this detail the corridor is 28 MB.
#  * public/tiles/basemap-study.pmtiles -- the whole EcoScapes study area, at
#    zoom 13. This is /map/'s base layer, cut to `limit` in
#    src/content/ecoscapes/sea-to-sky.md (keep the two in step). The study
#    area is roughly three times the corridor's, so the same zoom 14 would run
#    to about 94 MB -- too close to GitHub's 100 MB a file. Zoom 13 halves it,
#    at the cost of the finest detail close in (small buildings, footpaths);
#    the map overzooms vector tiles cleanly past whichever is cut, and this is
#    a map for exploring the whole area rather than walking-scale, so the
#    coarser cut is the right trade here.
#
#   tools/extract-basemap.sh                          # corridor, latest build
#   tools/extract-basemap.sh 20260923                  # corridor, a given day
#   BBOX=-124.69,48.94,-121.43,51.26 MAXZOOM=13 \
#     OUT_FILE=basemap-study.pmtiles tools/extract-basemap.sh
#
# BBOX, MAXZOOM and OUT_FILE are all overridable through the environment;
# left unset, they default to the corridor build above, so re-running this
# with no arguments still makes that file. The build day is still the one
# positional argument, in either case.
#
# Needs the pmtiles CLI (brew install pmtiles). Only reads the byte ranges it
# needs from the 130 GB planet file, so this takes seconds, not hours.
set -euo pipefail

BBOX="${BBOX:--123.9,49.28,-122.05,50.45}"
MAXZOOM="${MAXZOOM:-14}"
OUT="public/tiles"
OUT_FILE="${OUT_FILE:-basemap.pmtiles}"

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
