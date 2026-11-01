#!/usr/bin/env node
/**
 * Live probe for travel search providers. Reads env only (never prints secret values).
 * Usage: TRAVELPAYOUTS_TOKEN=… SERPAPI_API_KEY=… node scripts/probe-travel-live.mjs
 */
const token = process.env.TRAVELPAYOUTS_TOKEN;
const serpKey = process.env.SERPAPI_API_KEY;

async function probeFlights() {
  if (!token) return { skipped: true, reason: 'TRAVELPAYOUTS_TOKEN unset' };
  const params = new URLSearchParams({
    origin: 'LAX',
    destination: 'ORD',
    departure_at: '2027-07-16',
    return_at: '2027-07-18',
    currency: 'usd',
    market: 'us',
    sorting: 'price',
    direct: 'false',
    limit: '5',
    one_way: 'false',
    token,
  });
  const res = await fetch(`https://api.travelpayouts.com/aviasales/v3/prices_for_dates?${params}`, {
    headers: { accept: 'application/json', 'accept-encoding': 'gzip, deflate' },
    signal: AbortSignal.timeout(20_000),
  });
  const body = await res.json();
  if (!res.ok || !body.success) return { ok: false, status: res.status, error: body.error ?? 'request failed' };
  return { ok: true, count: body.data?.length ?? 0, samplePriceUsd: body.data?.[0]?.price ?? null };
}

async function probeHotels() {
  if (!serpKey) return { skipped: true, reason: 'SERPAPI_API_KEY unset' };
  const params = new URLSearchParams({
    engine: 'google_hotels',
    q: 'Chicago Athletic Association Hotel, Chicago IL',
    check_in_date: '2027-07-16',
    check_out_date: '2027-07-18',
    adults: '2',
    currency: 'USD',
    gl: 'us',
    hl: 'en',
    api_key: serpKey,
  });
  const res = await fetch(`https://serpapi.com/search.json?${params}`, { signal: AbortSignal.timeout(30_000) });
  const body = await res.json();
  if (!res.ok || body.error) return { ok: false, status: res.status, error: body.error ?? 'request failed' };
  const first = body.properties?.[0];
  return {
    ok: true,
    count: body.properties?.length ?? 0,
    firstName: first?.name ?? null,
    totalUsd: first?.total_rate?.extracted_lowest ?? null,
  };
}

const flights = await probeFlights();
const hotels = await probeHotels();
console.log(JSON.stringify({ flights, hotels }, null, 2));
const ok = (flights.skipped || flights.ok) && (hotels.skipped || hotels.ok);
process.exit(ok ? 0 : 1);
