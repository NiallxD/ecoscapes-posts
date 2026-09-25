#!/usr/bin/env python3
"""
Every layer of the decision-support page (/ecoscapes-dst/), from
tools/dst-catalogue.json to public/tiles/dst/ and src/data/dst-layers.json.

  tools/build-dst.py                  # build what is missing, list everything
  tools/build-dst.py --force a b      # rebuild layers a and b
  tools/build-dst.py --list-only      # just rewrite dst-layers.json

A catalogue entry names where a layer's values come from:

  "source": {"drive": "<path under the EcoScapes Drive archive>"}
  "source": {"felt": "<pipeline_dataset_id in archive/felt_layers_full.json>"}

A Drive layer is read as it is. A Felt layer's values are fetched first
(tools/fetch-felt-layer.py, cached under --work, so a rebuild never refetches);
archive/felt_layers_full.json comes from tools/felt-layers.py. Either way the
values go through tools/prepare-value-layer.py, with the entry's `classes`
and `valid` passed on.

The page's list carries, per layer, what the catalogue says about it (name,
group, which way is usually good, a line of plain description, class labels)
and what the file says (range, histogram), read back from the file itself so
a layer already built is not built again to list it.
"""
import argparse, json, os, subprocess, sys

DRIVE = os.path.expanduser(
    "~/Library/CloudStorage/GoogleDrive-nbell@naturesquamish.ca/Shared drives/"
    "EcoScapes/EcoScapes-Felt-Maps/archive/Biodiversity"
)
# The study area (src/content/ecoscapes/sea-to-sky.md `limit`).
BBOX = "-124.69,48.94,-121.43,51.26"
OUT = "public/tiles/dst"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--catalogue", default="tools/dst-catalogue.json")
    ap.add_argument("--drive", default=os.environ.get("ECOSCAPES_DRIVE", DRIVE))
    ap.add_argument("--work", default=os.path.expanduser("~/.cache/ecoscapes-dst"))
    ap.add_argument("--force", nargs="*", default=[])
    ap.add_argument("--list-only", action="store_true")
    a = ap.parse_args()

    cat = json.load(open(a.catalogue))
    listed = []
    for e in cat:
        out = os.path.join(OUT, f"{e['id']}.pmtiles")
        if not a.list_only and (e["id"] in a.force or not os.path.exists(out) or not sampled(out)):
            src = source(e, a)
            cmd = ["python3", "tools/prepare-value-layer.py", src, e["id"]]
            if e.get("classes"):
                cmd.append("--classes")
            if e.get("valid"):
                cmd += ["--valid", *map(str, e["valid"])]
            subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL)
        if not os.path.exists(out):
            print(f"  - {e['id']}: not built, left off the list", file=sys.stderr)
            continue
        meta = json.loads(subprocess.check_output(["pmtiles", "show", "--metadata", out]))
        stats = json.loads(meta["dst"])
        layer = {
            "id": e["id"],
            "name": e["name"],
            "group": e["group"],
            "src": f"/tiles/dst/{e['id']}.pmtiles",
            "lo": stats["lo"],
            "hi": stats["hi"],
            "unit": e.get("unit", ""),
            "higher": e["higher"],
            "about": e["about"],
            "hist": stats["hist"],
            # The area sample (tools/prepare-value-layer.py) and its grid.
            "sampleSrc": f"/tiles/dst/{e['id']}.sample.webp",
            "sample": stats["sample"],
        }
        if e.get("labels"):
            layer["classes"] = e["labels"]
        listed.append(layer)

    json.dump(listed, open("src/data/dst-layers.json", "w"), indent=1)
    print(f"{len(listed)} layers -> src/data/dst-layers.json", file=sys.stderr)


def sampled(out):
    """Whether a built layer has its area sample (older builds do not)."""
    meta = json.loads(subprocess.check_output(["pmtiles", "show", "--metadata", out]))
    return "sample" in json.loads(meta["dst"])


def source(e, a):
    s = e["source"]
    if "drive" in s:
        return os.path.join(a.drive, s["drive"])
    fid = s["felt"]
    tif = os.path.join(a.work, "felt", f"{fid}.tif")
    if not os.path.exists(tif):
        os.makedirs(os.path.dirname(tif), exist_ok=True)
        subprocess.run(
            ["python3", "tools/fetch-felt-layer.py", "--id", fid, "--layers", "archive/felt_layers_full.json",
             "--out", tif, "--cache", os.path.join(a.work, "felt", "cache"), f"--bbox={BBOX}"],
            check=True, stdout=subprocess.DEVNULL,
        )
    return tif


if __name__ == "__main__":
    main()
