#!/usr/bin/env node
/**
 * Import Sara and Tyler's Paired timeline into the Our Story line.
 *
 *   node scripts/import-paired.mjs <export.json | export.csv | folder>            # dry run: prints the plan, writes nothing
 *   node scripts/import-paired.mjs <export> --write                               # rewrites src/content/seed/timeline.json
 *   node scripts/import-paired.mjs <export> --write --with-photos                 # …and publishes the photos (see below)
 *   Options: --chapters "<externalRef or slug>=<chapter>,…"   pin a stop to a line when the inference is wrong
 *
 * Then `npm run db:seed` (idempotent; never overwrites a row edited in /admin/content) and look at /our-story.
 *
 * What it accepts. Paired has no documented export format, so this reads whatever arrives: a JSON array
 * (or an object holding one under timeline/items/events/moments/entries/memories), a CSV with a header
 * row, or a folder holding one of those plus the photos it names. Column names are matched loosely:
 * date|when|day|occurred|created · title|name|milestone|event|headline · note|description|text|caption|
 * story|body · location|place|where · photo|image|media|file|photos · id|uuid · chapter|line.
 * Anything it cannot read is reported, never guessed.
 *
 * Chapters. Each stop rides one line (a story chapter). An explicit chapter column wins; otherwise the
 * milestones Paired names in words set it — "met", "first date", "I love you", "moved in", "engaged" —
 * and every stop in between rides the line of the milestone before it, so the line only ever moves
 * forward (met → connection → life together → love → future → engagement → marriage). The plan
 * prints every assignment with its reason; pin any with --chapters.
 *
 * Photos. This repository is public. A photo imported with --with-photos becomes a public file in
 * it (EXIF and GPS are stripped on re-encode). Without the flag the stops import with their words and
 * dates only, and the stand-in photographs stay where they were — say which you want.
 *
 * Merging. A stop that already came from Paired (same `externalRef`) is updated in place. A stand-in
 * stop whose title matches an imported one ("Starved Rock") is replaced by it and keeps its link to
 * Our Adventures. Stand-ins nothing matched are kept and listed, so a person decides what goes.
 */
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SEED = join(ROOT, 'src', 'content', 'seed', 'timeline.json');
const STORY = join(ROOT, 'src', 'content', 'seed', 'story.json');

export const CHAPTERS = ['met', 'connection', 'relationship', 'love', 'future', 'engagement', 'marriage'];
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const TODO = 'TODO(Tyler & Sara)';
/** Anchors the page owns outside the timeline: the terminal. */
export const RESERVED_SLUGS = ['the-loop'];

/** Milestones named in words, in line order. The first that matches a stop's title/note sets its line. */
const MILESTONES = [
  { chapter: 'engagement', re: /\b(engaged|engagement|proposal|proposed|said yes|she said yes|ring)\b/i },
  { chapter: 'future', re: /\b(moved in|move in|new home|our (first )?(home|house|apartment|place)|bought a house|keys|adopted|puppy|kitten)\b/i },
  { chapter: 'love', re: /\b(i love you|said love|first love|in love)\b/i },
  { chapter: 'relationship', re: /\b(official|exclusive|boyfriend|girlfriend|dating|anniversary|first trip|first vacation)\b/i },
  { chapter: 'connection', re: /\b(first date|first kiss|asked (her|him) out|first dinner|second date)\b/i },
  { chapter: 'met', re: /\b(met|meet|first saw|first sight|how we met)\b/i },
];

const ALIASES = {
  id: ['id', 'uuid', 'guid', 'key', 'memory_id', 'event_id'],
  date: ['date', 'when', 'day', 'occurred', 'occurred_on', 'occurredon', 'date_time', 'datetime', 'timestamp', 'created', 'created_at', 'createdat'],
  title: ['title', 'name', 'milestone', 'event', 'headline', 'label', 'moment'],
  note: ['note', 'notes', 'description', 'text', 'caption', 'story', 'body', 'details', 'memory'],
  location: ['location', 'place', 'where', 'venue', 'city'],
  photo: ['photo', 'photos', 'image', 'images', 'media', 'file', 'files', 'picture', 'pictures', 'attachment', 'attachments'],
  chapter: ['chapter', 'line'],
};

