#!/usr/bin/env python3
"""
The network's links (map/content/connections.json `links`): for every layer,
the maps in each of its three thirds -- Murray's links first
(map/tools/scm/scm-links.json, from his sheet by map/tools/scm-links.py),
then the maps that most share its ground, until the third is full.

  map/tools/connections.py            # rewrite `links`, print the scores
  map/tools/connections.py --dry-run  # print only

Every layer is laid on one grid over the study area (400 m, nearest value).
Each gets a "where it is": the top two classes of its own colour file
(map/tools/styles/ecoscapes/<id>.txt) -- good habitat, high impact, strong
linkage -- or, for the maps where that is not the meaning, a rule below (a
change map's loss or gain, any protected area, any record). Two maps are
scored by how much those areas fall in the same places (the phi
coefficient: 1 the same cells, 0 no more together than chance, below 0
apart), counted over the cells both maps cover. Land cover and the
ecological zones are kinds rather than amounts, so they are scored by how
strongly the other map follows their kinds (Cramer's V).

Murray's links come first, in his order. The overlap fills each third up to
PER, best first, and only those scoring at least
LEAST -- a third can be short, or empty, rather than show maps that are no
more in the same places than any two would be. Land cover's and the zones'
scores run higher than the rest (a different measure), so a third takes at
most one of the two. A layer listed in the file's
`keep` is left as it is, for links set by hand. Variants of one map (the two
black bear seasons, the two deer, the two protected-area maps, which draw
the same ground) are not linked to each other.

The grids are kept under --work/connections, redone when a source changes.

The values come from the same files as build-map.py: the Felt cache under
~/.cache/ecoscapes-dst, the portal's vector layers burned there, and this
site's own habitat cores read back from their tiles.
"""
import argparse, json, os, re, subprocess, tempfile

import numpy as np

CONNECTIONS = "map/content/connections.json"
SCM = "map/tools/scm/scm-links.json"
CATALOGUE = "map/tools/map-catalogue.json"
STYLES = "map/tools/styles/ecoscapes"
# The study area, as build-map.py.
BBOX = (-124.69, 48.94, -121.43, 51.26)
RES = 400
PER = 4
LEAST = 0.03

# Where a map is, when it is not its top two classes. `v` is the values.
RULES = {
    # Change maps: the loss (or the footprint's gain) is the pressure.
    "human-footprint-40yr": lambda v: v <= -2,
    "forest-change-40yr": lambda v: v < -0.5,
    "riparian-area-change-40yr": lambda v: v > 0.5,
    "mesic-vegetation-change-40yr": lambda v: v < -0.5,
    "xeric-vegetation-change-40yr": lambda v: v < -0.5,
    # Numbered highest first: 1 is Very High.
    "conservation-priorities": lambda v: (v >= 1) & (v <= 2),
    # 9 is Highest; 7-9 are High and up.
    "biodiversity-categories": lambda v: v >= 7,
    # Anywhere there is one.
    "invasive-species": lambda v: v > 0,
    "protected-areas-iucn": lambda v: v > 0,
    "protected-areas-cpcad": lambda v: v > 0,
    "occurrences-mammals": lambda v: v > 0,
    "occurrences-herptiles": lambda v: v > 0,
    "occurrences-vascular-plants": lambda v: v > 0,
    "habitat-cores": lambda v: v > 0,
}
# Kinds, not amounts: scored against by what falls in each kind.
KINDS = {"landcover-2022", "bec-zones"}
# Codes that are not data (wildfire's negative codes, land cover's 0).
VALID = {"wildfire-hazards-current": (1, 10), "landcover-2022": (1, 18)}
ALIKE = [
    {"habitat-black-bear-fall", "habitat-black-bear-summer"},
    {"habitat-black-tailed-deer-a", "habitat-black-tailed-deer-b"},
    {"protected-areas-iucn", "protected-areas-cpcad"},
]


