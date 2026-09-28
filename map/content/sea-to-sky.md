---
title: Sea-to-Sky
# The whole EcoScapes study area, Sunshine Coast and Vancouver to past
# Lillooet: what the map opens on when it does not know where you are, or you
# are somewhere else. The widest sensible look at everywhere the portal's
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
# The portal's layers themselves come from map/content/ecoscapes-layers.json.
# Anything here with a portal layer's id is laid over that layer: which ones
# are on when the map opens, and the words for standing in one. Anything
# else is a layer of this site's own, stacked over the portal's in this order
# (the last on top), and needs its name, file and place in the list.
layers:
  - id: connectivity-linkages
    # Off unless asked for: a post's "Explore the map" opens /map/ with
    # ?layers=connectivity-linkages; plain /map/ opens with no layer on.
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
  # From the GeoPackage, burned to a raster and tiled by map/tools/build-map.py
  # (its entry in map/tools/map-catalogue.json).
  - id: habitat-cores
    name: Habitat cores and patches
    src: /tiles/layers/habitat-cores.pmtiles
    # From a multispecies distribution model -- not from the linkages, which
    # are mapped between these. Plain words for visitors.
    source: EcoScapes
    opacity: 0.85
    kind: categories
    theme: 05-connectivity-network
    subtheme: 05-01-habitat-cores
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
  # TerrAdapt series with no map of the portal's own: each shows its latest
  # year, and its years through Through time (timeseries.json).
  - id: developed-land
    name: Developed land
    src: /tiles/ecoscapes/developed/2024.pmtiles
    source: TerrAdapt-Cascadia
    opacity: 0.8
    kind: continuous
    theme: 02-ecosystem-integrity
    subtheme: 02-02-habitat-threats
    about: How likely the ground is to be built on or paved, in 2024.
    legend:
      - { colour: '#ffffcc', label: Less likely }
      - { colour: '#ffeda0', label: '' }
      - { colour: '#fed976', label: '' }
      - { colour: '#feb24c', label: '' }
      - { colour: '#fd8d3c', label: '' }
      - { colour: '#fc4e2a', label: '' }
      - { colour: '#e31a1c', label: '' }
      - { colour: '#bd0026', label: '' }
      - { colour: '#800026', label: More likely }
  # Draft: which end is loss is not confirmed -- for Murray to check.
  - id: ecosystem-change
    name: Ecosystem change
    src: /tiles/ecoscapes/ecosystem-change/2022.pmtiles
    source: TerrAdapt-Cascadia
    opacity: 0.8
    kind: continuous
    theme: 01-biodiversity-conservation
    subtheme: 01-02-ecosystem-risk
    about: How much the land's ecosystems had changed by 2022.
    legend:
      - { colour: '#7f3b08', label: Decline }
      - { colour: '#b35806', label: '' }
      - { colour: '#e08214', label: '' }
      - { colour: '#fdb863', label: '' }
      - { colour: '#fee0b6', label: '' }
      - { colour: '#f7f7f7', label: Little change }
      - { colour: '#d8daeb', label: '' }
      - { colour: '#b2abd2', label: '' }
      - { colour: '#8073ac', label: '' }
      - { colour: '#542788', label: '' }
      - { colour: '#2d004b', label: Gain }
  - id: mean-annual-temperature
    name: Mean annual temperature
    src: /tiles/ecoscapes/mean-annual-temperature/2020.pmtiles
    source: TerrAdapt-Cascadia
    opacity: 0.8
    kind: continuous
    theme: 04-climate-change-refugia
    subtheme: 04-01-climate-refugia
    about: The average temperature over a year, as a thirty-year norm, for 2020.
    legend:
      - { colour: '#042333', label: 0.6 °C }
      - { colour: '#2c3395', label: '' }
      - { colour: '#744992', label: '' }
      - { colour: '#b15f82', label: '' }
      - { colour: '#eb7958', label: '' }
      - { colour: '#fbb43d', label: '' }
      - { colour: '#e8fa5b', label: 11.6 °C }
# Headings the layer list needs that the portal's own list does not have.
subthemes:
  - theme: 05-connectivity-network
    id: 05-01-habitat-cores
    name: Habitat Cores
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
