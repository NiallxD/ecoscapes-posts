import type { Op } from './model';

/** A Data Sandbox model as it travels in a link: the address's #z= (deflated
 *  JSON) or #m= (plain). The Sandbox writes and reads it (DstPage.astro), and
 *  the Cycle writes one for each target's map, so "Test it in the Sandbox"
 *  opens the same model. Short keys: every character is in the link, and in
 *  the QR code made from it. */
export type Saved = {
  v: 1;
  /** One score or two. */
  m: 'one' | 'two';
  o: Op;
  /** The two scores' names, across then up. */
  a: [string, string];
  /** Where each score breaks into low / middle / high. */
  b: [[number, number], [number, number]];
  /** The cut-off, a percentage. */
  c: number;
  /** Each layer: id, weight, bad, good, axis, and a categorical layer's
   *  score for each class. */
  i: [string, number, number, number, 0 | 1, Record<number, number>?][];
  /** A drawn area, when there is one. */
  d?: [number, number][];
  /** How steady is showing. */
  s?: 1;
  /** A flyover's views: lng, lat, zoom, turn, tilt, ground height, and
   *  the callout's title and text. */
  f?: [number, number, number, number, number, number?, string?, string?][];
  /** The two-score key's nine colours, when not the Sandbox's own: row-major
   *  from low/low, row = the second score (up), column = the first. */
  p?: string[];
};

const toB64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64 = (b64: string) => Uint8Array.from(atob(b64.replace(/-/g, '+').replace(/_/g, '/')), (ch) => ch.charCodeAt(0));
const through = async (bytes: Uint8Array, stream: CompressionStream | DecompressionStream) =>
  new Uint8Array(await new Response(new Blob([bytes as BlobPart]).stream().pipeThrough(stream)).arrayBuffer());

/** The model as the part of the address after the #: deflated (z=) where the
 *  browser can, which makes a link with a flyover about a third as long --
 *  and its QR code coarser, so it prints sharper. Plain (m=) otherwise, and
 *  still read. */
export async function encodeSaved(saved: Saved) {
  const json = new TextEncoder().encode(JSON.stringify(saved));
  if (typeof CompressionStream !== 'undefined') {
    try {
      return `z=${toB64(await through(json, new CompressionStream('deflate-raw')))}`;
    } catch {}
  }
  return `m=${toB64(json)}`;
}

/** The model in an address's hash, or null if there is none or it cannot be
 *  read. Only unpacked here: a link is anyone's to write, so what is in it is
 *  checked by whoever uses it. */
export async function decodeSaved(hash: string): Promise<Saved | null> {
  const m = hash.match(/^#([mz])=([A-Za-z0-9_-]+)/);
  if (!m) return null;
  try {
    let bytes = fromB64(m[2]);
    if (m[1] === 'z') bytes = await through(bytes, new DecompressionStream('deflate-raw'));
    const saved = JSON.parse(new TextDecoder().decode(bytes)) as Saved;
    return saved?.v === 1 && Array.isArray(saved.i) ? saved : null;
  } catch {
    return null;
  }
}

/** Nine colours, each a #rrggbb: a two-score key from a link, fit to use. */
export const isKey = (p: unknown): p is string[] =>
  Array.isArray(p) && p.length === 9 && p.every((c) => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c));
