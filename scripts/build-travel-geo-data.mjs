#!/usr/bin/env node
/**
 * Builds bundled travel geodata from public-domain / CC-BY sources:
 * - OurAirports airports.csv (public domain) → commercial-airports.json
 * - GeoNames US.zip postal codes (CC BY 4.0) → us-postal-centroids.json
 *
 * Run: node scripts/build-travel-geo-data.mjs [/path/to/airports.csv] [/path/to/US.txt]
 */
import { createReadStream, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'src/domain/travel/data');
const airportsPath = process.argv[2] ?? '/tmp/airports.csv';
const usZipPath = process.argv[3] ?? '/tmp/US.txt';

const COMMERCIAL_TYPES = new Set(['large_airport', 'medium_airport', 'small_airport']);

function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      q = !q;
      continue;
    }
    if (c === ',' && !q) {
      out.push(cur);
      cur = '';
      continue;
    }
    cur += c;
  }
  out.push(cur);
  return out;
}

async function readAirports() {
  const rl = createInterface({ input: createReadStream(airportsPath), crlfDelay: Infinity });
  let header = null;
  const airports = [];
  for await (const line of rl) {
    if (!header) {
      header = parseCsvLine(line);
      continue;
    }
    const row = parseCsvLine(line);
    const rec = Object.fromEntries(header.map((h, i) => [h, row[i] ?? '']));
    if (!rec.iata_code || rec.iata_code.length !== 3) continue;
    if (rec.scheduled_service !== 'yes') continue;
    if (!COMMERCIAL_TYPES.has(rec.type)) continue;
    const lat = Number(rec.latitude_deg);
    const lon = Number(rec.longitude_deg);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    airports.push({
      iata: rec.iata_code.toUpperCase(),
      name: rec.name,
      lat,
      lon,
      country: rec.iso_country,
      municipality: rec.municipality || undefined,
    });
  }
  airports.sort((a, b) => a.iata.localeCompare(b.iata));
  return airports;
}

async function readUsZips() {
  const rl = createInterface({ input: createReadStream(usZipPath), crlfDelay: Infinity });
  /** @type {Map<string, { lat: number; lon: number; region?: string }>} */
  const byZip = new Map();
  for await (const line of rl) {
    const [country, postal, , admin1, , , , , , latS, lonS] = line.split('\t');
    if (country !== 'US' || !postal) continue;
    const zip = postal.trim().slice(0, 5);
    if (!/^\d{5}$/.test(zip)) continue;
    const lat = Number(latS);
    const lon = Number(lonS);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    if (!byZip.has(zip)) byZip.set(zip, { lat, lon, region: admin1 || undefined });
  }
  return Object.fromEntries([...byZip.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

const airports = await readAirports();
const zips = await readUsZips();

writeFileSync(join(outDir, 'commercial-airports.json'), `${JSON.stringify({ schema: 1, source: 'OurAirports (public domain)', airports })}\n`);
writeFileSync(
  join(outDir, 'us-postal-centroids.json'),
  `${JSON.stringify({ schema: 1, source: 'GeoNames US postal codes (CC BY 4.0)', zips })}\n`,
);

console.log(`Wrote ${airports.length} airports and ${Object.keys(zips).length} US ZIP centroids to ${outDir}`);
