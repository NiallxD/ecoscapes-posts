---
title: Sp'akw'us Feather Park
place: Sea-to-Sky · Squamish, BC
installed: 2026-04-18
lat: 49.6850916667
lng: -123.1661530556
intro: >-
  Átl'ḵa7tsem (Howe Sound), pronounced 'AT-KA-tsum', extends to the south, the Squamish River to the west,
  downtown to the north, and the Britannia Range towers over Siyám Smánit (the
  Chief) to the east.
hero:
  src: /media/feather-park-01/hero.jpg
  # Framing of the still. Re-rendered from these on build, and on save in dev.
  yaw: 101.2
  pitch: -20
  vfov: 95
pano:
  src: /media/feather-park-01/pano.jpg
  card: /media/feather-park-01/pano-card.jpg
  # The line under this panel.
  rail:
    title: The Eagle
    # The hero of this animal's page (portrait, under public/).
    image: /media/animals/eagle.jpg
    body: >-
      The Eagle soars high and surveys the landscape. Take a moment to observe the place around you from the perspective of the Eagle, and situate
      yourself in this incredible landscape.
  caption: A full turn from the heart of Squamish.
  # Where true north sits on the panorama's own scale. Derived from the true
  # bearings of Mt Garibaldi, Shannon Falls, downtown and the Chief as seen from
  # this post -- four landmarks that agree to within 5 degrees. Worth a compass
  # check on site; a residual error is a constant, and correcting it means
  # moving this and every bearing below by the same amount.
  north: 53.8
  # Bearing the view opens facing -- west-north-west, which is the framing this
  # location has always opened on.
  startYaw: 96.2
  # Degrees east. Squamish is about 16E. Only used on devices that report a
  # magnetic heading rather than a true one.
  declination: 16
  # Degrees above (+) or below (-) the horizon the view opens on.
  startPitch: -20
  # Features named as you turn to them. Placeholder bearings, read off the
  # geography in the intro rather than off the sphere -- turn to each one with
  # /p/feather-park-01/?aim and paste the `marker` block it prints.
  markers:
    - yaw: 216.2
      pitch: -5
      title: Átl'ḵa7tsem (Howe Sound)
      body: The fjord reaching south to the Salish Sea.
      place: above
      radius: 30
    - yaw: 291.2
      pitch: -5
      title: Squamish River
      body: Braided channels feeding the estuary.
      place: above
      radius: 20
    - yaw: 23.2
      pitch: -7
      title: Downtown Squamish
      body: The heart of the town of Squamish.
      radius: 15
      place: below
    - yaw: 29.2
      pitch: 9
      title: N'chkay (Mt. Garibaldi)
      body: The tallest peak in our area.
      radius: 15
      place: above
    - yaw: 94.2
      pitch: 20
      title: Siyám Smánit (the Chief)
      body: The Britannia Range stands behind it.
      place: above
      radius: 20
    - yaw: 136.2
      pitch: -50
      title: Sp'akw'us Feather Park
      body: Where you are right now.
      place: above
      radius: 40
    - yaw: 153.2
      pitch: -2.5
      title: Shannon Falls Provincial Park
      body: A large waterfall flowing from the Shannon Basin.
      place: below
      radius: 15
    - yaw: 251.2
      pitch: -15
      title: Squamish Terminals
      body: A small port on the Howe Sound.
      place: above
      radius: 15
    - yaw: 354.2
      pitch: -4
      title: Squamish River Estuary
      body: A Wildlife Management Area at the head of the Howe Sound. Home to lotssss of wildlife.
      place: above
      radius: 15
