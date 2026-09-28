#!/usr/bin/env python3
"""
Murray's links between the layers, from a copy of his sheet
(map/tools/scm/SCM-EcoScapes.xlsx -- kept out of git; the original is on the
EcoScapes shared drive, EcoScapes-content/map-portal/active/), to
map/tools/scm/scm-links.json, which map/tools/connections.py puts first in
each third of the network.

  map/tools/scm-links.py

His sheet is a tree of about a hundred items, each with an "Upstream
Connections" cell: the names of what bears on it, "; " between them. Each
cell opens with the item's own place in the tree ("Connectivity; Focal
Species; Large-Range Wildland Explorers; ...") -- that part is taken off,
and what is left are the links. His "Downstream Connections" were empty, so
the copy's Downstream column is filled in here from the Upstream ones turned
round, and a "Map layers" column added: which of the map's layers each item
is. Only the copy is written.

An item becomes map layers through NAMES below, by name (numbering, case and
bracketed codes aside). A group of animals stands for each of them. A name
with no layer (roads, wetlands, soil moisture, mountain goat) has no map to
show yet; those are listed at the end.
"""
import json, re
from collections import defaultdict

import openpyxl

SHEET = "map/tools/scm/SCM-EcoScapes.xlsx"
OUT = "map/tools/scm/scm-links.json"

BEARS = ["habitat-black-bear-fall", "habitat-black-bear-summer"]
DEER = ["habitat-black-tailed-deer-a", "habitat-black-tailed-deer-b"]
EXPLORERS = ["habitat-grizzly-bear", "habitat-wolverine", "habitat-canada-lynx", "habitat-pacific-fisher"]
MEDIUM = BEARS + ["habitat-coyote"] + DEER
SMALL = ["habitat-hoary-marmot", "habitat-douglas-squirrel", "habitat-yellow-pine-chipmunk",
         "habitat-ensatina-salamander", "habitat-northern-alligator-lizard"]
VALLEY = ["habitat-beaver", "habitat-mink", "habitat-western-toad", "habitat-pacific-tree-frog",
          "habitat-northern-red-legged-frog", "habitat-long-toed-salamander",
          "habitat-northwestern-salamander", "habitat-garter-snake"]

# His names (as key() makes them) -> the map's layers.
NAMES = {
    "land cover": ["landcover-2022"],
    "biogeoclimatic zones": ["bec-zones"],
    "forest habitats": ["bec-zones"],
    "species occurrences": ["occurrences-mammals", "occurrences-herptiles", "occurrences-vascular-plants"],
    "mammals": ["occurrences-mammals"],
    "herpetofauna": ["occurrences-herptiles"],
    "vascular plants": ["occurrences-vascular-plants"],
    "ecological communities": ["biodiversity-categories"],
    "habitat suitability": ["habitat-suitability-2022"],
    "habitat permeability": ["habitat-permeability-2022"],
    "ecosystem resilience": ["ecosystem-resilience"],
    "ecosystem services": ["ecosystem-services"],
    "climate refugia": ["climate-refugia"],
    "microrefugia": ["climate-refugia"],
    "macrorefugia": ["climate-refugia"],
    "human footprint": ["human-footprint-40yr"],
    "urbanization": ["human-footprint-40yr"],
    "built environment": ["human-footprint-40yr"],
    "built-up areas": ["human-footprint-40yr"],
    "land conversion": ["human-footprint-40yr"],
    "resource development": ["cumulative-impacts"],
    "linear infrastructure": ["cumulative-impacts"],
    "transportation network": ["cumulative-impacts"],
    "utility network": ["cumulative-impacts"],
    "wildfire": ["wildfire-hazards-current"],
    "invasive species": ["invasive-species"],
    "forest ecosystems": ["forest-change-40yr"],
    "riparian & wetland areas": ["riparian-area-change-40yr"],
    "mesic vegetation": ["mesic-vegetation-change-40yr"],
    "xeric vegetation": ["xeric-vegetation-change-40yr"],
    "composite cores": ["habitat-cores"],
    "habitat core areas": ["habitat-cores"],
    "priority linkages": ["connectivity-linkages"],
    "large-range corridors": ["connectivity-linkages"],
    "medium-range corridors": ["connectivity-linkages"],
    "small-range terrestrial corridors": ["connectivity-linkages"],
    "small-range riparian corridors": ["connectivity-linkages"],
    "cpcad protected areas & oecms": ["protected-areas-cpcad"],
    "grizzly bear": ["habitat-grizzly-bear"],
    "wolverine": ["habitat-wolverine"],
    "canada lynx": ["habitat-canada-lynx"],
    "pacific fisher": ["habitat-pacific-fisher"],
    "black bear": BEARS,
    "coyote": ["habitat-coyote"],
    "black-tailed deer": DEER,
    "hoary marmot": ["habitat-hoary-marmot"],
    "douglas squirrel": ["habitat-douglas-squirrel"],
    "yellow-pine chipmunk": ["habitat-yellow-pine-chipmunk"],
    "ensatina": ["habitat-ensatina-salamander"],
    "alligator lizard": ["habitat-northern-alligator-lizard"],
    "beaver": ["habitat-beaver"],
    "mink": ["habitat-mink"],
    "western toad": ["habitat-western-toad"],
    "pacific tree frog": ["habitat-pacific-tree-frog"],
    "red-legged frog": ["habitat-northern-red-legged-frog"],
    "long-toed salamander": ["habitat-long-toed-salamander"],
    "northwest salamander": ["habitat-northwestern-salamander"],
    "common garter snake": ["habitat-garter-snake"],
    "large-range wildland explorers": EXPLORERS,
    "medium-range montane & forest dwellers": MEDIUM,
    "small-range montane & forest dwellers": SMALL,
    "small-range riparian valley dwellers": VALLEY,
}
# An animal's own records, for its "Species Occurrences".
HERPS = set(VALLEY[2:]) | {"habitat-ensatina-salamander", "habitat-northern-alligator-lizard"}
ANIMALS = set(EXPLORERS + MEDIUM + SMALL + VALLEY)


