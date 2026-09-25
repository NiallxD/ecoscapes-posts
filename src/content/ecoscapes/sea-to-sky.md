---
title: Sea-to-Sky
# The whole EcoScapes study area, Sunshine Coast and Vancouver to past
# Lillooet: what the map opens on when it does not know where you are, or you
# are somewhere else. The widest sensible look at everywhere the portal's
# layers cover, so a layer switched on reads as a whole area rather than a
# sliver of one; once it finds you, it flies in to walking scale.
bounds: [[-124.69, 48.94], [-121.43, 51.26]]
# The map's area: the basemap is cut to this box (tools/extract-basemap.sh,
# BBOX=... MAXZOOM=13 OUT_FILE=basemap-study.pmtiles), the map draws its edge
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
  title: The Bear
  # The hero of this animal's page (portrait, under public/).
  image: /media/animals/bear.jpg
  body: >-
    The Bear is on the ground, connected to the landscape. Explore like the
    Bear: find where you are standing, and look at what the land around you
    holds.
# The portal's layers themselves come from src/data/ecoscapes-layers.json.
# Anything here with a portal layer's id is laid over that layer: which ones
# are on when the map opens, and the words for standing in one. Anything
# else is a layer of this site's own, stacked over the portal's in this order
# (the last on top), and needs its name, file and place in the list.
layers:
  - id: connectivity-linkages
    on: true
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
  # From the GeoPackage, burned to a raster: tools/rasterize-polygons.sh
  # <gpkg> <tif> 112,168,0, then tools/prepare-layer.sh <tif> habitat-cores
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
