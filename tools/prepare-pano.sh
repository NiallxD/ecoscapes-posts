#!/usr/bin/env bash
# Prepare a 360 panorama for the web.
#
# Source panoramas come off the stitcher at ~7500x3750 and 4-7 MB. That is far
# too heavy for a trailhead on one bar of LTE, and no phone needs that
# resolution at a 90-degree field of view. 4096x2048 is the practical ceiling
# for a mobile sphere; it also stays under the max texture size of older GPUs.
#
# Usage: tools/prepare-pano.sh <source.jpg> <slug>
set -euo pipefail

src="${1:?usage: prepare-pano.sh <source.jpg> <slug>}"
slug="${2:?usage: prepare-pano.sh <source.jpg> <slug>}"
out="$(dirname "$0")/../public/media/$slug"
mkdir -p "$out"

# The sphere itself. 2:1 equirectangular is preserved exactly.
magick "$src" -resize 4096x2048! -strip -interlace Plane -quality 80 "$out/pano.jpg"

# A wide crop for the index card, so the card never pulls the full sphere.
magick "$src" -resize 1200x600! -strip -interlace Plane -quality 78 "$out/pano-card.jpg"

printf '%s -> %s (%s)\n' "$(basename "$src")" "$out/pano.jpg" "$(du -h "$out/pano.jpg" | cut -f1)"
printf '%s (%s)\n' "$out/pano-card.jpg" "$(du -h "$out/pano-card.jpg" | cut -f1)"
