const root = import.meta.env.BASE_URL.replace(/\/$/, '');

/** Prefix a site-absolute path with the configured base, so the same content
 *  works at the domain root and under a GitHub Pages project path. */
export const asset = (p: string) => `${root}/${p.replace(/^\//, '')}`;

type SeriesData = {
  dir?: string;
  ext: string;
  years?: number[];
  video?: { src: string; poster?: string };
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
    hero?: { src: string };
    pano: { src: string; card?: string };
    series: SeriesData;
    wall?: WallData;
  };
}) => {
  const { hero, pano, series, wall } = loc.data;
  const urls = [asset(pano.src)];
  if (hero) urls.push(asset(hero.src));
  if (pano.card) urls.push(asset(pano.card));
  if (series.video) {
    urls.push(asset(series.video.src));
    if (series.video.poster) urls.push(asset(series.video.poster));
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
