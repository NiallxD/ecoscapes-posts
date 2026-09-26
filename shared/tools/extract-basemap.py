#!/usr/bin/env python3
"""
The map's base layer, cut from the Protomaps daily planet build, and the one
font the town names are set in -- so /map/ and /ecoscapes-dst/ load nothing
from anywhere but this site and the tile host.

public/tiles/basemap-study.pmtiles is the whole EcoScapes study area, at zoom
13, cut to `limit` in map/content/sea-to-sky.md and 0.3 deg of
longitude, 0.2 of latitude round it (about 20 km): the margin the maps fade to
black over, the same on every side (BUFFER in shared/lib/study-style.ts; keep the
three in step). Zoom 14 would run to about 94 MB; zoom 13 halves it, at the
cost of the finest detail close in (small buildings, footpaths) -- the map
overzooms vector tiles cleanly past it.

  shared/tools/extract-basemap.py                  # latest build
  shared/tools/extract-basemap.py --build 20260923 # a given day

Needs the pmtiles CLI (brew install pmtiles). Only reads the byte ranges it
needs from the 130 GB planet file, so this takes seconds, not hours.
"""
import argparse, json, os, subprocess, urllib.request

# The study area plus the fade margin (see above; the same as extract-terrain.py).
BBOX = "-124.99,48.74,-121.13,51.46"
OUT = "public/tiles"
# Glyphs: Latin, Latin Extended A, combining marks (the diacritics in names
# such as Líl̓wat and Q'aLaTKú7eM), Latin Extended Additional and punctuation.
# Any other range is simply not drawn.
FONT = "Noto Sans Medium"
GLYPH_RANGES = [0, 256, 768, 7680, 8192]


def get(url):
    # Python's own user agent is turned away (403) by the Protomaps hosts.
    return urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "ecoscapes-pipeline/1.0"}))


def latest_build():
    with get("https://build-metadata.protomaps.dev/builds.json") as r:
        return json.load(r)[-1]["key"].removesuffix(".pmtiles")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--build", help="Protomaps build day, e.g. 20260923 (default: the latest)")
    ap.add_argument("--bbox", default=BBOX)
    ap.add_argument("--maxzoom", type=int, default=13)
    ap.add_argument("--out-file", default="basemap-study.pmtiles")
    a = ap.parse_args()

    build = a.build or latest_build()
    os.makedirs(OUT, exist_ok=True)
    out = os.path.join(OUT, a.out_file)
    subprocess.run(["pmtiles", "extract", f"https://build.protomaps.com/{build}.pmtiles", out,
                    f"--bbox={a.bbox}", f"--maxzoom={a.maxzoom}"], check=True)
    print(f"basemap: build {build}, {os.path.getsize(out) / 1e6:.0f} MB")

    fonts = os.path.join(OUT, "fonts", FONT)
    os.makedirs(fonts, exist_ok=True)
    for start in GLYPH_RANGES:
        rng = f"{start}-{start + 255}"
        url = f"https://protomaps.github.io/basemaps-assets/fonts/{FONT.replace(' ', '%20')}/{rng}.pbf"
        with get(url) as r, open(os.path.join(fonts, f"{rng}.pbf"), "wb") as f:
            f.write(r.read())
    print(f"glyphs: {len(GLYPH_RANGES)} ranges of {FONT}")


if __name__ == "__main__":
    main()
