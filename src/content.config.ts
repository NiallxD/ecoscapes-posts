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
    /** Full-bleed portrait still behind the opening panel, reprojected out of
     *  the panorama by tools/hero.mjs. These angles are the source of truth and
     *  the JPEG is derived from them: the build regenerates it, and so does a
     *  save in dev. It is baked rather than reprojected in the page because it
     *  is the opening background and has to paint before the sphere is
     *  downloaded. */
    hero: z
      .object({
        src: z.string(),
        /** Bearing the still faces, in the same frame as everything else here
         *  -- so the ?aim readout's value pastes straight across. The hero tool
         *  converts it back to a position in the source image using pano.north. */
        yaw: z.number().default(0),
        /** Degrees above (+) or below (-) the horizon. Matches pano.startPitch. */
        pitch: z.number().default(0),
        /** Vertical field of view: the zoom, inverted -- smaller is tighter.
         *  The viewer opens at 95; 75 reads more like a photograph. */
        vfov: z.number().gt(0).lt(180).default(75),
      })
      .optional(),
    pano: z.object({
      src: z.string(),
      /** The line under the panel: whose way of looking this is, and what to
       *  do with it. Defaulted to the house copy, so a location only says it
       *  when it wants to say something else. */
      rail: z
        .object({
          title: z.string(),
          body: z.string(),
          /** The animal's picture, under public/ -- the hero of its page. */
          image: z.string().optional(),
        })
        .default({ title: 'The Eagle', body: 'Observe the place around you from the perspective of the Eagle. Situate yourself in this incredible landscape.' }),
      /** Wide crop for the index card; falls back to the sphere itself. */
      card: z.string().optional(),
      caption: z.string(),
      /** Where true north is on the panorama's own scale: pan to north in the
       *  ?aim readout and this is the number it shows before calibration.
       *
       *  Setting it rotates the sphere so that direction sits at the viewer's
       *  zero, which makes every other angle in this file a real compass
       *  bearing -- `startYaw`, each marker's `yaw`, and `hero.yaw`. It is also
       *  what lets motion line the view up with the landscape in front of you.
       *
       *  Calibrating it: aim the crosshair at something whose true bearing you
       *  know, read the `Y` the panel prints, and add the difference to this
       *  number -- `north += Y - bearing`. Do it before placing markers, since
       *  moving north afterwards moves every bearing with it. */
      north: z.number().default(0),
      /** Bearing the view opens facing. 0 is north, so a location whose best
       *  opening view is not north says so here. */
      startYaw: z.number().default(0),
      /** Local magnetic declination, degrees east. Only used for devices that
       *  report a magnetic heading rather than a true one (Android's absolute
       *  orientation); iOS reports true north itself and is left alone. Without
       *  it, motion lines up wrong by the declination -- about 16 degrees east
       *  in Squamish, and worth looking up per site. */
      declination: z.number().default(0),
      /** Degrees above (+) or below (-) the horizon the view opens on. This
       *  aims the camera rather than tilting the sphere, so the horizon stays
       *  level as you pan. Clamped to +/-90 by the viewer. */
      startPitch: z.number().min(-90).max(90).default(0),
      /** Features named on the horizon. Each one is pinned to a direction, and
       *  opens when the centre of the view comes within `radius` of it -- so
       *  the sphere names what you are looking at, when you are looking at it,
       *  rather than carrying a constellation of labels wherever you pan.
       *  Open the page with ?aim and turn to a feature to read its angles off. */
      markers: z
        .array(
          z.object({
            /** Compass bearing of the feature, once `north` is calibrated.
             *  The ?aim readout's `marker` block pastes straight in. */
            yaw: z.number(),
            /** Degrees above (+) or below (-) the horizon. */
            pitch: z.number().min(-90).max(90).default(0),
            title: z.string(),
            body: z.string().optional(),
            /** Which side of the dot the words sit on. A feature low in the
             *  frame, or one whose label would fall behind the control row,
             *  labels upward instead. */
            place: z.enum(['above', 'below']).default('below'),
            /** How far off centre the view can be with this still open, in
             *  degrees. This is the real angle between the two directions, not
             *  a box, so a feature well above or below the centre stays shut
             *  even when the bearing lines up -- which is why the default is
             *  wider than a purely horizontal pan would need. */
            radius: z.number().gt(0).max(90).default(16),
          }),
        )
        .default([]),
    }),
    // A time series arrives either as a pre-exported video or as one image per
    // year. Exactly one of the two must be present.
    series: z
      .object({
        caption: z.string(),
        /** The heading across the top of each playthrough, beside the year.
         *  A callout's own `pageTitle` replaces it on that callout's page. */
        title: z.string().optional(),
        source: z.string(),
        /** Image-sequence form. */
        dir: z.string().optional(),
        ext: z.string().default('webp'),
        years: z.array(z.number()).min(2).optional(),
        /** The line under the panel: whose way of looking this is, and what to
         *  do with it. Defaulted to the house copy, so a location only says it
         *  when it wants to say something else. */
        rail: z
          .object({
          title: z.string(),
          body: z.string(),
          /** The animal's picture, under public/ -- the hero of its page. */
          image: z.string().optional(),
        })
          .default({ title: 'The Raven', body: 'The Raven moves freely through time and space, and teaches through the stories it tells. Travel through forty years of change like the Raven, then become it: photograph this place and tell us its story.' }),
        /** What the colours in the export mean. Drawn as a swatch and a label
         *  per entry, in a row under the video that wraps when it runs out of
         *  width. The export usually burns in its own legend at a size nobody
         *  can read on a phone; this is the readable one. */
        legend: z
          .array(
            z.object({
              /** Any CSS colour; a hex from the export's own palette is the
               *  point of it. */
              colour: z.string().min(1),
              label: z.string(),
            }),
          )
          .default([]),
        /** Timestamped callouts pinned to a point in the frame. Each opens on
         *  its year and holds for a set number of seconds, so the sequence can
         *  point at what it wants you to notice.
         *
         *  One shows per run through the clip, in the order they are written:
         *  the first time round the first, then the second, and back to the
         *  first once the list runs out. A run through forty years is short,
         *  and several callouts inside it compete for the same attention. */
        callouts: z
          .array(
            z.object({
              year: z.number(),
              /** Position within the video frame, 0-1 from the top left.
               *  Open the page with ?pin and click the frame to read these off. */
              x: z.number().min(0).max(1),
              y: z.number().min(0).max(1),
              /** An empty `title:` or `body:` is how a callout looks between
               *  being placed and being written, and YAML reads a key with
               *  nothing after it as null -- which would fail the build at the
               *  one moment the page most needs to still load. Both are
               *  therefore taken as simply absent. */
              title: z.string().nullish().transform((v) => v ?? ''),
              body: z
                .string()
                .nullish()
                .transform((v) => v || undefined),
              /** Seconds the ring stays on the frame, in playback time -- so
               *  it is reading time, and does not move if the clip is
               *  re-encoded at a different frame rate.
               *
               *  0 means the rest of the run: it stays from its year to the end
               *  of the clip. A duration of nothing would be a ring that never
               *  appears, which is no use to anyone, so the value is spent on
               *  the thing people actually want from it. */
              hold: z.number().min(0).default(3),
              /** Seconds the words stay, if they should outlast the ring or go
               *  before it. Same units and the same 0, and defaults to `hold`,
               *  so a callout that wants one duration only says `hold`.
               *
               *  Worth separating because they are read at different speeds: a
               *  ring is understood the moment it appears, a sentence is not,
               *  and a long body on a short ring is a sentence nobody finishes.
               *  0 is the common case of the two -- say the thing, leave it up
               *  for the rest of the run. */
              messageHold: z.number().min(0).optional(),
              /** Which side of the ring the words sit on, exactly as a
               *  panorama marker's `place` works. A callout low in the frame
               *  labels upward so its words stay on the picture. */
              place: z.enum(['above', 'below']).default('below'),
              /** The shape drawn on the frame. A box is a rectangle with its
               *  corners taken off -- for a cutblock, a subdivision, anything
               *  whose edges are straight and worth showing as straight. None
               *  draws nothing and dims nothing: the words alone, placed at x/y
               *  -- for saying something about the whole picture. */
              markerType: z.enum(['circle', 'box', 'none']).default('circle'),
              /** How wide and how tall it is drawn, each as a fraction of the
               *  frame's WIDTH -- both of them, so that equal values are equal
               *  on screen: a circle or a square, whatever shape the frame is.
               *  Different values give an ellipse or a rectangle.
               *
               *  A fraction rather than pixels so a marker covers the same
               *  ground at any screen size. */
              sizeX: z.number().gt(0).max(2).default(0.1),
              sizeY: z.number().gt(0).max(2).default(0.1),
              /** Seconds the rest of the picture stays dimmed, in real time,
               *  for a dim that should lift before its ring does.
               *
               *  Defaults to 0: for as long as the ring is up, which is the
               *  honest pairing -- the dim is there to say where the ring is.
               *  A ring held to the end of the run therefore dims the run,
               *  except that the picture always comes back up before the clip
               *  loops, so it never restarts by snapping from dark to bright. */
              dimHold: z.number().min(0).optional(),
              /** Seconds to hold on the final frame at the end of this
               *  callout's playthrough, before the clip goes round again.
               *
               *  Per callout because it is per playthrough: a run whose point
               *  lands in the last year or two needs a moment at the end for
               *  the change to register, and one whose point is in the middle
               *  does not. 0 goes straight round. */
              endPause: z.number().min(0).default(0),
              /** Seconds of real time to hold the clip still when this one
               *  opens, so there is time to look at what it points at before
               *  the years move on again. 0 runs straight through. */
              pause: z.number().min(0).default(0),
              /** This playthrough's heading, in place of the series' `title`. */
              pageTitle: z.string().optional(),
            }),
          )
          .default([]),
        /** Video form. `from`/`to` map clip position onto the year readout. */
        video: z
          .object({
            /** H.264: plays everywhere. */
            src: z.string(),
            /** The same clip in HEVC, offered first. It is far smaller at full
             *  quality -- what matters where reception is poor -- and every
             *  browser that can play it takes it, the rest take `src`. Made
             *  with tools/encode-walkthrough.sh. */
            hevc: z.string().optional(),
            poster: z.string().optional(),
            /** The satellite picture from the same camera and crop, laid under
             *  the clip. The reader fades the land cover down to it from the
             *  panel's settings; without one, there is no fade to offer. */
            base: z.string().optional(),
            /** Laid over the satellite and under the clip -- a layer that is
             *  already in the clip (the wildlife corridors, say), picture
             *  only, transparent elsewhere, from the same camera and crop. So
             *  it stays in view as the land cover is faded down to the
             *  satellite. Only with a `base`. */
            overlay: z.string().optional(),
            from: z.number(),
            to: z.number(),
            /** True when the export already burns in its own year and legend,
             *  as TerrAdapt's do -- the page then draws no year of its own. */
            burnedIn: z.boolean().default(false),
            /** How fast to play it, as a multiplier: 0.5 is half speed, 2 is
             *  double. For tuning the pace of an export without re-rendering
             *  it, which is minutes of work for a number that is guessed at
             *  until it is seen on the panel.
             *
             *  It does not change what the clip is: `duration` below, the year
             *  under the slider and where each callout opens are all positions
             *  within the clip, not times on a clock. What it does change is
             *  how long those positions take to arrive -- so `hold` and
             *  `messageHold`, which are measured in playback, last longer in
             *  the room at half speed, while `pause`, `dimHold` and `endPause`,
             *  which are measured in real seconds, do not move. */
            speed: z.number().gt(0).max(4).default(1),
            /** Length of the clip in seconds, from `ffprobe`.
             *
             *  Everything on this panel is a fraction of the clip's length: the
             *  year, the slider, when each callout opens. A browser that will
             *  not report a duration therefore freezes the lot, which looks
             *  like a broken page rather than a missing number. This is the
             *  answer of last resort, used only when the media itself will not
             *  say. Optional, and only wrong if the clip is re-encoded to a
             *  different length without updating it. */
            duration: z.number().gt(0).optional(),
            /** When the picture changes to the second year and to the last, in
             *  seconds into the clip; the changes between are taken as evenly
             *  spaced. For a clip whose years do not each own an equal share of
             *  it -- one edited with a dissolve centred on each change, where
             *  the first and last years get half a share -- so the year readout
             *  and each callout's opening follow the picture rather than the
             *  clock. Left out, every year owns an equal share.
             *
             *  Read off the export by matching its frames against the yearly
             *  stills; the change is where the match flips. */
            changes: z.tuple([z.number().min(0), z.number().gt(0)]).optional(),
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
    /** The last panel: what to take away from here. Not tied to a section of
     *  the post, because it is about the ones you have not visited yet. */
    closing: z
      .object({
        eyebrow: z.string(),
        title: z.string(),
        body: z.string(),
        /** The quieter second paragraph. */
        note: z.string(),
        /** The label on the button that opens the map. */
        action: z.string(),
        /** The label on the button that offers to install the app. */
        install: z.string().default('Add to home'),
      })
      .default({
        eyebrow: 'Keep going',
        title: 'Take this with you',
        body: 'What you just did here — stand still, look properly, notice what has changed, tell its story — works anywhere in the Sea-to-Sky.',
        note: 'There are posts like this one across the region, each with its own QR code and its own view. Every photograph and every story sent from them joins the same record, so the landscape gets told by the people who walk it rather than by the satellites alone.',
        action: 'Explore the map',
        install: 'Add to home',
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

/** The Bear's map of the corridor (src/pages/explore.astro): one file, so the
 *  layers and every callout are edited in one place. */
const lngLat = z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]);
const map = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/map' }),
  schema: z.object({
    title: z.string(),
    /** South-west and north-east corners of the view the map opens on. */
    bounds: z.tuple([lngLat, lngLat]),
    /** The map's area: the box the basemap was cut to
     *  (tools/extract-basemap.sh). The map draws its edge along this and
     *  pans a little way past it. */
    limit: z.tuple([lngLat, lngLat]),
    /** Degrees east of true north that a magnetic compass reads here. Only
     *  used where the phone reports a magnetic heading (Android) rather than a
     *  true one (iOS) -- for the cone showing which way you face. */
    declination: z.number().default(16),
    /** The Bear's page, opened from the pill as on the story pages. */
    bear: z.object({
      title: z.string(),
      body: z.string(),
      image: z.string().optional(),
    }),
    /** Map-portal layers, each a PMTiles file from tools/prepare-layer.sh,
     *  listed in the order they stack (the last is on top). */
    layers: z
      .array(
        z.object({
          id: z.string().regex(/^[a-z0-9-]+$/),
          name: z.string(),
          /** Under public/. */
          src: z.string(),
          /** Who the data is from, shown under the layer's name. */
          source: z.string().optional(),
          opacity: z.number().min(0).max(1).default(0.8),
          /** Shown when the map opens. */
          on: z.boolean().default(false),
          /** Nearest keeps classes crisp when the map is zoomed past the
           *  data's own pixels; linear suits continuous surfaces. */
          resampling: z.enum(['nearest', 'linear']).default('nearest'),
          legend: z.array(z.object({ colour: z.string(), label: z.string() })).optional(),
          /** One plain line in the map's legend saying what the layer is,
           *  shown while it is on. */
          about: z.string().optional(),
          /** For when you are standing in this layer -- any painted pixel
           *  under you. A tag by your dot on the map says `label`; tapped, it
           *  opens a card headed "You're in <what>" -- joined with "and" when
           *  you are in more than one -- over a pill per layer and its `body`.
           *  Leave it out and the layer is never asked. */
          here: z
            .object({
              label: z.string(),
              /** The layer as a phrase, article and all: "a habitat core". */
              what: z.string(),
              body: z.string(),
              /** "Things to look for": short things a person standing there
               *  could actually notice. A bullet each. */
              look: z.array(z.string()).optional(),
            })
            .optional(),
        }),
      )
      .default([]),
    /** Things to notice on the ground, each a pin. */
    callouts: z
      .array(
        z.object({
          title: z.string(),
          lat: z.number(),
          lng: z.number(),
          body: z.string(),
          /** Under public/. */
          image: z.string().optional(),
          /** A layer id: the pin only shows while that layer is on. */
          layer: z.string().optional(),
        }),
      )
      .default([]),
  }),
});

/** The EcoScapes map (src/pages/map.astro): the friendly front door onto the
 *  map portal's own layers, which live outside this file --
 *  src/data/ecoscapes-layers.json (generated by tools/fetch-felt-layer*) and
 *  src/data/ecoscapes-themes.json group them. This file holds only the view
 *  the map opens on. */
const ecoscapes = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/ecoscapes' }),
  schema: z.object({
    title: z.string(),
    /** South-west and north-east corners of the view the map opens on. */
    bounds: z.tuple([lngLat, lngLat]),
    /** The map's area: the box the basemap was cut to
     *  (tools/extract-basemap.sh). The map draws its edge along this and
     *  pans a little way past it. */
    limit: z.tuple([lngLat, lngLat]),
    /** The basemap PMTiles file for this map, under public/ -- the whole
     *  EcoScapes study area, cut by tools/extract-basemap.sh at a coarser
     *  zoom than /explore/'s corridor file, since it covers about three
     *  times the ground and still has to fit GitHub's 100 MB a file. */
    basemap: z.string(),
    /** Degrees east of true north that a magnetic compass reads here. Only
     *  used where the phone reports a magnetic heading (Android) rather than a
     *  true one (iOS) -- for the cone showing which way you face. */
    declination: z.number().default(16),
    /** A line under the title while the skeleton stands in for the real
     *  interface. */
    intro: z.string(),
  }),
});

export const collections = { locations, map, ecoscapes };
