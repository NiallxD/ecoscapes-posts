---
title: Sea-to-Sky
# The whole EcoScapes study area, Sunshine Coast and Vancouver to past
# Lillooet: what the map opens on. Unlike /explore/'s corridor page, this is
# not a walking-scale view -- it is the widest sensible look at everywhere
# the portal's layers cover, so a layer switched on reads as a whole area
# rather than a sliver of one.
bounds: [[-124.69, 48.94], [-121.43, 51.26]]
# The map's area: the basemap is cut to this box (tools/extract-basemap.sh,
# BBOX=... MAXZOOM=13 OUT_FILE=basemap-study.pmtiles), the map draws its edge
# along it, and pans a little past it so the edge can be seen. The union of
# every EcoScapes layer's own bounding box (excluding the ETOPO backdrop),
# rounded outward to 2 decimals.
limit: [[-124.69, 48.94], [-121.43, 51.26]]
# The basemap for this map: the whole study area above, not /explore/'s
# corridor file -- the two pages read different files because one covers
# about three times the ground of the other.
basemap: /tiles/basemap-study.pmtiles
# Magnetic declination, degrees east: about 16 across the corridor, and close
# enough across the wider study area that a second figure is not worth
# carrying -- the cone is a rough sense of facing, not a bearing anyone reads
# precisely.
declination: 16
# The line under the title, while this is still a skeleton rather than the
# real interface. Draft -- for Murray.
intro: >-
  All of the EcoScapes map portal's data, on one map: turn on a layer to see
  what it shows.
---
