# posts/ -- the field post pages, `/p/<slug>/`

| Where | What |
| --- | --- |
| `content/<slug>.md` | One post in the landscape: its panorama, views, markers, series and closing panel. One file per post; the fields are described in `src/content.config.ts`. |
| `PostPage.astro` | The page. |
| `components/` | Its panels: `Panorama`, `TimeSeries`, `Capture`, `Closing`, `Animal`, and the small pieces they use. |
| `tools/` | Getting media ready (below). |

Media for a post goes in `public/media/<slug>/`.

## tools/

- `prepare-pano.sh <source.jpg> <slug>`: a 360 panorama shrunk for the web, and its index card.
- `encode-walkthrough.sh <export> <slug> <name>`: a series walkthrough video, in the two formats the page offers, and its poster.
- `make-story-wall.py <src> <out>`: repeat photographs for the closing wall, each named by the date it was taken.
- `capture-terradapt.mjs` then `stitch-series.mjs`: TerrAdapt screenshots, one a year, joined into a time-series clip.
- `hero.mjs`, `hero-integration.mjs`: the opening still, rendered from the panorama by the site build. Nothing to run (`npm run hero` forces it).
