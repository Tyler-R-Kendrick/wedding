# The Paired timeline → Our Story

Sara and Tyler kept their relationship timeline in the Paired app. That timeline
is the content of the `/our-story` ride: every entry becomes a **station**, every
story chapter is a **line**, and the train changes line where the story changes
chapter. Until the export arrives the line runs on labelled placeholders — the
places the brief already names, undated, with openly licensed stand-in photos.

## 1. Get the export out of Paired

Whatever Paired gives you works: a JSON file, a CSV, or a folder holding one of
those plus the photos it names. Screenshots also work — hand them to Claude and
ask for a CSV with `date,title,note,location,photo` columns first.

Put it anywhere **outside** `public/` (for example `~/paired-export/`).

## 2. Dry run

```bash
npm run timeline:import -- ~/paired-export
```

Nothing is written. It prints one line per station: the date it read, the line
(chapter) it chose, and why. Dates are kept only as precise as Paired had them
(`2023-05` stays a month). Anything it could not read is listed, never guessed.

Lines come from the milestones Paired names in words ("we met", "first date",
"I love you", "moved in", "engaged"); every entry between two milestones rides
the line of the one before it, so the train never goes backwards. Pin any stop
that landed on the wrong line:

```bash
npm run timeline:import -- ~/paired-export --chapters "museum-of-ice-cream=relationship,paired:abc123=love"
```

## 3. Write it

```bash
npm run timeline:import -- ~/paired-export --write                 # words and dates only
npm run timeline:import -- ~/paired-export --write --with-photos   # …and the photos
npm run db:seed
```

- **Photos are opt-in because this repository is public.** With `--with-photos`
  the first photo of each entry is re-encoded (EXIF and GPS stripped) into
  `public/media/timeline/` and replaces the stand-in. Without it, stand-ins stay.
- A stand-in station whose title matches an imported one (e.g. "Starved Rock") is
  replaced by it and keeps its link to Our Adventures. Stand-ins nothing matched
  are kept and listed; delete them in `src/content/seed/timeline.json` or in
  `/admin/content/timeline_moments`.
- Re-running the import updates the same stations (each keeps `paired:<id>`).
  `db:seed` never overwrites a station someone edited in `/admin/content`.

Close backlog item C-11 when the ride reads true end to end.
