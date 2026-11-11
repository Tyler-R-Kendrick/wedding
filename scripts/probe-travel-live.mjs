#!/usr/bin/env node
/**
 * Keyless live probe for travel search (no API keys). Uses the same adapters as production.
 * Usage: node --import tsx scripts/probe-travel-live.mjs
 */
import { GoogleTravelFlights } from '../src/providers/flights/google-travel-flights.ts';
import { GoogleTravelHotels } from '../src/providers/hotels/google-travel-hotels.ts';

const flightReq = {
  origin: process.argv[2] ?? 'LAX',
  destination: 'ORD',
  departDate: '2027-07-16',
  returnDate: '2027-07-18',
  adults: Number(process.argv[3] ?? 4),
};

const hotelReq = {
  checkIn: '2027-07-16',
  checkOut: '2027-07-18',
  adults: Number(process.argv[3] ?? 4),
};

async function probeFlights() {
  const p = new GoogleTravelFlights();
  const r = await p.search(flightReq);
  if (!r.ok) return { ok: false, error: r.error.message, class: r.error.class };
  const cheapest = r.value.data[0];
  return {
    ok: true,
    count: r.value.data.length,
    cheapestUsd: cheapest?.priceCents != null ? cheapest.priceCents / 100 : null,
    carrier: cheapest?.carrier ?? null,
    retrievedAt: r.value.retrievedAt,
  };
}

async function probeHotels() {
  const p = new GoogleTravelHotels();
  const r = await p.search(hotelReq);
  if (!r.ok) return { ok: false, error: r.error.message, class: r.error.class };
  const priced = r.value.data.filter((h) => h.totalCents != null);
  const cheapest = priced[0];
  return {
    ok: true,
    count: r.value.data.length,
    pricedCount: priced.length,
    cheapestUsd: cheapest?.totalCents != null ? cheapest.totalCents / 100 : null,
    name: cheapest?.name ?? null,
    retrievedAt: r.value.retrievedAt,
  };
}

const flights = await probeFlights();
const hotels = await probeHotels();
console.log(JSON.stringify({ query: { flights: flightReq, hotels: hotelReq }, flights, hotels }, null, 2));
process.exit(flights.ok && hotels.ok ? 0 : 1);
