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
  caption: Landcover and land-use change, 1984–2024
  # The heading across the top of each page of the series; any callout can
  # give its own page a different one with `pageTitle`.
  title: Placeholder series title
  source: TerrAdapt · Sea-to-Sky model area
  rail:
    title: The Raven
    # The hero of this animal's page (portrait, under public/).
    image: /media/animals/raven.jpg
    body: >-
      Learn through curiosity like the Raven. How has the landscape
      changed over the past 40 years? What are those changes, and where?
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
  # Placeholder positions and wording -- replace with real observations.
  # Open /p/feather-park-01/?pin and click the frame to read off x/y.
  callouts:
    - year: 1993
      x: 0.451
      y: 0.647
      markerType: circle
      sizeX: 0.2
      sizeY: 0.2
      pause: 6
      hold: 0
      messageHold: 0
      pageTitle: Industrial Development - 1993
      title: Squamish Industrial District
      body: Notice as large areas of greenspace are developed into industrial & commerical units.
      endPause: 2
    - year: 1997
      x: 0.512
      y: 0.485
      markerType: circle
      sizeX: 0.2
      sizeY: 0.2
      pause: 6
      hold: 0
      messageHold: 0
      pageTitle: Garibaldi Highlands Development - 1997
      title: Garibaldi Highlands
      body: Watch here as forest is cleared to make way for the Garibaldi Highlands residential developments.
      endPause: 2
    - year: 1987
      x: 0.488
      y: 0.464
      markerType: box
      # A phone shows about 0.58 of the frame's width, centred; wider than
      # that and the box runs off both sides.
      sizeX: 0.45
      sizeY: 0.15
      place: below
      pageTitle: Forestry Activities - 1987
      title: Forestry Work
      body: Observe large areas of forest being cut during forestry activities.
      pause: 6
      hold: 0
      messageHold: 0
      endPause: 2
  video:
    src: /media/feather-park-01/series.mp4
    poster: /media/feather-park-01/series-poster.jpg
    # Satellite, same camera and crop -- what the land cover fades down to.
    base: /media/feather-park-01/series-base.jpg
    # Playback speed. The clip is already paced in the edit, so none.
    speed: 1
    from: 1984
    to: 2024
    # This export carries no year of its own -- it is a plain 3D view of the
    # valley -- so the panel draws the year itself from the position in the clip.
    burnedIn: false
    # From ffprobe. Only read if the browser will not report the clip's length
    # itself -- without it, such a browser freezes the year and every callout.
    duration: 13.333
    # When the picture turns to 1985 and to 2024, in seconds; the changes
    # between are evenly spaced (a third of a second apart). Measured by
    # matching the clip's frames against the yearly stills -- re-measure if the
    # edit is re-timed.
    changes: [0.208, 13.208]
capture:
  prompt: Help us tell the story of this landscape. Place your phone in the holder, snap a photo, and share it with us.
  shareTo: EcoScapes
  rail:
    title: The Bear
    # The hero of this animal's page (portrait, under public/).
    image: /media/animals/bear.jpg
    body: >-
      The Bear is on the ground, connected to the landscape. Explore like the Bear, and share what you find to help tell the
      story of the changing landscape around us.
closing:
  eyebrow: Keep going
  title: Take this with you
  body: >-
    Just like the bears we share this place with, we urge you to continue exploring. Add this website to your home screen, and pick it back up the next time you feel you have a story to share.
  note: >-
    Keep an eye out for more posts in the Sea-to-Sky. Each one tells a unique and changing story of this landscape.
  action: Find another post
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
