---
title: Sea-to-Sky
# The whole corridor, Horseshoe Bay to Pemberton: what the map opens on when
# it does not know where you are, or you are somewhere else.
bounds: [[-123.35, 49.33], [-122.72, 50.35]]
# The map's area: the basemap is cut to this box (tools/extract-basemap.sh),
# the map draws its edge along it, and pans a little past it so the edge can
# be seen. Bounded by the basemap's file size -- the whole EcoScapes study
# area would not fit on GitHub at this detail.
limit: [[-123.9, 49.28], [-122.05, 50.45]]
# Magnetic declination, degrees east: about 16 across the corridor. Turns an
# Android phone's magnetic heading onto true north for the facing cone.
declination: 16
bear:
  title: The Bear
  # The hero of this animal's page (portrait, under public/).
  image: /media/animals/bear.jpg
  body: >-
    The Bear is on the ground, connected to the landscape. Explore like the
    Bear: find where you are standing, and look at what the land around you
    holds.
# Map-portal layers, from tools/prepare-layer.sh, in the order they stack (the
# last on top). Styled as the EcoScapes Ecological Connectivity Overlay on Felt.
layers:
  # From Murray's GeoTIFF (270 m), classed with the Felt map's four Jenks
  # breaks: tools/prepare-layer.sh <tif> connectivity-linkages near
  # tools/styles/connectivity-linkages.txt
  - id: connectivity-linkages
    name: Connectivity linkages
    src: /tiles/layers/connectivity-linkages.pmtiles
    # Mapped with Linkage Mapper, between the habitat cores below. What
    # visitors read stays plain: no method names.
    source: EcoScapes
    on: true
    opacity: 0.9
    # The line under its name in the map's legend. Draft -- for Murray.
    about: The easiest routes for wildlife to travel between habitat cores. Darker shades are the stronger links.
    # When you are standing in one: the tag beside your dot, and the card it
    # opens. Draft wording -- for Murray to check.
    here:
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
    legend:
      - colour: '#6f6589'
        label: High
      - colour: '#8f85a9'
        label: Moderate
      - colour: '#b1aac7'
        label: Low
      - colour: '#d7d2e4'
        label: Very low
  # From the GeoPackage, burned to a raster: tools/rasterize-polygons.sh
  # <gpkg> <tif> 112,168,0, then tools/prepare-layer.sh <tif> habitat-cores
  - id: habitat-cores
    name: Habitat cores and patches
    src: /tiles/layers/habitat-cores.pmtiles
    # From a multispecies distribution model -- not from the linkages, which
    # are mapped between these. Plain words for visitors, as above.
    source: EcoScapes
    on: true
    opacity: 0.85
    about: Where many of the region's species are most likely to be found.
    # Draft wording -- for Murray to check.
    here:
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
    legend:
      - colour: '#70a800'
        label: Habitat core or patch
# Pins. Placeholders until the real stories are written: the places are real,
# the words are not.
callouts:
  - title: Placeholder — Stawamus Chief
    lat: 49.6819
    lng: -123.1409
    body: >-
      A callout about something you can see on the ground from here. A few
      sentences, a story rather than a data sheet.
  - title: Placeholder — Squamish Estuary
    lat: 49.6905
    lng: -123.1755
    body: >-
      A callout can carry a picture as well, and can be tied to a layer so it
      only shows while that layer is on.
  - title: Placeholder — Brackendale
    lat: 49.7735
    lng: -123.1523
    body: >-
      Pins further up the corridor show in the "near you" list for anyone
      standing close to them.
---
