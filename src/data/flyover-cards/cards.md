# Data Sandbox: while the flight is made

The cards shown in turn while a flyover is made into a video, in the order
written here, round again if the video takes longer than all of them.

How to edit:

- Put each picture in this folder (`src/data/flyover-cards/`), next to this
  file: a JPEG, PNG or WebP, landscape, any size. Name it plainly, e.g.
  `squamish-estuary.jpg`. Then run `node tools/prepare-flyover-cards.mjs`,
  which turns it into a WebP no wider than 2000 px (and changes its name
  here to match), so the repo stays small.
- Each card is a `##` heading with its title, then these lines, then its text:
  - `Image: squamish-estuary.jpg` -- the file name exactly as it is in this
    folder. A name with no file stops the site build, so a typo shows up
    straight away. Leave the line out for a card with no picture.
  - `Seconds: 8` -- how long the card stays on screen. Left out, 8.
- The text: plain text, one or more short paragraphs. Two or three sentences
  read comfortably in 8 seconds.

For example (without the four spaces in front of each line):

    ## Where the river meets the sea
    Image: squamish-estuary.jpg
    Seconds: 10

    The Squamish estuary ...

The cards:

## The Eagle
Image: eagle.webp
Seconds: 10

The Eagle soars high and surveys the landscape. Take a moment to observe the place around you from the perspective of the Eagle, and situate yourself in this incredible landscape.

## The Raven
Image: raven.webp
Seconds: 10

In Indigenous lore the Raven is a time shifter, moving freely through time and space, and a trickster who teaches through the stories it tells. Travel through forty years of change like the Raven, then become it: photograph this place and tell us its story as you see it today.

## The Bear
Image: bear.webp
Seconds: 10

The Bear is on the ground, connected to the landscape. Explore like the Bear: find where you are standing, and look at what the land around you holds.
