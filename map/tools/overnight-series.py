#!/usr/bin/env python3
"""
Every TerrAdapt time series the portal links to, fetched and built in one
unattended run: leave it going overnight.

  map/tools/overnight-series.py map_config.json            # the lot
  map/tools/overnight-series.py map_config.json --list     # just show what it would fetch
  map/tools/overnight-series.py map_config.json --only landcover_class human_footprint

Reads the portal's config (each indicator's `map2_url`, the TerrAdapt dashboard
link), takes each distinct layer once, and runs fetch-terradapt-series.py on it
for every year. Then builds PMTiles with build-series.py for the layers that
have an entry there (the others stay as GeoTIFFs in the cache until they get
colours). A layer that fails is logged and skipped, and tried again at the end
(--passes). Everything is resumable: a re-run only fetches what's missing.

Each layer's output goes to <cache>/logs/<name>.log, and the summary to
<cache>/logs/summary.txt.
"""
import argparse, fcntl, importlib.util, json, os, subprocess, sys, time
from urllib.parse import parse_qs, urlparse

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
HOME_DASHBOARD = "hsbr.staging.dashboard.terradapt.org"


def series_ids():
    """build-series.py's SERIES, as TerrAdapt layer -> its id there."""
    spec = importlib.util.spec_from_file_location("build_series", os.path.join(HERE, "build-series.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return {layer: sid for sid, (layer, _) in mod.SERIES.items()}


def jobs_from(config):
    jobs, seen = [], {}
    for key, ind in config["indicators"].items():
        u = urlparse(ind.get("map2_url") or "")
        if not u.hostname or not u.hostname.endswith(".dashboard.terradapt.org"):
            continue
        q = {k: json.loads(v[0]) for k, v in parse_qs(u.query).items() if k.startswith("layer") or k == "selectedLayer"}
        if "selectedLayer" not in q:
            continue
        job = {
            "host": u.hostname,
            "layer": q["selectedLayer"],
            "theme": q.get("layerTheme", ""),
            "scope": q.get("layerScope", "monitor"),
            "start": q.get("layerStart"),
            "end": q.get("layerEnd"),
        }
        ident = (job["host"], job["layer"], job["theme"], job["scope"])
        if ident in seen:
            seen[ident]["indicators"].append(key)
            continue
        # The same layer on another dashboard gets its own folder, so they don't mix.
        sub = job["host"].split(".")[0]
        job["name"] = job["layer"] if job["host"] == HOME_DASHBOARD else f"{sub}_{job['layer']}"
        job["indicators"] = [key]
        seen[ident] = job
        jobs.append(job)
    return jobs


def run(cmd, log):
    """Runs cmd, keeping all its output in log and showing it here as it comes."""
    with open(log, "a") as f:
        f.write(f"\n$ {' '.join(cmd)}\n")
        p = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, cwd=REPO, text=True, bufsize=1)
        for line in p.stdout:
            f.write(line)
            f.flush()
            print(f"    {time.strftime('%H:%M')} {line.rstrip()}", flush=True)
        return p.wait()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("config", help="the portal's map_config.json")
    ap.add_argument("--list", action="store_true", help="show the layers and stop")
    ap.add_argument("--only", nargs="*", help="just these layer names")
    ap.add_argument("--zoom", type=int, default=12)
    ap.add_argument("--passes", type=int, default=2, help="goes at the failed layers")
    ap.add_argument("--cache", default=os.path.expanduser("~/.cache/ecoscapes-terradapt"))
    a = ap.parse_args()

    with open(a.config) as f:
        jobs = jobs_from(json.load(f))
    if a.only:
        jobs = [j for j in jobs if j["name"] in a.only or j["layer"] in a.only]
    builds = series_ids()

    for j in jobs:
        years = f"{(j['start'] or '')[:4]}-{(j['end'] or '')[:4]}"
        built = f"-> PMTiles as {builds[j['layer']]}" if j["layer"] in builds and j["host"] == HOME_DASHBOARD else "(GeoTIFFs only)"
        print(f"{j['name']:40} {j['theme']:26} {j['scope']:8} {years:10} {built}")
        print(f"{'':40} for {', '.join(j['indicators'])}")
    if a.list:
        return

    logs = os.path.join(a.cache, "logs")
    os.makedirs(logs, exist_ok=True)
    # Two runs at once fetch the same tiles and trip over each other.
    lock = open(os.path.join(logs, ".running"), "w")
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        sys.exit("already running (see: ps aux | grep overnight-series). Stop that one first, or let it finish.")
    began = time.time()
    status = {}
    todo = list(jobs)
    for p in range(a.passes):
        if not todo:
            break
        if p:
            print(f"\npass {p + 1}: trying {len(todo)} again", flush=True)
        failed = []
        for n, j in enumerate(todo, 1):
            t0 = time.time()
            print(f"\n{time.strftime('%H:%M')} [{n}/{len(todo)}] {j['name']}", flush=True)
            cmd = [sys.executable, os.path.join(HERE, "fetch-terradapt-series.py"),
                   "--layer", j["layer"], "--theme", j["theme"], "--scope", j["scope"],
                   "--api", f"https://api-{j['host']}/map/select_layer",
                   "--zoom", str(a.zoom), "--cache", a.cache, "--out", os.path.join(a.cache, j["name"])]
            if j["start"]:
                cmd += ["--start", j["start"]]
            if j["end"]:
                cmd += ["--end", j["end"]]
            rc = run(cmd, os.path.join(logs, f"{j['name']}.log"))
            mins = (time.time() - t0) / 60
            status[j["name"]] = "fetched" if rc == 0 else f"failed (see logs/{j['name']}.log)"
            print(f"{time.strftime('%H:%M')} [{n}/{len(todo)}] {j['name']} {'ok' if rc == 0 else 'FAILED'} in {mins:.0f} min", flush=True)
            if rc:
                failed.append(j)
        todo = failed

    # Built after all the fetching: human footprint takes its water from land cover.
    for sid in ("landcover", "human-footprint"):
        layer = next(l for l, s in builds.items() if s == sid)
        if status.get(layer) != "fetched":
            continue
        print(f"\n{time.strftime('%H:%M')} building {sid}", flush=True)
        rc = run([sys.executable, os.path.join(HERE, "build-series.py"), sid, "--cache", a.cache],
                 os.path.join(logs, f"build-{sid}.log"))
        status[layer] += ", PMTiles built" if rc == 0 else f", PMTiles failed (see logs/build-{sid}.log)"
        print(f"{time.strftime('%H:%M')} building {sid} {'ok' if rc == 0 else 'FAILED'}", flush=True)

    hours = (time.time() - began) / 3600
    lines = [f"{time.strftime('%Y-%m-%d %H:%M')}, {hours:.1f} h"] + [f"{n:40} {s}" for n, s in status.items()]
    with open(os.path.join(logs, "summary.txt"), "w") as f:
        f.write("\n".join(lines) + "\n")
    print("\n" + "\n".join(lines))


if __name__ == "__main__":
    main()
