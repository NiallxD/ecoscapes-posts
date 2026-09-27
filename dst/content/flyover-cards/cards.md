# Data Sandbox: while the flight is made

The cards shown in turn while a flyover is made into a video, in the order
written here, round again if the video takes longer than all of them.

How to edit:

- Put each picture in this folder (`dst/content/flyover-cards/`), next to this
  file: a JPEG, PNG or WebP, landscape, any size. Name it plainly, e.g.
  `squamish-estuary.jpg`. Then run `node dst/tools/prepare-flyover-cards.mjs`,
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

## Eagle
Image: eagle.webp
Seconds: 10

Eagles see far more sharply than we do, and from high above they take in a whole valley at once. Look around you and find your place in this landscape.

## Raven
Image: raven.webp
Seconds: 10

Ravens are among the cleverest birds. They remember places and faces for years, and notice when something has changed. Look back over forty years of change here, then add what you see today: photograph this place and tell us about it.

## Bear
Image: bear.webp
Seconds: 10

Bears know their ground up close. They cover long distances on foot and read the land by smell as much as by sight. Find where you are standing, and see what the land around you holds.