def source(e, work, tmp):
    s = e["source"]
    if "felt" in s:
        return os.path.join(work, "felt", f"{s['felt']}.tif")
    if "vector" in s:
        return os.path.join(work, "vector", f"{s['vector']}.tif")
    # This site's own: read back from its tiles, any drawn pixel.
    return tiles_alpha(f"public/tiles/{e.get('dir', 'layers')}/{e['id']}.pmtiles", tmp, e["id"])


def tiles_alpha(pm, tmp, name, z=10):
    """A PMTiles raster's alpha over the study area, as a PNG with a world
    file (GDAL reads raster PMTiles no more than any other tile set)."""
    import io
    from PIL import Image

    w, s, e, n = BBOX
    fx = lambda lng: int((lng + 180) / 360 * 2**z)
    fy = lambda lat: int((1 - np.arcsinh(np.tan(np.radians(lat))) / np.pi) / 2 * 2**z)
    x0, x1, y0, y1 = fx(w), fx(e), fy(n), fy(s)
    out = np.zeros(((y1 - y0 + 1) * 256, (x1 - x0 + 1) * 256), np.uint8)
    for x in range(x0, x1 + 1):
        for y in range(y0, y1 + 1):
            data = subprocess.run(["pmtiles", "tile", pm, str(z), str(x), str(y)], capture_output=True).stdout
            if data[:4] == b"\x89PNG" or data[:4] == b"RIFF":
                a = np.array(Image.open(io.BytesIO(data)).convert("RGBA"))[:, :, 3]
                out[(y - y0) * 256:(y - y0 + 1) * 256, (x - x0) * 256:(x - x0 + 1) * 256] = a
    png = os.path.join(tmp, f"{name}-alpha.png")
    Image.fromarray(out).save(png)
    world = 2 * np.pi * 6378137
    px = world / 2**z / 256
    with open(png[:-4] + ".pgw", "w") as f:
        f.write(f"{px}\n0\n0\n{-px}\n{x0 * 256 * px - world / 2 + px / 2}\n{world / 2 - y0 * 256 * px - px / 2}\n")
    return png


def grid(path, tmp, name, kinds, cache):
    """A file on the common grid, as a float array with NaN for no data."""
    kept = os.path.join(cache, f"{name}.npy")
    if os.path.exists(kept) and os.path.getmtime(kept) > os.path.getmtime(path):
        return np.load(kept)
    out = os.path.join(tmp, f"{name}.bin")
    w, s, e, n = BBOX
    subprocess.run(
        ["gdalwarp", "-q", "-overwrite", *(["-s_srs", "EPSG:3857"] if path.endswith(".png") else []), "-t_srs", "EPSG:3857", "-te_srs", "EPSG:4326", "-te", str(w), str(s), str(e), str(n),
         "-tr", str(RES), str(RES), "-r", "mode" if kinds else "near", "-ot", "Float32", "-dstnodata", "nan", "-of", "ENVI", path, out],
        check=True,
    )
    hdr = open(out[:-4] + ".hdr").read()
    cols = int(re.search(r"samples\s*=\s*(\d+)", hdr).group(1))
    rows = int(re.search(r"lines\s*=\s*(\d+)", hdr).group(1))
    v = np.fromfile(out, dtype=np.float32).reshape(rows, cols)
    os.makedirs(cache, exist_ok=True)
    np.save(kept, v)
    return v


def top_two(layer_id):
    """The lowest value of a colour file's second-highest drawn class."""
    runs = []
    for line in open(os.path.join(STYLES, f"{layer_id}.txt")):
        p = line.split()
        if not p or p[0].startswith("#") or p[0] == "nv" or int(p[4]) == 0:
            continue
        colour = tuple(p[1:4])
        if not runs or runs[-1][1] != colour:
            runs.append((float(p[0]), colour))
    return runs[-2][0] if len(runs) >= 2 else runs[-1][0]


def phi(a, b, both):
    a, b = a[both], b[both]
    n = a.size
    n11 = np.count_nonzero(a & b)
    n1_, n_1 = np.count_nonzero(a), np.count_nonzero(b)
    d = np.sqrt(float(n1_) * (n - n1_) * n_1 * (n - n_1))
    return 0.0 if d == 0 else (n * n11 - n1_ * n_1) / d


