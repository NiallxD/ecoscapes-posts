---
title: Sea-to-Sky
# The whole EcoScapes study area, Sunshine Coast and Vancouver to past
# Lillooet: what the map opens on when it does not know where you are, or you
# are somewhere else. The widest sensible look at everywhere the map's
# layers cover, so a layer switched on reads as a whole area rather than a
# sliver of one; once it finds you, it flies in to walking scale.
bounds: [[-124.69, 48.94], [-121.43, 51.26]]
# The map's area: the basemap is cut to this box and a margin round it
# (shared/tools/extract-basemap.py), the map draws its edge
# along it, and pans a little past it so the edge can be seen. The union of
# every EcoScapes layer's own bounding box (excluding the ETOPO backdrop),
# rounded outward to 2 decimals.
limit: [[-124.69, 48.94], [-121.43, 51.26]]
basemap: /tiles/basemap-study.pmtiles
# Magnetic declination, degrees east: about 16 across the corridor, and close
# enough across the wider study area that a second figure is not worth
# carrying -- the cone is a rough sense of facing, not a bearing anyone reads
# precisely. Turns an Android phone's magnetic heading onto true north.
declination: 16
# The line under the title. Draft -- for Murray.
intro: >-
  The Sea-to-Sky, where you are on it, and what the land around you holds:
  every layer of the EcoScapes map portal, on one map.
bear:
  title: Bear
  # The hero of this animal's page (portrait, under public/).
  image: /media/animals/bear.jpg
  body: >-
    Bears know their ground up close. They cover long distances on foot and
    read the land by smell as much as by sight. Find where you are standing,
    and see what the land around you holds.
# What someone standing in a layer is told, by the layer's id: the tag beside
# your dot, and the card it opens. The layers themselves -- every one, however
# it was made -- are in ecoscapes-layers.json.
here:
  connectivity-linkages:
    # Draft wording -- for Murray to check.
    label: Wildlife corridor
    what: a wildlife corridor
    body: >-
      Wildlife corridors are the easiest routes for animals to travel
      between habitat cores. Keeping them open lets wildlife reach food,
      shelter and new ground as the landscape and the climate change around
      them.
    # Things someone standing here could spot. Drafts -- for Murray to check.
    look:
      - Narrow game trails, especially along streams and valley bottoms
      - Tracks or scat where the ground is soft or snowy
      - Culverts, bridges and underpasses animals could use to cross roads
      - Fences, roads or buildings that could block the way
  habitat-cores:
    # Draft wording -- for Murray to check.
    label: Habitat core
    what: a habitat core
    body: >-
      Habitat cores are the places where many of the region's species are
      most likely to be found: good ground to live, feed and raise young.
    # Drafts -- for Murray to check.
    look:
      - Big old trees, standing dead snags and fallen logs
      - Nibbled shrubs and young trees, where deer and elk have browsed
      - Birdsong — how many different calls can you hear?
      - Tracks, scat or claw marks on trees