const norm = (k) => String(k).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
export const slugify = (s) =>
  String(s)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '') || 'stop';

/** Minimal RFC 4180 CSV: quoted fields, doubled quotes, CR/LF. First row is the header. */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      if (row.some((f) => f.trim() !== '')) rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== '')) rows.push(row);
  const [header = [], ...body] = rows;
  return body.map((r) => Object.fromEntries(header.map((h, i) => [h.replace(/^﻿/, '').trim(), (r[i] ?? '').trim()])));
}

/**
 * "2021-06-12", "2021-06", "2021", "6/12/2021", "June 12, 2021", "12 June 2021", "June 2021", epoch
 * seconds or ms, full ISO instants (the calendar day in America/Chicago). Returns the partial date the
 * input actually carries, or null. Never pads a month or a year into a day.
 */
export function parsePartialDate(input) {
  if (input == null || input === '') return null;
  if (typeof input === 'number' || /^\d{10,13}$/.test(String(input).trim())) {
    const n = Number(input);
    return chicagoDay(new Date(n < 1e12 ? n * 1000 : n));
  }
  const s = String(input).trim();
  let m;
  // A bare date exported as an instant ("2022-06-04T00:00:00.000Z") is a calendar day, not a moment:
  // moving it into Chicago would print June 3. Only a real time of day is read in Chicago.
  if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})T00:00(?::00(?:\.0+)?)?(?:Z|[+-]00:?00)?$/))) return ymd(m[1], m[2], m[3]);
  if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})T/))) return chicagoDay(new Date(s)) ?? `${m[1]}-${m[2]}-${m[3]}`;
  if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) return ymd(m[1], m[2], m[3]);
  if ((m = s.match(/^(\d{4})-(\d{1,2})$/))) return ym(m[1], m[2]);
  if ((m = s.match(/^(\d{4})$/))) return m[1];
  if ((m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/))) return ymd(m[3].length === 2 ? `20${m[3]}` : m[3], m[1], m[2]);
  const month = (w) => MONTHS.findIndex((x) => x.startsWith(w.toLowerCase().slice(0, 3))) + 1;
  if ((m = s.match(/^([A-Za-z]+)\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/)) && month(m[1])) return ymd(m[3], month(m[1]), m[2]);
  if ((m = s.match(/^(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+)\.?,?\s+(\d{4})$/)) && month(m[2])) return ymd(m[3], month(m[2]), m[1]);
  if ((m = s.match(/^([A-Za-z]+)\.?,?\s+(\d{4})$/)) && month(m[1])) return ym(m[2], month(m[1]));
  return null;
}
const pad = (n) => String(n).padStart(2, '0');
function ymd(y, mo, d) {
  const date = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));
  if (date.getUTCMonth() !== Number(mo) - 1 || date.getUTCDate() !== Number(d)) return null;
  return `${y}-${pad(mo)}-${pad(d)}`;
}
const ym = (y, mo) => (Number(mo) >= 1 && Number(mo) <= 12 ? `${y}-${pad(mo)}` : null);
function chicagoDay(date) {
  if (Number.isNaN(date.getTime())) return null;
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

function pick(record, key) {
  const wanted = new Set(ALIASES[key]);
  for (const [k, v] of Object.entries(record)) if (wanted.has(norm(k)) && v != null && v !== '') return v;
  return undefined;
}

function photosOf(v) {
  if (v == null || v === '') return [];
  if (Array.isArray(v)) return v.flatMap(photosOf);
  if (typeof v === 'object') return photosOf(v.path ?? v.file ?? v.filename ?? v.url ?? v.src);
  return String(v)
    .split(/[;|]/)
    .map((x) => x.trim())
    .filter(Boolean);
}

/** Reads an export (file or folder) into raw records plus the folder photos are relative to. */
export function readExport(path) {
  const abs = resolve(path);
  if (!existsSync(abs)) throw new Error(`${path}: not found`);
  let file = abs;
  if (statSync(abs).isDirectory()) {
    const data = readdirSync(abs).filter((f) => /\.(json|csv)$/i.test(f));
    if (data.length !== 1) throw new Error(`${path}: expected exactly one .json or .csv in the folder, found ${data.length ? data.join(', ') : 'none'}`);
    file = join(abs, data[0]);
  }
  const text = readFileSync(file, 'utf8');
  let records;
  if (extname(file).toLowerCase() === '.csv') records = parseCsv(text);
  else {
    const json = JSON.parse(text);
    records = Array.isArray(json) ? json : (['timeline', 'items', 'events', 'moments', 'entries', 'memories', 'data'].map((k) => json[k]).find(Array.isArray) ?? null);
    if (!records) throw new Error(`${file}: no array of entries found (looked at the top level and under timeline/items/events/moments/entries/memories/data)`);
  }
  return { records, baseDir: dirname(file), file };
}

/** Raw records → normalized stops, in date order (undated stops keep their place after the dated ones). */
export function normalize(records) {
  const problems = [];
  const stops = [];
  records.forEach((r, i) => {
    const title = String(pick(r, 'title') ?? '').trim();
    if (!title) {
      problems.push(`entry ${i + 1}: no title — skipped`);
      return;
    }
    if (title.length < 2) {
      problems.push(`entry ${i + 1} "${title}": a station name needs at least two characters — skipped`);
      return;
    }
    const rawDate = pick(r, 'date');
    const occurredOn = parsePartialDate(rawDate);
    if (rawDate != null && rawDate !== '' && !occurredOn) problems.push(`entry ${i + 1} "${title}": could not read the date "${rawDate}" — imported undated`);
    const id = pick(r, 'id');
    const chapter = pick(r, 'chapter');
    stops.push({
      index: i,
      title: title.slice(0, 80),
      occurredOn,
      note: String(pick(r, 'note') ?? '').trim(),
      locationLabel: String(pick(r, 'location') ?? '').trim().slice(0, 120) || undefined,
      photos: photosOf(pick(r, 'photo')),
      chapter: chapter && CHAPTERS.includes(norm(chapter)) ? norm(chapter) : undefined,
      externalRef: `paired:${id != null && id !== '' ? String(id).replace(/[^A-Za-z0-9._-]/g, '-').slice(0, 120) : `${occurredOn ?? 'undated'}-${slugify(title)}`}`,
    });
  });
  // Two id-less entries with the same title and date would share a ref; the second gets a suffix.
  const refs = new Set();
  for (const stop of stops) {
    let ref = stop.externalRef;
    for (let n = 2; refs.has(ref); n++) ref = `${stop.externalRef}-${n}`;
    refs.add(ref);
    stop.externalRef = ref;
  }
  stops.sort((a, b) => (a.occurredOn && b.occurredOn ? a.occurredOn.localeCompare(b.occurredOn) || a.index - b.index : a.occurredOn ? -1 : b.occurredOn ? 1 : a.index - b.index));
  return { stops, problems };
}

/**
 * Assigns each stop its line. Explicit chapter or --chapters pin > a milestone named in words > the line
 * of the previous stop. The line never moves backwards: a later stop that mentions "met" stays on the
 * line it is already on. Returns the reason for every assignment so the plan can show it.
 */
export function assignChapters(stops, pins = {}) {
  let current = 'met';
  return stops.map((s) => {
    const pinned = pins[s.externalRef] ?? pins[slugify(s.title)] ?? s.chapter;
    let chapter;
    let reason;
    if (pinned) {
      chapter = pinned;
      reason = 'pinned';
    } else {
      const hit = MILESTONES.find((m) => m.re.test(`${s.title} ${s.note}`));
      if (hit && CHAPTERS.indexOf(hit.chapter) >= CHAPTERS.indexOf(current)) {
        chapter = hit.chapter;
        reason = `milestone "${`${s.title} ${s.note}`.match(hit.re)[0]}"`;
      } else {
        chapter = current;
        reason = 'follows the previous stop';
      }
    }
    if (CHAPTERS.indexOf(chapter) > CHAPTERS.indexOf(current)) current = chapter;
    return { ...s, chapter, reason };
  });
}

/**
 * Merges imported stops into the existing seed rows. Returns the new rows (in order) and a report.
 * `now` is the import instant written to verifiedAt.
 */
export function merge(existing, imported, { now, storySlugs = new Set(), photoSrc = () => undefined }) {
  const byRef = new Map(existing.filter((r) => r.externalRef).map((r) => [r.externalRef, r]));
  const standIns = new Map(existing.filter((r) => !r.externalRef).map((r) => [slugify(r.title), r]));
  const used = new Set();
  // A stop that already exists keeps its slug (links and citations point at it), so every existing
  // slug is reserved before a new stop is named; so are the chapters' anchors and the terminal's.
  const priors = imported.map((s) => byRef.get(s.externalRef) ?? standIns.get(slugify(s.title)));
  const taken = new Set([...storySlugs, ...RESERVED_SLUGS, ...existing.map((r) => r.slug)]);
  const report = { updated: [], replaced: [], added: [], keptStandIns: [] };
  const rows = [];
  for (const [i, s] of imported.entries()) {
    const prior = priors[i];
    if (prior) used.add(prior);
    let slug = prior?.slug;
    if (!slug) {
      const base = slugify(s.title);
      slug = base;
      for (let n = 2; taken.has(slug); n++) slug = `${base}-${n}`;
      taken.add(slug);
    }
    const src = photoSrc(s, slug);
    const media = src ? [{ alt: src.alt, src: src.src }] : (prior?.media ?? []);
    const note = s.note || `${TODO}: a line about this, if you'd like one.`;
    rows.push({
      slug,
      chapter: s.chapter,
      order: 0,
      title: s.title,
      ...(s.occurredOn ? { occurredOn: s.occurredOn } : {}),
      ...(s.locationLabel ?? prior?.locationLabel ? { locationLabel: s.locationLabel ?? prior.locationLabel } : {}),
      note: note.slice(0, 600),
      media,
      ...(prior?.adventureSlug ? { adventureSlug: prior.adventureSlug } : {}),
      externalRef: s.externalRef,
      sourceKey: 'paired',
      sourceType: 'authored',
      verifiedAt: now.toISOString(),
      trustClass: 'TRUSTED_WEDDING',
      editedBy: 'import:paired',
      visibility: 'public',
      placeholder: note.includes(TODO),
    });
    (prior ? (prior.externalRef ? report.updated : report.replaced) : report.added).push(slug);
  }
  // Stand-ins nothing matched stay, at the end of their own line, until a person removes them.
  for (const r of existing) {
    if (used.has(r)) continue;
    if (r.externalRef) continue; // a Paired stop missing from this export: dropped, and reported below
    report.keptStandIns.push(r.slug);
    const lastOfLine = rows.map((x) => x.chapter).lastIndexOf(r.chapter);
    const at = lastOfLine >= 0 ? lastOfLine + 1 : rows.findIndex((x) => CHAPTERS.indexOf(x.chapter) > CHAPTERS.indexOf(r.chapter));
    rows.splice(at < 0 ? rows.length : at, 0, r);
  }
  report.dropped = existing.filter((r) => r.externalRef && !imported.some((s) => s.externalRef === r.externalRef)).map((r) => r.slug);
  // The line is ordered by chapter first, then by the order the stops arrived in.
  const ordered = rows
    .map((r, i) => ({ r, i }))
    .sort((a, b) => CHAPTERS.indexOf(a.r.chapter) - CHAPTERS.indexOf(b.r.chapter) || a.i - b.i)
    .map(({ r }, i) => ({ ...r, order: i + 1 }));
  return { rows: ordered, report };
}

function parsePins(v) {
  if (!v) return {};
  return Object.fromEntries(
    v.split(',').map((pair) => {
      const [k, c] = pair.split('=').map((x) => x.trim());
      if (!CHAPTERS.includes(c)) throw new Error(`--chapters: "${c}" is not one of ${CHAPTERS.join(', ')}`);
      return [k, c];
    }),
  );
}

async function main() {
  const args = process.argv.slice(2);
  const flag = (n) => {
    const i = args.indexOf(`--${n}`);
    if (i < 0) return false;
    args.splice(i, 1);
    return true;
  };
  const opt = (n) => {
    const i = args.indexOf(`--${n}`);
    if (i < 0) return undefined;
    const v = args[i + 1];
    args.splice(i, 2);
    return v;
  };
  const write = flag('write');
  const withPhotos = flag('with-photos');
  const pins = parsePins(opt('chapters'));
  const [path] = args;
  if (!path) {
    console.error('Usage: node scripts/import-paired.mjs <export.json|export.csv|folder> [--write] [--with-photos] [--chapters "ref=chapter,…"]');
    return 2;
  }
  const { records, baseDir, file } = readExport(path);
  const { stops, problems } = normalize(records);
  const assigned = assignChapters(stops, pins);
  const existing = JSON.parse(readFileSync(SEED, 'utf8'));
  const storySlugs = new Set(JSON.parse(readFileSync(STORY, 'utf8')).map((s) => s.slug));

  const photoJobs = [];
  const photoSrc = (s, slug) => {
    if (!withPhotos || !s.photos.length) return undefined;
    const input = resolve(baseDir, s.photos[0]);
    if (!existsSync(input)) {
      problems.push(`"${s.title}": photo ${s.photos[0]} not found next to ${basename(file)}`);
      return undefined;
    }
    photoJobs.push({ input, slug, title: s.title });
    // The real path is known after encoding; the largest JPEG is always <slug>-<width>.jpg.
    return { src: `/media/timeline/${slug}.pending`, alt: `Photo from our Paired timeline: ${s.title}.` };
  };
  const { rows, report } = merge(existing, assigned, { now: new Date(), storySlugs, photoSrc });

  console.log(`Read ${records.length} entr${records.length === 1 ? 'y' : 'ies'} from ${file}\n`);
  for (const s of assigned) console.log(`  ${(s.occurredOn ?? 'undated').padEnd(10)}  ${s.chapter.padEnd(12)} ${s.title}  — ${s.reason}`);
  console.log(`\nupdated ${report.updated.length} · replaced stand-ins ${report.replaced.length} · added ${report.added.length}`);
  if (report.keptStandIns.length) console.log(`kept stand-ins nothing matched (delete them in the seed or /admin if they are not stops): ${report.keptStandIns.join(', ')}`);
  if (report.dropped.length) console.log(`no longer in the export, removed: ${report.dropped.join(', ')}`);
  if (!withPhotos && assigned.some((s) => s.photos.length)) console.log('photos named in the export were NOT imported (the repository is public); re-run with --with-photos to publish them');
  for (const p of problems) console.warn(`! ${p}`);
  if (!write) {
    console.log('\nDry run — nothing written. Re-run with --write.');
    return 0;
  }

  if (photoJobs.length) {
    const { derivePhoto, readManifest, writeManifest } = await import('./timeline-media.mjs');
    const manifest = readManifest();
    for (const job of photoJobs) {
      const derived = await derivePhoto(job.input, job.slug);
      const row = rows.find((r) => r.slug === job.slug);
      row.media = [{ alt: row.media[0].alt, src: derived.src }];
      manifest.items = manifest.items.filter((i) => i.id !== `timeline.${job.slug}`);
      manifest.items.push({ id: `timeline.${job.slug}`, ...derived, standIn: false, sourceType: 'couple-photo', alt: row.media[0].alt, ledger: null, license: null, credit: null, creditUrl: null });
      console.log(`  ✓ photo ${job.slug} → ${derived.src}`);
    }
    writeManifest(manifest);
  }
  writeFileSync(SEED, `${JSON.stringify(rows, null, 2)}\n`);
  console.log(`\nWrote ${rows.length} stops to src/content/seed/timeline.json. Next: npm run db:seed, then open /our-story.`);
  return 0;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) process.exit(await main());
