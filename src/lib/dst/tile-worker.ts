/// <reference lib="webworker" />
/** Fetches and decodes the Data Sandbox's value tiles, off the main thread.
 *
 *  A value tile is a 256x256 greyscale lossless WebP whose every pixel is one
 *  byte of data (tools/prepare-value-layer.py): 0 no data, 1..255 the value.
 *  Here it becomes a Uint8Array of those bytes, handed to the page to upload
 *  as a texture -- the decode, the range requests and the PMTiles directory
 *  lookups all stay out of the way of panning and dragging.
 *
 *  Decoded tiles are kept a while (the least recently used go first), so the
 *  page can also ask for the value at one pixel -- tap-to-explain -- without
 *  a second fetch. */
import { PMTiles } from 'pmtiles';

export const TILE = 256;

export type TileRequest =
  | { type: 'tile'; id: number; src: string; z: number; x: number; y: number }
  | { type: 'cancel'; ids: number[] }
  /** Fetch these files' headers and directories now, ahead of their tiles. */
  | { type: 'warm'; srcs: string[] }
  | { type: 'value'; id: number; src: string; z: number; x: number; y: number; px: number; py: number };
export type TileReply =
  | { type: 'tile'; id: number; data: Uint8Array | null }
  | { type: 'value'; id: number; byte: number };

const archives = new Map<string, PMTiles>();
const decoded = new Map<string, Promise<Uint8Array | null>>();
const cancelled = new Set<number>();
const CACHE = 256; // tiles, about 16 MB

const archive = (src: string) => {
  let a = archives.get(src);
  if (!a) archives.set(src, (a = new PMTiles(src)));
  return a;
};

async function decode(buf: ArrayBuffer): Promise<Uint8Array> {
  // Straight bytes: no colour management, no premultiplying. The tiles are
  // greyscale with no alpha, so red is the value.
  const bmp = await createImageBitmap(new Blob([buf], { type: 'image/webp' }), {
    colorSpaceConversion: 'none',
    premultiplyAlpha: 'none',
  });
  const c = new OffscreenCanvas(TILE, TILE);
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(bmp, 0, 0);
  bmp.close();
  const rgba = ctx.getImageData(0, 0, TILE, TILE).data;
  const out = new Uint8Array(TILE * TILE);
  for (let i = 0, j = 0; i < out.length; i++, j += 4) out[i] = rgba[j];
  return out;
}

function load(src: string, z: number, x: number, y: number) {
  const key = `${src}|${z}/${x}/${y}`;
  let p = decoded.get(key);
  if (p) {
    // Most recently used goes to the back.
    decoded.delete(key);
  } else {
    p = archive(src)
      .getZxy(z, x, y)
      .then((t) => (t ? decode(t.data) : null))
      .catch(() => null);
  }
  decoded.set(key, p);
  if (decoded.size > CACHE) decoded.delete(decoded.keys().next().value!);
  return p;
}

self.onmessage = async (e: MessageEvent<TileRequest>) => {
  const m = e.data;
  if (m.type === 'warm') {
    for (const src of m.srcs) archive(src).getHeader().catch(() => {});
    return;
  }
  if (m.type === 'cancel') {
    for (const id of m.ids) cancelled.add(id);
    // Ids cancelled after they were answered would linger: forget them in bulk.
    if (cancelled.size > 5000) cancelled.clear();
    return;
  }
  if (m.type === 'tile') {
    // A request the page no longer wants, dropped before it costs a fetch.
    if (cancelled.delete(m.id)) return;
    const data = await load(m.src, m.z, m.x, m.y);
    if (cancelled.delete(m.id)) return;
    // A copy goes to the page (its buffer moves with it); the cache keeps its own.
    const copy = data ? data.slice() : null;
    postMessage({ type: 'tile', id: m.id, data: copy } satisfies TileReply, copy ? [copy.buffer] : []);
    return;
  }
  const data = await load(m.src, m.z, m.x, m.y);
  postMessage({ type: 'value', id: m.id, byte: data ? data[m.py * TILE + m.px] : 0 } satisfies TileReply);
};
