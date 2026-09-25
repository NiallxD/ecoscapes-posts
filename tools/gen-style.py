#!/usr/bin/env python3
"""
Generate a gdaldem color-relief colour file (tools/styles/ecoscapes/<id>.txt)
from a Felt layer's style JSON, plus a small legend/kind summary used to
build src/data/ecoscapes-layers.json.

Usage: tools/gen-style.py --id <dataset_id> --layers felt_layers_full.json \
  --out tools/styles/ecoscapes/<id>.txt [--min-max <lo> <hi>]

Format matches tools/styles/connectivity-linkages.txt: `nv R G B A` maps the
raster's own NoData value transparent, and classed layers get flat steps (the
same colour repeated at both ends of a sub-range) so gdaldem never blends
across a class boundary. Continuous layers instead get true gradient stops.

Prints one JSON line describing the legend Felt actually used (kind, ordered
[{colour,label}] with transparent classes omitted) for the JSON generator to
reuse verbatim.
"""
import argparse, json, re, subprocess, sys, tempfile, os

# Felt's built-in "@veg" palette, pulled from assets.felt.com/js/karta-*.js
# (grep 'veg:\["' on the bundle) -- a 9-stop tan-to-dark-green ramp. Not
# documented anywhere in the layer JSON itself.
VEG_PALETTE = ["#ece0d7", "#d6c8b0", "#bbb287", "#9e9d5f", "#828836",
               "#66731b", "#4c5e12", "#334a09", "#1b3600"]

def parse_color(c):
    c = c.strip()
    if c.startswith("#"):
        c = c.lstrip("#")
        if len(c) == 3:
            c = "".join(ch * 2 for ch in c)
        r, g, b = int(c[0:2], 16), int(c[2:4], 16), int(c[4:6], 16)
        return r, g, b, 255
    m = re.match(r"rgba?\(([^)]+)\)", c)
    if m:
        parts = [p.strip() for p in m.group(1).split(",")]
        r, g, b = int(float(parts[0])), int(float(parts[1])), int(float(parts[2]))
        a = int(float(parts[3]) * 255) if len(parts) > 3 else 255
        return r, g, b, a
    m = re.match(r"hsl\(([^)]+)\)", c)
    if m:
        parts = [p.strip() for p in m.group(1).split(",")]
        h = float(parts[0]) / 360.0
        s = float(parts[1].rstrip("%")) / 100.0
        l = float(parts[2].rstrip("%")) / 100.0
        import colorsys
        r, g, b = colorsys.hls_to_rgb(h, l, s)
        return int(r * 255), int(g * 255), int(b * 255), 255
    raise ValueError(f"unrecognised colour: {c}")

def to_hex(rgba):
    return "#%02x%02x%02x" % rgba[:3]

def interpolate_palette(stops, n):
    """Resample a list of hex colours to exactly n evenly spaced colours by
    linear RGB interpolation across the original stops (used for @veg with a
    class count that doesn't match its 9 native stops)."""
    if n == len(stops):
        return list(stops)
    src = [parse_color(s) for s in stops]
    out = []
    for i in range(n):
        t = i / (n - 1) * (len(src) - 1) if n > 1 else 0
        lo = int(t)
        hi = min(lo + 1, len(src) - 1)
        f = t - lo
        rgba = tuple(round(src[lo][k] + (src[hi][k] - src[lo][k]) * f) for k in range(4))
        out.append(to_hex(rgba))
    return out

def jenks_breaks(stats, count):
    jb = (stats.get("jenks_natural_breaks") or {}).get(str(count))
    if not jb:
        raise KeyError(str(count))
    breaks = [row[0] for row in jb[:-1]]
    breaks.append(stats["maximum"])
    return breaks