def cramers_v(x, y, both):
    """How strongly two sets of codes follow each other, 0 to 1."""
    x, y = x[both], y[both]
    xs, xi = np.unique(x, return_inverse=True)
    ys, yi = np.unique(y, return_inverse=True)
    if len(xs) < 2 or len(ys) < 2:
        return 0.0
    table = np.zeros((len(xs), len(ys)))
    np.add.at(table, (xi, yi), 1)
    expect = table.sum(1, keepdims=True) * table.sum(0, keepdims=True) / table.sum()
    chi2 = ((table - expect) ** 2 / np.where(expect > 0, expect, 1)).sum()
    return float(np.sqrt(chi2 / (table.sum() * (min(table.shape) - 1))))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--work", default=os.path.expanduser("~/.cache/ecoscapes-dst"))
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()

    conn = json.load(open(CONNECTIONS))
    role_of = {i: r for r, v in conn["roles"].items() for i in v["layers"]}
    catalogue = {e["id"]: e for e in json.load(open(CATALOGUE))}

    values, where = {}, {}
    with tempfile.TemporaryDirectory() as tmp:
        for i in role_of:
            v = grid(source(catalogue[i], a.work, tmp), tmp, i, i in KINDS, os.path.join(a.work, "connections"))
            lo, hi = VALID.get(i, (-np.inf, np.inf))
            v[(v < lo) | (v > hi)] = np.nan
            values[i] = v
            if i not in KINDS:
                where[i] = RULES[i](v) if i in RULES else v >= top_two(i)
    # A vector layer is burned with 0 where it has nothing, but a protected
    # area or a record is absent there, not missing: those cover everything.
    covered = {i: ~np.isnan(v) for i, v in values.items()}
    for i in RULES:
        if i in covered and catalogue[i]["source"].keys() & {"vector", "polygons"}:
            covered[i] = np.ones_like(covered[i])
            values[i] = np.nan_to_num(values[i])

    def score(f, o):
        both = covered[f] & covered[o]
        if f in KINDS or o in KINDS:
            x = values[f] if f in KINDS else where[f]
            y = values[o] if o in KINDS else where[o]
            return cramers_v(x, y, both)
        return phi(where[f], where[o], both)

    scm = json.load(open(SCM)) if os.path.exists(SCM) else {}
    keep = set(conn.get("keep", []))
    links = {}
    for f in role_of:
        if f in keep:
            links[f] = conn["links"][f]
            continue
        links[f] = {}
        print(f"\n{f}")
        for r in conn["roles"]:
            ranked = sorted(
                ((score(f, o), o) for o in conn["roles"][r]["layers"]
                 if o != f),
                reverse=True,
            )
            # Not the focus's own variant, and one of a pair in a third.
            twin = lambda o, others: any(o in t and (f in t or t & set(others)) for t in ALIKE)
            mine = []
            for o in scm.get(f, []):
                if role_of.get(o) == r and not twin(o, mine) and len(mine) < PER:
                    mine.append(o)
            chosen = [(None, o) for o in mine]
            kinds = sum(o in KINDS for o in mine)
            for sc, o in ranked:
                if o in mine or twin(o, [c for _, c in chosen]):
                    continue
                if sc < LEAST or len(chosen) == PER:
                    break
                if o in KINDS:
                    if kinds:
                        continue
                    kinds += 1
                chosen.append((sc, o))
            links[f][r] = [o for _, o in chosen]
            print(f"  {r:<11}" + "  ".join(f"{conn['names'].get(o, o)} " + ("M" if sc is None else f"{sc:.2f}") for sc, o in chosen))

    if a.dry_run:
        return
    conn["links"] = links
    text = json.dumps(conn, indent=2)
    # Short lists on one line, as the file is written by hand.
    text = re.sub(r"\[\n\s+([^\[\]{}]*?)\n\s+\]", lambda m: "[" + re.sub(r",\s*\n\s*", ", ", m.group(1)) + "]", text)
    open(CONNECTIONS, "w").write(text + "\n")
    print(f"\nwrote {len(links)} layers' links to {CONNECTIONS}")


if __name__ == "__main__":
    main()
