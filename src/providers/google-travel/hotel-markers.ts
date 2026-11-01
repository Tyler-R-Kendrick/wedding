import { asArray, asNumber, asString, isCoordinate, parseUsdPrice } from './json-utils';
import type { DecodedRpcPayload } from './batchexecute';

export interface GoogleHotelMarker {
  name: string;
  priceDisplay: string;
  totalUsd?: number;
  latitude: number;
  longitude: number;
  entityToken: string | null;
  bookingUrl: string | null;
  sponsored: boolean;
}

function isHotelMapRow(value: unknown): value is unknown[] {
  return (
    Array.isArray(value) &&
    asString(value[0]) !== null &&
    asString(value[2]) !== null &&
    /^\$[\d,]+/.test(String(value[2])) &&
    asNumber(value[4]) !== null &&
    asNumber(value[5]) !== null &&
    isCoordinate(value[16])
  );
}

function collectRows(value: unknown, rows: unknown[][], seen: Set<unknown>): void {
  if (!Array.isArray(value)) {
    if (value && typeof value === 'object') {
      for (const child of Object.values(value)) collectRows(child, rows, seen);
    }
    return;
  }
  if (isHotelMapRow(value)) {
    if (!seen.has(value)) {
      seen.add(value);
      rows.push(value);
    }
    return;
  }
  for (const child of value) collectRows(child, rows, seen);
}

function isServerHotelRecord(value: unknown): value is unknown[] {
  if (!Array.isArray(value) || asString(value[1]) === null) return false;
  const token = asString(value[20]);
  return token !== null && token.length >= 8;
}

function collectServerRecords(value: unknown, records: unknown[][]): void {
  if (Array.isArray(value)) {
    if (isServerHotelRecord(value)) {
      records.push(value);
      return;
    }
    for (const child of value) collectServerRecords(child, records);
  } else if (value && typeof value === 'object') {
    for (const child of Object.values(value)) collectServerRecords(child, records);
  }
}

function toAbsoluteUrl(raw: unknown): string | null {
  const s = asString(raw);
  if (!s) return null;
  if (s.startsWith('http')) return s;
  if (s.startsWith('/')) return `https://www.google.com${s}`;
  return null;
}

export function extractHotelMapMarkers(payloads: DecodedRpcPayload[]): GoogleHotelMarker[] {
  const rows: unknown[][] = [];
  const seen = new Set<unknown>();
  for (const decoded of payloads) collectRows(decoded.payload, rows, seen);
  const markers: GoogleHotelMarker[] = rows.map((row) => {
    const coordinate = row[16] as [number, number];
    const _state = asArray(row[19]);
    const priceDisplay = String(row[2]);
    return {
      name: String(row[0]),
      priceDisplay,
      totalUsd: parseUsdPrice(priceDisplay),
      latitude: coordinate[0],
      longitude: coordinate[1],
      entityToken: asString(row[13]),
      bookingUrl: toAbsoluteUrl(row[1]),
      sponsored: typeof row[1] === 'string' && String(row[1]).startsWith('/aclk'),
    };
  });

  const serverRecords: unknown[][] = [];
  for (const decoded of payloads) collectServerRecords(decoded.payload, serverRecords);
  for (const record of serverRecords) {
    const name = asString(record[1]);
    if (!name) continue;
    const priceTuple = asArray(asArray(record[6])[2]);
    const priceStr = asString(priceTuple[0]) ?? asString(asArray(record[3])[0]);
    if (!priceStr || !/^\$/.test(priceStr)) continue;
    markers.push({
      name,
      priceDisplay: priceStr,
      totalUsd: parseUsdPrice(priceStr),
      latitude: 41.8817,
      longitude: -87.6245,
      entityToken: asString(record[20]),
      bookingUrl: null,
      sponsored: false,
    });
  }
  return markers;
}

export interface GoogleHotelEntityRow {
  name: string;
  priceDisplay: string | null;
  totalUsd?: number;
}

export function extractHotelLeadTokens(payloads: DecodedRpcPayload[]): Array<{ name: string; entityToken: string }> {
  const records: unknown[][] = [];
  for (const decoded of payloads) collectServerRecords(decoded.payload, records);
  const out: Array<{ name: string; entityToken: string }> = [];
  const seen = new Set<string>();
  for (const record of records) {
    const name = asString(record[1]);
    const entityToken = asString(record[20]);
    if (!name || !entityToken || entityToken.length < 8) continue;
    const key = entityToken;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name, entityToken });
  }
  return out;
}

export function extractHotelEntities(payloads: DecodedRpcPayload[]): GoogleHotelEntityRow[] {
  const out: GoogleHotelEntityRow[] = [];
  for (const decoded of payloads) {
    collectServerRecords(decoded.payload, []);
  }
  const records: unknown[][] = [];
  for (const decoded of payloads) collectServerRecords(decoded.payload, records);
  for (const record of records) {
    const name = asString(record[1]);
    if (!name) continue;
    const priceSection = asArray(record[6]);
    const priceData = asArray(priceSection[2]);
    const offers = asArray(priceData[2]);
    let best: string | null = null;
    for (const rawOffer of offers) {
      const offer = asArray(rawOffer);
      const tuple = asArray(asArray(offer[12])[4]);
      const display = asString(tuple[0]);
      if (display && /^\$/.test(display)) best = display;
    }
    if (!best) {
      const fallback = asString(asArray(record[3])[0]);
      if (fallback && /^\$/.test(fallback)) best = fallback;
    }
    out.push({ name, priceDisplay: best, totalUsd: parseUsdPrice(best) });
  }
  return out;
}