series:
  caption: Land cover change and wildlife corridors, 1984–2024
  # The heading across the top of each page of the series; any callout can
  # give its own page a different one with `pageTitle`.
  title: Placeholder series title
  source: TerrAdapt · Sea-to-Sky model area
  rail:
    title: The Raven
    # The hero of this animal's page (portrait, under public/).
    image: /media/animals/raven.jpg
    # The Raven carries on through capture and the closing page: having
    # travelled forty years here, the visitor becomes the Raven and tells the
    # story of what they see.
    body: >-
      In Indigenous lore the Raven is a time shifter, moving freely through
      time and space, and a trickster who teaches through the stories it
      tells. Travel through forty years of change like the Raven, then become
      it: photograph this place and tell us its story as you see it today.
  # The layer's own palette, sampled from the TerrAdapt legend. Not all of it:
  # the classes that are actually read on this ground, in plain words -- mesic
  # and xeric are moisture, which is a word the map needs and a reader does not.
  legend:
    - colour: '#2c471b'
      label: Coniferous forest
    - colour: '#0e7813'
      label: Deciduous forest
    - colour: '#daac45'
      label: Damp shrubland
    - colour: '#d8c08b'
      label: Dry grassland
    - colour: '#002139'
      label: Water
    - colour: '#def3ff'
      label: Snow & ice
    - colour: '#9f9f90'
      label: Barren
    - colour: '#9b0000'
      label: Developed
    # The corridors' own magenta, as drawn over the land cover.
    - colour: '#762b78'
      label: Wildlife corridors
  # Callouts: each one is a playthrough of its own -- its own page in the
  # series and its own segment in the story bar. With none, the series is one
  # plain playthrough. Every field is noted on this one; all but year, x and y
  # can be left out (the defaults are given).
  # To place one: open /p/feather-park-01/?pin, click the frame, and paste the
  # block it prints here.
  callouts:
    - year: 1986               # the year it appears
      x: 0.490                 # across the frame, 0 = left edge, 1 = right
      y: 0.459                 # down the frame, 0 = top, 1 = bottom
      markerType: circle       # circle (default), box, or none (words only, no ring or dim)
      sizeX: 0.1               # width, as a share of the frame's width (default 0.1)
      sizeY: 0.1               # height, also as a share of the WIDTH, so equal = round
      place: below             # words above or below the ring (default below)
      title: Forestry in Corridors          # the heading beside the ring
      body: Watch how forest is cut down within a priority linkage making it more difficult for wildlife to move through that area.     # the sentence under the heading
      pause: 7                 # seconds the clip holds still when it appears (default 0)
      hold: 0                  # seconds the ring stays; 0 = to the end of the run (default 3)
      messageHold: 1            # seconds the words stay after the pause; defaults to hold       
      pageTitle: Forestry in Corridors        # this page's heading, in place of the series title
      dimHold: 0             # seconds the picture stays dimmed; defaults to while the ring is up
      endPause: 2            # seconds on the last frame before it loops (default 0)
    - year: 1985               # the year it appears
      x: 0.365                 # across the frame, 0 = left edge, 1 = right
      y: 0.209                 # down the frame, 0 = top, 1 = bottom
      markerType: none         # circle (default) or box, or none for text only
      title: Forestry in Corridors          # the heading beside the ring
      body: Can you spot any more locations where forest has historically been cut down inside a wildlife corridor?    # the sentence under the heading
      pause: 7                 # seconds the clip holds still when it appears (default 0)
      messageHold: 1            # seconds the words stay after the pause; defaults to hold       
      pageTitle: Forestry in Corridors        # this page's heading, in place of the series title
      dimHold: 0             # seconds the picture stays dimmed; defaults to while the ring is up
      endPause: 2            # seconds on the last frame before it loops (default 0)
  # One walkthrough: land cover with the wildlife corridors over it, 1984 to
  # 2024. The earlier three (industrial district, Garibaldi Highlands,
  # forestry), each a playthrough with its own callout, are kept with their
  # clip in archive/feather-park-01/2026-09-24-landcover-series/.
  video:
    # Both from tools/encode-walkthrough.sh: HEVC (full size, ~6 MB) for every
    # browser that plays it, H.264 (1600 wide) for the rest.
    hevc: /media/feather-park-01/series-linkages.hevc.mp4
    src: /media/feather-park-01/series-linkages.mp4
    poster: /media/feather-park-01/series-linkages-poster.jpg
    # Satellite, same camera and crop -- what the land cover fades down to.
    # The clip and both stills come from the one 4:3 export
    # (~/Desktop/Linkages_Landcover_Squamish/export), so they line up exactly.
    base: /media/feather-park-01/series-linkages-base.jpg
    # The corridors alone, over the satellite: they are in the clip too, so
    # this keeps them in view as the land cover is faded out.
    overlay: /media/feather-park-01/series-linkages-overlay.webp
    speed: 1
    from: 1984
    to: 2024
    burnedIn: false
    # From ffprobe.
    duration: 17.083
    # When the picture turns to 1985 and to 2024, in seconds: ten frames a
    # year at 24 fps. Measured by matching every frame of the clip against the
    # yearly stills it was made from.
    changes: [0.25, 16.5]
capture:
  prompt: Help us tell the story of this landscape. Place your phone in the holder, snap a photo, and share it with us.
  shareTo: EcoScapes
closing:
  eyebrow: Keep going
  title: Take this with you
  body: >-
    What you just did here — stand still, look properly, notice what has changed, tell its story — works anywhere in the Sea-to-Sky. Add this website to your home screen, and pick it back up the next time you have a story to share.
  note: >-
    Keep an eye out for more posts in the Sea-to-Sky. Each one tells a unique and changing story of this landscape.
  # Opens the map of the corridor, where the other posts are too.
  action: Explore the map
  # The second button, beside it.
  install: Add to home
wall:
  dir: /media/feather-park-01/wall
  full: /media/feather-park-01/wall-full
  dates:
    - '2025-05-08'
    - '2025-05-10'
    - '2025-12-09'
    - '2026-02-15'
    - '2026-02-22'
    - '2026-03-11'
    - '2026-03-30'
    - '2026-04-04'
    - '2026-04-05'
    - '2026-04-13'
    - '2026-04-20'
    - '2026-04-28'
    - '2026-04-29'
    - '2026-05-02'
    - '2026-05-04'
    - '2026-05-06'
    - '2026-05-11'
    - '2026-05-22'
    - '2026-06-23'
    - '2026-08-21'
---