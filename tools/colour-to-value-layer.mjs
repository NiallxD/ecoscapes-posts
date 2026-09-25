#!/usr/bin/env node
/**
 * A classed /map/ layer's colour tiles, read back into class values for the
 * decision-support page (/ecoscapes-dst/) -- for the layers whose values we
 * only have as Felt's rendering (the species habitats, linkages, priorities).
 *
 *   node tools/colour-to-value-layer.mjs <id> [<id> ...]
 *
 * <id> is a layer in src/data/ecoscapes-layers.json. Writes
 * public/tiles/dst/<id>.pmtiles and prints one JSON line per layer for
 * src/data/dst-layers.json.
 *
 * This works because tools/prepare-layer.sh keeps every pixel exactly one of
 * the legend's colours (nearest resampling, mode overviews, lossless WebP):
 * the n-th legend colour is class n. The odd pixel that is not -- opaque black
 * or a near-miss along a no-data edge -- goes to the nearest legend colour if
 * it is close, and to no data if not. Output is the same one-byte encoding as
 * tools/prepare-value-layer.py, with lo = 1 and hi = the class count, so a
 * class comes back as its own number.
 *
 * Only for ordered classes. A layer that repeats a colour across classes
 * (landcover) cannot be read back this way.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { PMTiles } from 'pmtiles';
import sharp from 'sharp';

const TILE = 256;
const OUT = 'public/tiles/dst';
const layers = JSON.parse(fs.readFileSync('src/data/ecoscapes-layers.json', 'utf8'));

class FileSource {
  constructor(p) {
    this.p = p;
    this.fd = fs.openSync(p, 'r');
  }
  getKey() {
    return this.p;
  }
  async getBytes(offset, length) {
    const b = Buffer.alloc(length);
    fs.readSync(this.fd, b, 0, length, offset);
    return { data: b.buffer.slice(b.byteOffset, b.byteOffset + length) };
  }
}

const hexRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const tileX = (lon, z) => Math.floor(((lon + 180) / 360) * 2 ** z);
const tileY = (lat, z) => {
  const r = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z);
};

async function convert(id) {
  const layer = layers.find((l) => l.id === id);
  if (!layer) throw new Error(`${id}: not in ecoscapes-layers.json`);
  const legend = layer.legend.map((k) => hexRgb(k.colour.toLowerCase()));
  if (new Set(layer.legend.map((k) => k.colour.toLowerCase())).size !== legend.length)
    throw new Error(`${id}: legend repeats a colour, so its classes cannot be told apart`);
  const n = legend.length;
  // Class k (1-based) as the byte prepare-value-layer.py would write for it.
  const byteOf = (k) => (n === 1 ? 1 : 1 + Math.round(((k - 1) / (n - 1)) * 254));

  const cache = new Map();
  const classOf = (r, g, b) => {
    const key = (r << 16) | (g << 8) | b;
    let k = cache.get(key);
    if (k !== undefined) return k;
    let best = 0, bestD = Infinity;
    legend.forEach(([R, G, B], i) => {
      const d = (R - r) ** 2 + (G - g) ** 2 + (B - b) ** 2;
      if (d < bestD) (bestD = d), (best = i + 1);
    });
    // Close enough to be that class drawn along an edge; otherwise no data.
    k = bestD <= 60 ** 2 ? best : 0;
    cache.set(key, k);
    return k;
  };

  const pm = new PMTiles(new FileSource(path.join('public', layer.src)));
  const h = await pm.getHeader();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'c2v-'));
  const mb = path.join(tmp, 'v.mbtiles');
  const db = new DatabaseSync(mb);
  db.exec('create table metadata (name text, value text); create table tiles (zoom_level int, tile_column int, tile_row int, tile_data blob)');
  const meta = {
    name: id, format: 'webp', type: 'overlay', minzoom: h.minZoom, maxzoom: h.maxZoom,
    bounds: `${h.minLon},${h.minLat},${h.maxLon},${h.maxLat}`,
    description: `classes 1..${n} read back from the colour tiles; byte 0 = no data`,
  };
  const putMeta = db.prepare('insert into metadata values (?, ?)');
  for (const [k, v] of Object.entries(meta)) putMeta.run(k, String(v));
  const put = db.prepare('insert into tiles values (?, ?, ?, ?)');

  const counts = new Array(n + 1).fill(0);
  let tiles = 0;
  for (let z = h.minZoom; z <= h.maxZoom; z++) {
    for (let x = tileX(h.minLon, z); x <= tileX(h.maxLon, z); x++) {
      for (let y = tileY(h.maxLat, z); y <= tileY(h.minLat, z); y++) {
        const t = await pm.getZxy(z, x, y);
        if (!t) continue;
        const { data } = await sharp(Buffer.from(t.data)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
        const out = Buffer.alloc(TILE * TILE);
        let any = false;
        for (let i = 0; i < out.length; i++) {
          const o = i * 4;
          if (data[o + 3] < 128) continue;
          const k = classOf(data[o], data[o + 1], data[o + 2]);
          if (!k) continue;
          out[i] = byteOf(k);
          any = true;
          if (z === h.maxZoom) counts[k]++;
        }
        if (!any) continue;
        const webp = await sharp(out, { raw: { width: TILE, height: TILE, channels: 1 } }).webp({ lossless: true }).toBuffer();
        put.run(z, x, 2 ** z - 1 - y, webp);
        tiles++;
      }
    }
  }
  db.close();
  fs.mkdirSync(OUT, { recursive: true });
  const out = path.join(OUT, `${id}.pmtiles`);
  execFileSync('pmtiles', ['convert', mb, out], { stdio: 'ignore' });
  fs.rmSync(tmp, { recursive: true, force: true });

  // The page's 64-bin histogram over lo..hi, each class in its own bin.
  const hist = new Array(64).fill(0);
  for (let k = 1; k <= n; k++) hist[n === 1 ? 0 : Math.min(63, Math.floor(((k - 1) / (n - 1)) * 64))] += counts[k];
  process.stderr.write(`${id}: ${tiles} tiles, ${(fs.statSync(out).size / 1e6).toFixed(1)} MB\n`);
  console.log(JSON.stringify({
    id, lo: 1, hi: n, maxzoom: h.maxZoom, classes: layer.legend.map((k, i) => ({ value: i + 1, label: k.label })), hist,
  }));
}

for (const id of process.argv.slice(2)) await convert(id);
