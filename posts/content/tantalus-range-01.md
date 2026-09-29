---
title: Tantalus Range
# In the works: shown in dev, left out of the built site until this is true.
published: true
place: Sea-to-Sky · above the Cheakamus River, BC
installed: 2026-09-28
lat: 49.84631
lng: -123.15001
intro: >-
  Mount Tantalus and the jagged peaks of its range rise to the south-west,
  under snow all year. Squamish Nation history tells of Tl'elhnáyem,
  mountain-goat hunters, and their Skipképalu (hunting dogs), caught here in a
  ferocious blizzard and turned into these mountains: the peaks are the
  hunters' spears, the foothills their dogs, still under the same blanket of
  snow.
hero:
  src: /media/tantalus-range-01/hero.jpg
  # Framing of the still. Re-rendered from these on build, and on save in dev.
  yaw: 256
  pitch: 2
  vfov: 75
pano:
  src: /media/tantalus-range-01/pano.jpg
  card: /media/tantalus-range-01/pano-card.jpg
  rail:
    title: Eagle
    image: /media/animals/eagle.jpg
    body: >-
      Eagles see far more sharply than we do, and from high above they take
      in a whole valley at once. Look around you and find your place in this
      landscape.
  caption: A full turn over the Cheakamus River, facing the Tantalus Range.
  # From Mt Tantalus's summit in the panorama, at its bearing from here (256,
  # read off the pano by Niall). Not yet checked on site. Check it with
  # /p/tantalus-range-01/?aim before trusting the markers: a residual error is
  # a constant, and correcting it moves this and every bearing below together.
  north: 30.1
  startYaw: 256
  declination: 16
  startPitch: 0
  # Bearings from the estimate above -- turn to each with ?aim and paste the
  # `marker` block it prints.
  markers:
    - yaw: 256
      pitch: 8
      title: Mount Tantalus
      body: The highest peak of the range, 2,608 m.
      place: above
      radius: 10
    - yaw: 282
      pitch: 5
      title: The hunters' spears
      body: In Squamish Nation history, the jagged peaks are the spears of the Tl'elhnáyem, the mountain-goat hunters.
      place: above
      radius: 14
    - yaw: 200
      pitch: -10
      title: Towards Squamish
      body: The valley runs south to Brackendale and the town.
      place: above
      radius: 16
    - yaw: 170
      pitch: -60
      title: Above the Cheakamus River
      body: Where you are right now.
      place: above
      radius: 35
series:
  caption: Land cover, 1984–2024
  title: Snow and ice on the Tantalus Range
  source: Land cover · Gregory Kehm, GKA Geographic Solutions Inc.
  # The classes that are read on this ground, from the map's land cover key.
  legend:
    - colour: '#169b42'
      label: Coniferous forest
    - colour: '#1bcb55'
      label: Deciduous forest
    - colour: '#4ed37a'
      label: Shrubs & meadow
    - colour: '#07a5ab'
      label: Woody wetland
    - colour: '#418fbf'
      label: Water
    - colour: '#e6eef2'
      label: Snow & ice
    - colour: '#a89f8f'
      label: Barren
    - colour: '#8d8d8d'
      label: Built
  callouts:
    - year: 1995
      x: 0.2
      y: 0.45
      sizeX: 0.3
      sizeY: 0.4
      place: below
      title: Snow and ice
      body: Watch the white on the Tantalus Range shrink as the years go by.
      pause: 4
      hold: 0
      endPause: 2
  # Recorded from the map (Save > The years, as a video), 2026-09-28, then
  # posts/tools/encode-walkthrough.sh with HEVC_CRF=33 (the default 30 made
  # 9 MB of this busy land cover).
  video:
    hevc: /media/tantalus-range-01/landcover-2022-1984-2024.hevc.mp4
    src: /media/tantalus-range-01/landcover-2022-1984-2024.mp4
    poster: /media/tantalus-range-01/landcover-2022-1984-2024-poster.jpg
    base: /media/tantalus-range-01/landcover-2022-1984-2024-base.jpg
    from: 1984
    to: 2024
    burnedIn: false
    duration: 17.083
    changes: [0.417, 16.667]
capture:
  prompt: Help us tell the story of this landscape. Snap a photo of the view, and share it with us.
  shareTo: EcoScapes
closing:
  eyebrow: Keep going
  title: Take this with you
  body: >-
    What you just did here — stand still, look properly, notice what has changed, tell its story — works anywhere in the Sea-to-Sky. Add this website to your home screen, and pick it back up the next time you have a story to share.
  note: >-
    Keep an eye out for more posts in the Sea-to-Sky. Each one tells a unique and changing story of this landscape.
  action: Explore the map
  install: Add to home
---