def layers(name, of=None):
    """His name as map layers; "Species Occurrences" beside one animal is
    that animal's kind of record, not all three."""
    if name == "species occurrences" and of in ANIMALS:
        return ["occurrences-herptiles" if of in HERPS else "occurrences-mammals"]
    return NAMES.get(name, [])


# The tree's top levels, as the cells shorten them.
TOPS = {"southern coast mountains", "geography", "biodiversity", "regional biodiversity",
        "connectivity", "ecological connectivity"}


def key(name):
    """A name as it is matched: no numbering, no bracketed code, lower case."""
    name = re.sub(r"^[\d.]+\s*", "", str(name).strip())
    name = re.sub(r"\s*\([^)]*\)", "", name)
    return name.replace("'", "").replace("’", "").strip().lower()


def main():
    wb = openpyxl.load_workbook(SHEET)
    ws = wb.worksheets[0]
    head = [c.value for c in ws[1]]
    up_col = head.index("Upstream Connections") + 1
    down_col = head.index("Downstream Connections") + 1
    layers_col = head.index("Map layers") + 1 if "Map layers" in head else len(head) + 1
    ws.cell(1, layers_col, "Map layers")

    # Each item's row, name and place in the tree; then its links, the tree
    # part taken off the front.
    rows, path = [], [None] * 4
    for r in range(2, ws.max_row + 1):
        for i in range(4):
            v = ws.cell(r, i + 1).value
            if v:
                path[i] = key(v)
                path[i + 1:] = [None] * (3 - i)
        if not path[3] or not ws.cell(r, 4).value:
            continue
        cell = ws.cell(r, up_col).value or ""
        names = [key(n) for n in str(cell).split(";") if n.strip()]
        own = TOPS | set(p for p in path if p)
        while names and names[0] in own:
            names.pop(0)
        rows.append({"row": r, "name": path[3], "up": names})

    # Downstream: whatever names this item upstream.
    down = defaultdict(list)
    for it in rows:
        for n in it["up"]:
            if it["name"] not in down[n]:
                down[n].append(it["name"])
    for it in rows:
        ws.cell(it["row"], down_col, "; ".join(down[it["name"]]) or None)
        ws.cell(it["row"], layers_col, "; ".join(NAMES.get(it["name"], [])) or None)
    wb.save(SHEET)

    # Layer to layer, both ways: what bears on it first, then what it bears
    # on; a name that is one layer before a name that is a group of them.
    links = defaultdict(list)
    unmatched = defaultdict(int)
    add = lambda a, b, wide: b != a and links[a].append((wide, b))
    for it in rows:
        for n in it["up"]:
            if n not in NAMES:
                unmatched[n] += 1
        for a in NAMES.get(it["name"], []):
            for n in it["up"]:
                bs = layers(n, a)
                for b in bs:
                    add(a, b, len(bs) > 1)
    for it in rows:
        for b in NAMES.get(it["name"], []):
            for n in it["up"]:
                for a in layers(n):
                    add(a, b, len(NAMES.get(it["name"], [])) > 1 or len(layers(n)) > 1)
    out = {}
    for a, bs in sorted(links.items()):
        seen = []
        for _, b in sorted(bs, key=lambda x: x[0]):
            if b not in seen:
                seen.append(b)
        out[a] = seen
    json.dump(out, open(OUT, "w"), indent=1)
    print(f"{len(rows)} items; links for {len(links)} layers -> {OUT}; Downstream and Map layers filled in {SHEET}")
    print("\nHis names with no map layer (times named):")
    for n, c in sorted(unmatched.items(), key=lambda x: -x[1]):
        print(f"  {c:>3}  {n}")


if __name__ == "__main__":
    main()
