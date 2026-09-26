#!/usr/bin/env python3
"""
The maps' ground: elevation for the whole EcoScapes study area, cut from
Mapterhorn's planet terrain (https://mapterhorn.com), so the relief and the 3D
view load nothing from anywhere but this site. One file serves /map/ and
/ecoscapes-dst/ (relief and 3D); PMTiles only fetches the tiles in view.

public/tiles/terrain.pmtiles -- 512 px Terrarium-encoded WebP tiles, cut to
`limit` in map/content/sea-to-sky.md and the same margin round it as
the basemap (shared/tools/extract-basemap.py; keep them in step). Zoom 11 is about
25 m a pixel here: finer than the relief needs, and MapLibre overzooms it
smoothly. Zoom 12 would be about 220 MB.

  shared/tools/extract-terrain.py

Needs the pmtiles CLI (brew install pmtiles).
"""
import argparse, os, subprocess

BBOX = "-124.99,48.74,-121.13,51.46"
OUT = "public/tiles"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--bbox", default=BBOX)
    ap.add_argument("--maxzoom", type=int, default=11)
    ap.add_argument("--out-file", default="terrain.pmtiles")
    a = ap.parse_args()

    os.makedirs(OUT, exist_ok=True)
    out = os.path.join(OUT, a.out_file)
    subprocess.run(["pmtiles", "extract", "https://download.mapterhorn.com/planet.pmtiles", out,
                    f"--bbox={a.bbox}", f"--maxzoom={a.maxzoom}"], check=True)
    print(f"terrain: {os.path.getsize(out) / 1e6:.0f} MB")


if __name__ == "__main__":
    main()
