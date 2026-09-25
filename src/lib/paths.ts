const root = import.meta.env.BASE_URL.replace(/\/$/, '');

/** Prefix a site-absolute path with the configured base, so the same content
 *  works at the domain root and under a GitHub Pages project path. */
export const asset = (p: string) => `${root}/${p.replace(/^\//, '')}`;

const tilesBase = (import.meta.env.PUBLIC_TILES_BASE ?? '').replace(/\/$/, '');

/** A map file (a /tiles/... .pmtiles, or a Data Sandbox layer's .sample.webp): from the tile host when
 *  PUBLIC_TILES_BASE is set -- the R2 bucket, at the same path less /tiles
 *  (tools/upload-tiles.sh) -- or from public/tiles on this site when not, as
 *  in dev. Too big for GitHub Pages; the fonts stay on the site. */
export const tile = (p: string) => (tilesBase && p.startsWith('/tiles/') ? `${tilesBase}/${p.slice('/tiles/'.length)}` : asset(p));

type SeriesData = {
  dir?: string;
  ext: string;
  years?: number[];
  video?: { src: string; hevc?: string; poster?: string; base?: string; overlay?: string };
};

type WallData = { dir: string; full?: string; ext: string; dates: string[] };

/** Every tile on the closing panel's wall, oldest first -- the dates are the
 *  filenames, so sorting them as strings is sorting them chronologically. */
export const wallTiles = (wall: WallData) =>
  [...wall.dates].sort().map((date) => ({
    date,
    src: `${wall.dir}/${date}.${wall.ext}`,
    full: wall.full ? `${wall.full}/${date}.${wall.ext}` : `${wall.dir}/${date}.${wall.ext}`,
  }));

/** Every URL a location needs in order to work offline. */
export const locationAssets = (loc: {
  data: {
    pano: { src: string; card?: string };
    series: SeriesData;
    wall?: WallData;
  };
}) => {
  const { pano, series, wall } = loc.data;
  const urls = [asset(pano.src)];
  if (pano.card) urls.push(asset(pano.card));
  if (series.video) {
    // Both encodes are listed; the page drops whichever its browser will not
    // play before asking for the offline copy, so only one is ever fetched.
    urls.push(asset(series.video.src));
    if (series.video.hevc) urls.push(asset(series.video.hevc));
    if (series.video.poster) urls.push(asset(series.video.poster));
    if (series.video.base) urls.push(asset(series.video.base));
    if (series.video.overlay) urls.push(asset(series.video.overlay));
  } else if (series.dir && series.years) {
    urls.push(...series.years.map((y) => asset(`${series.dir}/${y}.${series.ext}`)));
  }
  if (wall) {
    for (const tile of wallTiles(wall)) {
      urls.push(asset(tile.src));
      if (tile.full !== tile.src) urls.push(asset(tile.full));
    }
  }
  return urls;
};
