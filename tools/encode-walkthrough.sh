#!/usr/bin/env bash
# A series walkthrough, as the two files the page offers: HEVC at full size
# (small for its quality -- what matters where reception is poor) and H.264 at
# 1600 wide for browsers without HEVC. Both with a keyframe every second, so
# dragging the year slider lands quickly. Plus the poster, from the first frame.
#
#   tools/encode-walkthrough.sh <editor export> <slug> <name>
#   tools/encode-walkthrough.sh ~/Desktop/walkthrough.mp4 feather-park-01 series-linkages
#
# Writes public/media/<slug>/<name>.hevc.mp4, <name>.mp4 and <name>-poster.jpg.
# The export's frame is kept as it is (only the fallback is scaled), so any
# base or overlay still made from the same export stays in register.
#
# Quality is set by CRF, not a bitrate: HEVC_CRF (default 30) and H264_CRF
# (default 32). Lower is sharper and bigger. The fallback is kept small on
# purpose: poor reception is the common case, so it trades quality, not data.
set -euo pipefail

src="${1:?usage: encode-walkthrough.sh <export> <slug> <name>}"
slug="${2:?usage: encode-walkthrough.sh <export> <slug> <name>}"
name="${3:?usage: encode-walkthrough.sh <export> <slug> <name>}"
out="$(dirname "$0")/../public/media/$slug"
mkdir -p "$out"

fps=$(ffprobe -v error -select_streams v:0 -show_entries stream=r_frame_rate -of csv=p=0 "$src" | awk -F/ '{ printf "%d", ($2 ? $1 / $2 : $1) + 0.5 }')

# -an: the page plays it muted, and an audio track is only weight.
ffmpeg -y -loglevel error -i "$src" -an -c:v libx265 -preset slow -crf "${HEVC_CRF:-30}" \
  -tag:v hvc1 -pix_fmt yuv420p -x265-params "keyint=$fps:min-keyint=$fps:scenecut=0:log-level=error" \
  -movflags +faststart "$out/$name.hevc.mp4"

ffmpeg -y -loglevel error -i "$src" -an -vf "scale=1600:-2:flags=lanczos" -c:v libx264 -preset slow \
  -crf "${H264_CRF:-32}" -pix_fmt yuv420p -g "$fps" -keyint_min "$fps" -sc_threshold 0 \
  -movflags +faststart "$out/$name.mp4"

# The poster at the fallback's size: it is only on screen until the clip starts.
ffmpeg -y -loglevel error -i "$out/$name.mp4" -vframes 1 -q:v 5 "$out/$name-poster.jpg"

for f in "$name.hevc.mp4" "$name.mp4" "$name-poster.jpg"; do
  printf '%-28s %s\n' "$f" "$(du -h "$out/$f" | cut -f1)"
done
dur=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$out/$name.mp4")
echo "duration: $dur s (the frontmatter's video.duration)"
