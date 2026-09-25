#!/usr/bin/env python3
"""
Rebuild felt_layers_full.json -- every raster layer on the EcoScapes Felt maps,
with what tools/fetch-felt-layer.py and tools/gen-style.py need to fetch its
values and read its style -- from the maps' public embed pages. No API token:
a public embed page carries its layers' full JSON in <div id="felt-data">.

  tools/felt-layers.py <map_config.json> [--out archive/felt_layers_full.json]

<map_config.json> is the map portal's config (EcoScapes-Map-App-v2), which
holds each indicator's Felt embed URL.

Keyed by the layer's pipeline_dataset_id, which is what --id means to the
other two tools. Each entry: name, the map it came from, `encoded` (the value
tile template), `bands` (base/interval: value = base + (R*65536+G*256+B) *
interval), the layer's style, bounding box, and the raw layer JSON as `raw`.
"""
import argparse, html, json, re, sys, urllib.request


def walk(o):
    if isinstance(o, dict):
        yield o
        for v in o.values():
            yield from walk(v)
    elif isinstance(o, list):
        for v in o:
            yield from walk(v)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("config")
    ap.add_argument("--out", default="archive/felt_layers_full.json")
    a = ap.parse_args()

    text = open(a.config).read()
    maps = sorted(set(re.findall(r"felt\.com/(?:embed/)?map/([A-Za-z0-9-]+)", text)))
    print(f"{len(maps)} Felt maps", file=sys.stderr)

    layers = {}
    for slug in maps:
        url = f"https://felt.com/embed/map/{slug}"
        req = urllib.request.Request(url, headers={"User-Agent": "ecoscapes-pipeline/1.0"})
        try:
            page = urllib.request.urlopen(req, timeout=30).read().decode("utf-8")
        except Exception as e:
            print(f"  ! {slug}: {e}", file=sys.stderr)
            continue
        m = re.search(r'<div id="felt-data"[^>]*>(.*?)</div>', page, re.S)
        if not m:
            print(f"  ! {slug}: no felt-data", file=sys.stderr)
            continue
        data = json.loads(html.unescape(m.group(1)))
        found = 0
        for o in walk(data):
            if o.get("geometry_type") != "Raster" or not o.get("pipeline_dataset_id"):
                continue
            tiles = next((t for t in walk(o) if "encoded_tile_url" in t), None)
            if not tiles:
                continue
            key = o["pipeline_dataset_id"]
            layers[key] = {
                "name": o.get("name"),
                "map": slug,
                "map_url": url,
                "encoded": tiles["encoded_tile_url"],
                "bands": tiles.get("bands"),
                "style": o.get("style"),
                "bounding_box": o.get("bounding_box"),
                "raw": o,
            }
            found += 1
        print(f"  {slug}: {found} raster layer(s)", file=sys.stderr)

    json.dump(layers, open(a.out, "w"), indent=1)
    print(f"{len(layers)} layers -> {a.out}", file=sys.stderr)


if __name__ == "__main__":
    main()
