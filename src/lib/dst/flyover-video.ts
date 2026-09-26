/** A flyover made into a video, frame by frame: each frame's view set up and
 *  drawn complete -- every tile in, however long that takes -- then copied
 *  and handed to the browser's video encoder, so the video plays perfectly
 *  smoothly however slowly the map drew. H.264 in an MP4, which plays (and
 *  saves) everywhere. Loaded only when a flight is made. */
import { BufferTarget, CanvasSource, Mp4OutputFormat, Output, QUALITY_HIGH, canEncodeVideo } from 'mediabunny';

export const FPS = 60;

type Options = {
  /** Seconds of flight. */
  duration: number;
  /** The map canvas's size in device pixels. */
  size: { w: number; h: number };
  /** Set the map up for `t` seconds in, wait for it to be complete, and copy
   *  it into `ctx` (w by h) in the same task as it was last drawn. */
  draw: (t: number, ctx: CanvasRenderingContext2D, w: number, h: number) => Promise<void>;
  onProgress: (done: number, total: number) => void;
  cancelled: () => boolean;
  /** A still title card first, drawn once into (ctx, w, h), held for its
   *  seconds, the last of them fading into the flight. */
  intro?: { seconds: number; draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void };
};

/** Seconds of the title card spent fading into the flight. */
const FADE = 0.7;

/** The largest even size, up to the map's own, that the encoder takes at
 *  this frame rate: H.264 runs out at about 4K. */
async function frameSize(w: number, h: number) {
  for (const most of [3840, 2560, 1920, 1280]) {
    const s = Math.min(1, most / w);
    const size = { w: Math.floor((w * s) / 2) * 2, h: Math.floor((h * s) / 2) * 2 };
    if (await canEncodeVideo('avc', { width: size.w, height: size.h, bitrate: QUALITY_HIGH })) return size;
  }
  return null;
}

/** The video, or null if stopped (or this browser cannot make one). */
export async function recordFlight(o: Options): Promise<Blob | null> {
  const size = await frameSize(o.size.w, o.size.h);
  if (!size) throw new Error('This browser cannot make videos.');
  const canvas = document.createElement('canvas');
  canvas.width = size.w;
  canvas.height = size.h;
  const ctx = canvas.getContext('2d')!;
  const target = new BufferTarget();
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target });
  const source = new CanvasSource(canvas, { codec: 'avc', bitrate: QUALITY_HIGH, keyFrameInterval: 1 });
  output.addVideoTrack(source, { frameRate: FPS });
  await output.start();
  const frames = Math.ceil(o.duration * FPS) + 1;
  // The title card, then the flight's first frame under it as it fades.
  let start = 0;
  if (o.intro) {
    const card = document.createElement('canvas');
    card.width = size.w;
    card.height = size.h;
    o.intro.draw(card.getContext('2d')!, size.w, size.h);
    const first = document.createElement('canvas');
    first.width = size.w;
    first.height = size.h;
    await o.draw(0, first.getContext('2d')!, size.w, size.h);
    const n = Math.round(o.intro.seconds * FPS);
    const fade = Math.round(FADE * FPS);
    for (let k = 0; k < n; k++) {
      if (o.cancelled()) {
        await output.cancel();
        return null;
      }
      ctx.globalAlpha = 1;
      ctx.drawImage(first, 0, 0);
      ctx.globalAlpha = Math.min(1, (n - k) / fade);
      ctx.drawImage(card, 0, 0);
      ctx.globalAlpha = 1;
      await source.add(k / FPS, 1 / FPS);
    }
    start = n / FPS;
  }
  for (let k = 0; k < frames; k++) {
    if (o.cancelled()) {
      await output.cancel();
      return null;
    }
    const t = Math.min(k / FPS, o.duration);
    await o.draw(t, ctx, size.w, size.h);
    await source.add(start + k / FPS, 1 / FPS);
    o.onProgress(k + 1, frames);
  }
  await output.finalize();
  return new Blob([target.buffer!], { type: 'video/mp4' });
}
