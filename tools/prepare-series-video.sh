#!/usr/bin/env bash
# Prepare a TerrAdapt time-series export for scrubbing on a phone.
#
# TerrAdapt exports one frame per year at 1 fps with almost no keyframes (the
# Sea-to-Sky forest-integrity export is 38 frames with 2 keyframes across 38s).
# Browsers can only seek cheaply to a keyframe, so dragging a slider on that
# file is unusable.
#
# The re-encode goes via a lossless image sequence rather than re-timing the
# original. Re-timing left the container duration disagreeing with the frame
# timestamps, and the page derives the displayed year from position in the clip,
# so that disagreement showed up as the wrong year. From an image sequence the
# duration is exactly frames/fps and frame N sits exactly at N/fps.
#
# Usage: tools/prepare-series-video.sh <source.mp4> <slug> [fps]
set -euo pipefail

src="${1:?usage: prepare-series-video.sh <source.mp4> <slug> [fps]}"
slug="${2:?usage: prepare-series-video.sh <source.mp4> <slug> [fps]}"
fps="${3:-4}"                     # playback speed; the source is 1 frame/year
crf="${CRF:-27}"                  # these are map rasters with fine pixel detail
out="$(dirname "$0")/../public/media/$slug"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$out"

ffmpeg -y -loglevel error -i "$src" -vsync 0 "$tmp/%04d.png"
count=$(find "$tmp" -name '*.png' | wc -l | tr -d ' ')

# -g 4 / -keyint_min 4 / -sc_threshold 0 are what make seeking precise.
# -an because there is no audio, and muted video autoplays where sound does not.
ffmpeg -y -loglevel error -framerate "$fps" -i "$tmp/%04d.png" \
  -vf "scale=960:-2" \
  -c:v libx264 -profile:v main -pix_fmt yuv420p \
  -g 4 -keyint_min 4 -sc_threshold 0 -crf "$crf" \
  -movflags +faststart -an "$out/series.mp4"

# Poster: the final year, so the panel paints something real before play.
# mjpeg refuses libx264's limited-range yuv420p without an explicit pix_fmt.
ffmpeg -y -loglevel error -sseof -0.5 -i "$out/series.mp4" -vframes 1 \
  -pix_fmt yuvj420p -q:v 4 "$out/series-poster.jpg"

frames=$(ffprobe -v error -select_streams v:0 -count_frames \
  -show_entries stream=nb_read_frames -of default=nw=1:nk=1 "$out/series.mp4")
keys=$(ffprobe -v error -select_streams v:0 -show_entries frame=key_frame -of csv=p=0 "$out/series.mp4" | grep -c '^1')
dur=$(ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 "$out/series.mp4")

printf '%s  %s\n' "$out/series.mp4" "$(du -h "$out/series.mp4" | cut -f1)"
printf 'source frames=%s -> output frames=%s keyframes=%s duration=%ss\n' "$count" "$frames" "$keys" "$dur"
printf 'the export has %s yearly frames: set series.video.from and .to accordingly\n' "$frames"
