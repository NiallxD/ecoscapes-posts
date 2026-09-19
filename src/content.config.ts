import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

// One markdown file per physical post. Adding a location is adding a file here
// plus its media folder -- no database, no admin UI required.
const locations = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/locations' }),
  schema: z.object({
    title: z.string(),
    place: z.string(),
    /** YAML parses a bare date into a Date, so coerce rather than fight it. */
    installed: z.coerce.date(),
    lat: z.number(),
    lng: z.number(),
    intro: z.string(),
    /** Full-bleed portrait still behind the opening panel. Render one from the
     *  panorama with tools/make-hero.py. */
    hero: z.string().optional(),
    pano: z.object({
      src: z.string(),
      /** Wide crop for the index card; falls back to the sphere itself. */
      card: z.string().optional(),
      caption: z.string(),
      /** Compass bearing the centre of the panorama faces, for gyro alignment. */
      northOffset: z.number().default(0),
    }),
    // A time series arrives either as a pre-exported video or as one image per
    // year. Exactly one of the two must be present.
    series: z
      .object({
        caption: z.string(),
        source: z.string(),
        /** Image-sequence form. */
        dir: z.string().optional(),
        ext: z.string().default('webp'),
        years: z.array(z.number()).min(2).optional(),
        /** Timestamped callouts pinned to a point in the frame. Each opens on
         *  its year and holds for a set number of seconds, so the sequence can
         *  point at what it wants you to notice. */
        callouts: z
          .array(
            z.object({
              year: z.number(),
              /** Position within the video frame, 0-1 from the top left.
               *  Open the page with ?pin and click the frame to read these off. */
              x: z.number().min(0).max(1),
              y: z.number().min(0).max(1),
              title: z.string(),
              body: z.string().optional(),
              /** Seconds to stay on screen, in playback time -- so it is
               *  reading time, and does not move if the clip is re-encoded at a
               *  different frame rate. */
              hold: z.number().default(3),
            }),
          )
          .default([]),
        /** Video form. `from`/`to` map clip position onto the year readout. */
        video: z
          .object({
            src: z.string(),
            poster: z.string().optional(),
            from: z.number(),
            to: z.number(),
            /** True when the export already burns in its own year and legend,
             *  as TerrAdapt's do -- the page then draws no year of its own. */
            burnedIn: z.boolean().default(false),
          })
          .optional(),
      })
      .refine((s) => Boolean(s.video) !== Boolean(s.dir && s.years), {
        message: 'series needs either `video`, or both `dir` and `years` — not both, not neither',
      }),
    capture: z.object({
      prompt: z.string(),
      shareTo: z.string(),
    }),
    /** Repeat photographs from this same post, drifting behind the closing
     *  panel. Prepared by tools/make-story-wall.py, which names every file for
     *  the day it was taken -- so the dates below are the filenames, and the
     *  page has its captions without a second list to keep in step. */
    wall: z
      .object({
        dir: z.string(),
        /** Larger copies of the same dates, for the full-screen gallery. Same
         *  tool, a wider --width. */
        full: z.string().optional(),
        ext: z.string().default('webp'),
        /** ISO dates, kept as strings: these are filenames, and a Date here
         *  would drag timezones into what is really a label. */
        dates: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).min(3),
      })
      .optional(),
  }),
});

export const collections = { locations };