def discrete_breaks_from_tif(tif_path, count):
    """Fallback when Felt didn't precompute Jenks for this class count (its
    stats.jenks_natural_breaks dict is empty/missing the key -- true for the
    *-change-40yr layers, which turn out to hold exactly {-1, 0, 1}, not a
    real continuum). Downsamples the fetched value GeoTIFF, reads its
    distinct values, and if there are at most `count` distinct values uses
    them directly as class centres (the Jenks-optimal partition when classes
    <= distinct values is exact-match per class, so no library needed).
    Otherwise falls back to a simple 1D Jenks (Fisher-Jenks via dynamic
    programming) over the sampled values."""
    with tempfile.TemporaryDirectory() as td:
        small = os.path.join(td, "small.tif")
        subprocess.run(["gdal_translate", "-q", "-outsize", "8%", "8%", "-r", "near",
                         tif_path, small], check=True)
        txt = os.path.join(td, "small.asc")
        subprocess.run(["gdal_translate", "-q", "-of", "AAIGrid", small, txt], check=True)
        vals = []
        # The header is usually 6 lines (ncols, nrows, xllcorner, yllcorner,
        # cellsize, NODATA_value), but GDAL writes dx/dy instead of a single
        # cellsize when the downsample leaves non-square pixels -- one line
        # longer -- so the header is skipped by its own keywords rather than
        # a fixed count.
        HEADER_KEYS = {"ncols", "nrows", "xllcorner", "yllcorner", "xllcenter",
                       "yllcenter", "cellsize", "dx", "dy", "nodata_value"}
        with open(txt) as f:
            for line in f:
                first = line.split(None, 1)[0].lower() if line.strip() else ""
                if first in HEADER_KEYS:
                    continue
                vals.extend(float(x) for x in line.split())
    import numpy as np
    a = np.array(vals)
    a = a[a != -9999]
    uniq = np.unique(np.round(a, 6))
    if len(uniq) <= count:
        # exact-match classes: emit as (value, value) "ranges" of width ~0
        return sorted(uniq.tolist()), True
    # simple Fisher-Jenks (exact, O(n^2*k)) over a value histogram to keep it fast
    vals_sorted = np.sort(a)
    # bin into at most 2000 points for speed, weighted
    if len(vals_sorted) > 2000:
        idx = np.linspace(0, len(vals_sorted) - 1, 2000).astype(int)
        vals_sorted = vals_sorted[idx]
    n = len(vals_sorted)
    k = count
    mat1 = [[0] * (k + 1) for _ in range(n + 1)]
    mat2 = [[float("inf")] * (k + 1) for _ in range(n + 1)]
    for i in range(1, k + 1):
        mat1[1][i] = 1
        mat2[1][i] = 0
        for j in range(2, n + 1):
            mat2[j][i] = float("inf")
    v = 0.0
    for l in range(2, n + 1):
        s1 = s2 = w = 0.0
        for m in range(1, l + 1):
            i3 = l - m + 1
            val = vals_sorted[i3 - 1]
            s2 += val * val
            s1 += val
            w += 1
            v = s2 - (s1 * s1) / w
            i4 = i3 - 1
            if i4 != 0:
                for j in range(2, k + 1):
                    if mat2[l][j] >= (v + mat2[i4][j - 1]):
                        mat1[l][j] = i3
                        mat2[l][j] = v + mat2[i4][j - 1]
        mat1[l][1] = 1
        mat2[l][1] = v
    kclass = [0] * (k + 1)
    kclass[k] = vals_sorted[-1]
    kclass[0] = vals_sorted[0]
    kk = n
    for j in range(k, 1, -1):
        idx = int(mat1[kk][j]) - 2
        kclass[j - 1] = vals_sorted[idx]
        kk = int(mat1[kk][j]) - 1
    breaks = sorted(set([vals_sorted[0]] + kclass[1:]))
    return breaks, False

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--id", required=True)
    ap.add_argument("--layers", default="felt_layers_full.json")
    ap.add_argument("--out", required=True)
    ap.add_argument("--tif", default=None, help="fetched value GeoTIFF, used only as a "
                     "fallback to compute Jenks breaks when Felt's own stats lack them")
    args = ap.parse_args()

    layers = json.load(open(args.layers))
    L = layers[args.id]
    style = L["style"] or {}
    cfg = style.get("config", {})
    paint = style.get("paint", {})
    stype = style.get("type")
    colors_raw = paint.get("color")
    opacity = paint.get("opacity", 1)
    legend_names = (style.get("legend") or {}).get("displayName")
    stats = L.get("stats") or {}
    veg_note = None

    lines = ["# Auto-generated from Felt style. See tools/gen-style.py.",
             "# value  R   G   B   A",
             "nv       0   0   0   0"]
    legend_out = []
    kind = None

    def label_for(idx_or_value, fallback):
        if legend_names == "auto" or not isinstance(legend_names, dict):
            return fallback
        return legend_names.get(str(idx_or_value), fallback)

    if stype == "categorical":
        kind = "categories"
        categories = cfg.get("categories", [])
        colors = colors_raw if isinstance(colors_raw, list) else interpolate_palette(VEG_PALETTE, len(categories))
        # gdaldem color-relief needs strictly increasing x-values across the
        # whole file; Felt's categories array isn't necessarily sorted
        # (e.g. Conservation Priorities lists 5,4,3,2,1), so sort by value.
        pairs = sorted(zip(categories, colors), key=lambda p: p[0])
        for val, col in pairs:
            r, g, b, a = parse_color(col)
            lbl = label_for(val, str(val))
            alpha = 0 if a == 0 else 255
            lines.append(f"{val}       {r} {g} {b} {alpha}")
            lines.append(f"{val + 1e-6:.6f} {r} {g} {b} {alpha}")
            if a != 0:
                legend_out.append({"colour": to_hex((r, g, b)), "label": lbl})
        # legend order should follow Felt's own array order (lowest class
        # first per the task brief), not the sorted value order.
        legend_out = []
        for val, col in zip(categories, colors):
            r, g, b, a = parse_color(col)
            if a == 0:
                continue
            legend_out.append({"colour": to_hex((r, g, b)), "label": label_for(val, str(val))})

    else:  # numeric
        steps = cfg.get("steps")
        if isinstance(colors_raw, list):
            colors = colors_raw
        elif colors_raw == "@veg":
            n = steps.get("count") if isinstance(steps, dict) else None
            colors = interpolate_palette(VEG_PALETTE, n or len(VEG_PALETTE))
            veg_note = f"@veg resolved from Felt's karta JS bundle (9-stop tan->dark-green), resampled to {n} classes"
        else:
            colors = [colors_raw]

        if isinstance(steps, list):
            kind = "classes"
            breaks = steps
        elif isinstance(steps, dict) and steps.get("type") == "jenks":
            kind = "classes"
            try:
                breaks = jenks_breaks(stats, steps["count"])
            except KeyError:
                if not args.tif:
                    raise SystemExit(
                        f"jenks breaks for count={steps['count']} missing from Felt stats "
                        f"and no --tif given to compute them from decoded values")
                discrete, exact = discrete_breaks_from_tif(args.tif, steps["count"])
                if exact:
                    # exact-match classes (few distinct values, e.g. a -1/0/1
                    # change layer): synthesize tight [v, v] ranges.
                    kind = "classes"
                    eps = 1e-4
                    breaks = []
                    for v in discrete:
                        breaks.append(v - eps)
                    breaks.append(discrete[-1] + eps)
                    breaks = sorted(set(breaks))
                    if len(breaks) != len(discrete) + 1:
                        breaks = [discrete[0] - eps] + [v + eps for v in discrete]
                    veg_note = (veg_note or "") + (
                        f" Jenks breaks computed locally: Felt's stats had no "
                        f"jenks_natural_breaks[{steps['count']}] for this layer; sampled the "
                        f"fetched raster and found only {len(discrete)} distinct values "
                        f"{discrete}, used as exact classes.")
                else:
                    breaks = discrete
                    veg_note = (veg_note or "") + (
                        f" Jenks breaks computed locally (Fisher-Jenks over sampled decoded "
                        f"values) because Felt's stats had no jenks_natural_breaks"
                        f"[{steps['count']}] for this layer.")
        elif isinstance(steps, dict) and steps.get("type") == "continuous":
            kind = "continuous"
            breaks = None
        else:
            kind = "classes"
            mn, mx = stats.get("minimum", 0), stats.get("maximum", 1)
            breaks = [mn + (mx - mn) * i / len(colors) for i in range(len(colors) + 1)]

        no_data_vals = set(cfg.get("noData") or [])
        for v in sorted(no_data_vals):
            lines.append(f"{v}       0 0 0 0")
            lines.append(f"{v + 1e-6:.6f} 0 0 0 0")

        if kind == "continuous":
            mn, mx = stats.get("minimum", 0), stats.get("maximum", 1)
            n = len(colors)
            for i, col in enumerate(colors):
                v = mn + (mx - mn) * i / (n - 1) if n > 1 else mn
                r, g, b, a = parse_color(col)
                lines.append(f"{v:.6g}       {r} {g} {b} {a}")
                lbl = label_for(i, f"{v:.2g}")
                legend_out.append({"colour": to_hex((r, g, b)), "label": lbl})
        else:
            # Flat steps: each class spans (breaks[i], breaks[i+1]] with one
            # colour at both ends. Consecutive classes share a boundary
            # value, so -- as in tools/styles/connectivity-linkages.txt --
            # the start of every class after the first is nudged up by a
            # tiny epsilon (and the very top nudged past the max) so
            # gdaldem color-relief sees strictly increasing breakpoints
            # instead of a duplicate x-value with two different colours.
            n = len(breaks) - 1
            span = (breaks[-1] - breaks[0]) or 1
            eps = span * 1e-5
            for i in range(n):
                lo, hi = breaks[i], breaks[i + 1]
                lo_e = lo + (eps if i > 0 else 0)
                hi_e = hi + (eps * 10 if i == n - 1 else 0)
                col = colors[i] if i < len(colors) else colors[-1]
                r, g, b, a = parse_color(col)
                lbl = label_for(i, f"{lo:.3g}-{hi:.3g}")
                alpha = 0 if a == 0 else 255
                lines.append(f"{lo_e:.6g}       {r} {g} {b} {alpha}")
                lines.append(f"{hi_e:.6g}       {r} {g} {b} {alpha}")
                if a != 0:
                    legend_out.append({"colour": to_hex((r, g, b)), "label": lbl})

    open(args.out, "w").write("\n".join(lines) + "\n")
    print(json.dumps({
        "id": args.id, "kind": kind, "opacity": opacity,
        "legend": legend_out, "veg_note": veg_note, "out": args.out,
    }))

if __name__ == "__main__":
    main()