# Pins: things to notice on the ground. Placed with /map/?pick; the facts are
# from each place's Wikipedia page (2026-09-28).
callouts:
  - title: Stawamus Chief
    lat: 49.6819
    lng: -123.1409
    body: >-
      Stawamus Chief is a large granite monolith which towers over downtown Squamish.
  - title: Squamish Estuary
    lat: 49.6905
    lng: -123.1755
    body: >-
      Squamish estuary is a large estuarine region in Squamish and is home to a diverse group of wildlife.
  - title: Mount Price & Clinker Peak
    lat: 49.91532
    lng: -123.04185
    body: >-
      Mount Price is a small stratovolcano in the Garibaldi Ranges of the Pacific Ranges in southwestern British Columbia, Canada.
  - title: "The Barrier"
    lat: 49.94199
    lng: -123.08886
    body: >-
      A lava dam holding back Garibaldi Lake. About 13,000 years ago, lava
      from Clinker Peak ponded and cooled against the retreating ice
      sheet, which is why it is so thick. In 1855–56 part of it gave way
      in a huge rock avalanche down Rubble Creek, and in 1980–81 the land
      below was declared unsafe to live on.
  - title: "Mt. Garibaldi (Nch'kay)"
    lat: 49.85092
    lng: -123.00588
    body: >-
      Nch'ḵay̓ is a dormant volcano, 2,678 m, the tallest peak around
      Squamish. It grew while surrounded by the last ice sheet, and as the
      ice melted its west face collapsed in a series of landslides between
      12,800 and 11,500 years ago, spreading debris out into the Squamish
      Valley.
  - title: "Black Tusk"
    lat: 49.97489
    lng: -123.04311
    body: >-
      T'ákt'akmúten tl'a Ín7inyáx̱a7en in the Squamish language: a
      pinnacle of volcanic rock, 2,319 m, the worn-down core of an old
      volcano. Its dark spire can be seen from far off in every direction,
      especially from the highway just south of Whistler.
  - title: "Mt Tantalus"
    lat: 49.81602
    lng: -123.32893
    body: >-
      At 2,608 m, the highest mountain in the Tantalus Range, famous for
      its snow-covered face. In the land cover maps, its snow and ice
      shrink from the 1980s on.
  - title: "Sky Pilot & Copilot"
    lat: 49.63512
    lng: -123.0838
    body: >-
      Sky Pilot is the highest mountain in the Britannia Range, with Co-
      Pilot (1,881 m) beside it. It is named after the United Church's
      mission boat Sky Pilot, and has drawn many more climbers since the
      Sea to Sky Gondola opened in 2014.
  - title: "Squamish Valley"
    lat: 49.84159
    lng: -123.22997
    body: >-
      The valley of the Squamish River: short, about 80 km, but a very
      large river, draining more than 3,300 km² of mountains. Glacier-fed
      tributaries join it all the way down.
  - title: "Squamish - Ashlu Confluence"
    lat: 49.90246
    lng: -123.30916
    body: >-
      Ashlu Creek, short and swift, joins the Squamish here, about 24 km
      north-west of town. Below its canyon, a run-of-river hydro plant has
      made power from it since 2009.
  - title: "Squamish - Elaho Confluence"
    lat: 50.1108
    lng: -123.39153
    body: >-
      Where the Elaho River, flowing from the Elaho Glacier, meets the
      Squamish. Here the Elaho is the bigger of the two rivers, and it is
      prone to flash floods.
  - title: "Squamish - Mamquam Confluence"
    lat: 49.73458
    lng: -123.15062
    body: >-
      The Mamquam River, about 35 km long, ends here in the Squamish. It
      gathers creeks from the glaciers and lakes of Garibaldi Park on its
      way down.
  - title: "Stawamus River"
    lat: 49.69301
    lng: -123.13635
    body: >-
      A small, creek-like river that starts at Stawamus Lake and runs down
      past the Chief, with no major tributaries. It reaches Howe Sound
      just east of the mouth of the Squamish.
  - title: "Squamish River"
    lat: 49.71491
    lng: -123.17165
    body: >-
      The river that gives the town its name, fed by glaciers along its
      whole length. At its mouth is the Skwelwil'em Squamish Estuary
      Wildlife Management Area.
  - title: "Howe Sound"
    lat: 49.66815
    lng: -123.20752
    body: >-
      Átl'ḵa7tsem, a triangle of fjords reaching up from the sea to
      Squamish. The Britannia copper mine, once the largest in the British
      Empire, and other industry left it badly polluted. Since the clean-
      up, humpback whales, orcas and sea lions have returned, and in 2021
      it was named a UNESCO Biosphere Reserve for that recovery.
  - title: "Skookum - Mamquam Confluence"
    lat: 49.71949
    lng: -122.99437
    body: >-
      Skookum Creek flows south-west from remote Mamquam Lake in Garibaldi
      Park and meets the Mamquam River here, about 12 km above its mouth.
---
