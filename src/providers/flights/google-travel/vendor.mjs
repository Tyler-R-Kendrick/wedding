// src/protobuf.ts
var encoder = new TextEncoder();
var VARINT = 0;
var LEN = 2;
var TAG_AIRPORT_AIRPORT = 2 << 3 | LEN;
var TAG_FD_DATE = 2 << 3 | LEN;
var TAG_FD_MAX_STOPS = 5 << 3 | VARINT;
var TAG_FD_AIRLINES = 6 << 3 | LEN;
var TAG_FD_FROM = 13 << 3 | LEN;
var TAG_FD_TO = 14 << 3 | LEN;
var TAG_INFO_DATA = 3 << 3 | LEN;
var TAG_INFO_PASSENGERS_PACKED = 8 << 3 | LEN;
var TAG_INFO_SEAT = 9 << 3 | VARINT;
var TAG_INFO_TRIP_B0 = 152;
var TAG_INFO_TRIP_B1 = 1;
function writeVarint(buf, offset, value) {
  while (value > 127) {
    buf[offset++] = value & 127 | 128;
    value >>>= 7;
  }
  buf[offset++] = value;
  return offset;
}
function writeBytes(buf, offset, data) {
  buf.set(data, offset);
  return offset + data.length;
}
function writeString(buf, offset, tag, str) {
  const encoded = encoder.encode(str);
  buf[offset++] = tag;
  offset = writeVarint(buf, offset, encoded.length);
  return writeBytes(buf, offset, encoded);
}
function encodeAirport(buf, offset, airport) {
  const encoded = encoder.encode(airport);
  buf[offset++] = TAG_AIRPORT_AIRPORT;
  offset = writeVarint(buf, offset, encoded.length);
  return writeBytes(buf, offset, encoded);
}
function encodeAirportMsg(airport) {
  const tmp = new Uint8Array(3 + airport.length * 3);
  const len = encodeAirport(tmp, 0, airport);
  return tmp.subarray(0, len);
}
function estimateFlightDataSize(fd) {
  let size = 2 + fd.date.length * 3;
  size += 4;
  if (fd.airlines) {
    for (const a of fd.airlines) size += 3 + a.length * 3;
  }
  size += 2 * (6 + fd.from_airport.length * 3 + fd.to_airport.length * 3);
  return size + 32;
}
function encodeFlightData(buf, offset, fd) {
  offset = writeString(buf, offset, TAG_FD_DATE, fd.date);
  if (fd.max_stops != null) {
    buf[offset++] = TAG_FD_MAX_STOPS;
    offset = writeVarint(buf, offset, fd.max_stops);
  }
  if (fd.airlines) {
    for (const airline of fd.airlines) {
      offset = writeString(buf, offset, TAG_FD_AIRLINES, airline);
    }
  }
  const fromMsg = encodeAirportMsg(fd.from_airport);
  buf[offset++] = TAG_FD_FROM;
  offset = writeVarint(buf, offset, fromMsg.length);
  offset = writeBytes(buf, offset, fromMsg);
  const toMsg = encodeAirportMsg(fd.to_airport);
  buf[offset++] = TAG_FD_TO;
  offset = writeVarint(buf, offset, toMsg.length);
  return writeBytes(buf, offset, toMsg);
}
function encodeInfo(info) {
  let totalSize = 16;
  for (const fd of info.data) {
    totalSize += estimateFlightDataSize(fd) + 6;
  }
  totalSize += info.passengers.length * 2 + 4;
  const buf = new Uint8Array(totalSize);
  let offset = 0;
  for (const fd of info.data) {
    const tmp = new Uint8Array(estimateFlightDataSize(fd));
    const fdLen = encodeFlightData(tmp, 0, fd);
    buf[offset++] = TAG_INFO_DATA;
    offset = writeVarint(buf, offset, fdLen);
    offset = writeBytes(buf, offset, tmp.subarray(0, fdLen));
  }
  if (info.passengers.length > 0) {
    buf[offset++] = TAG_INFO_PASSENGERS_PACKED;
    const packedTmp = new Uint8Array(info.passengers.length * 2);
    let packedLen = 0;
    for (const p of info.passengers) {
      packedLen = writeVarint(packedTmp, packedLen, p);
    }
    offset = writeVarint(buf, offset, packedLen);
    offset = writeBytes(buf, offset, packedTmp.subarray(0, packedLen));
  }
  buf[offset++] = TAG_INFO_SEAT;
  offset = writeVarint(buf, offset, info.seat);
  buf[offset++] = TAG_INFO_TRIP_B0;
  buf[offset++] = TAG_INFO_TRIP_B1;
  offset = writeVarint(buf, offset, info.trip);
  return buf.subarray(0, offset);
}
function encodeInfoToBase64(info) {
  const bytes = encodeInfo(info);
  return Buffer.from(bytes).toString("base64");
}

// src/query.ts
var BASE_URL = "https://www.google.com/travel/flights";
var SEARCH_URL = `${BASE_URL}/search`;
var SEAT_LOOKUP = {
  economy: 1 /* ECONOMY */,
  "premium-economy": 2 /* PREMIUM_ECONOMY */,
  business: 3 /* BUSINESS */,
  first: 4 /* FIRST */
};
var TRIP_LOOKUP = {
  "round-trip": 1 /* ROUND_TRIP */,
  "one-way": 2 /* ONE_WAY */,
  "multi-city": 3 /* MULTI_CITY */
};
var Passengers = class {
  adults;
  children;
  infants_in_seat;
  infants_on_lap;
  constructor(opts = {}) {
    this.adults = opts.adults ?? 0;
    this.children = opts.children ?? 0;
    this.infants_in_seat = opts.infants_in_seat ?? 0;
    this.infants_on_lap = opts.infants_on_lap ?? 0;
    const total = this.adults + this.children + this.infants_in_seat + this.infants_on_lap;
    if (total > 9) throw new Error("Too many passengers (> 9)");
    if (this.infants_on_lap > this.adults) {
      throw new Error("Must have at least one adult per infant on lap");
    }
  }
  toPb() {
    const result = [];
    for (let i = 0; i < this.adults; i++) result.push(1 /* ADULT */);
    for (let i = 0; i < this.children; i++) result.push(2 /* CHILD */);
    for (let i = 0; i < this.infants_in_seat; i++) result.push(3 /* INFANT_IN_SEAT */);
    for (let i = 0; i < this.infants_on_lap; i++) result.push(4 /* INFANT_ON_LAP */);
    return result;
  }
};
var DEFAULT_PASSENGERS = new Passengers({ adults: 1 });
function formatDate(date) {
  if (typeof date === "string") return date;
  return date.toISOString().slice(0, 10);
}
function toFlightData(fq, maxStops) {
  return {
    date: formatDate(fq.date),
    from_airport: fq.from_airport,
    to_airport: fq.to_airport,
    max_stops: fq.max_stops ?? maxStops,
    airlines: fq.airlines
  };
}
var Query = class {
  flightData;
  seat;
  trip;
  passengers;
  language;
  currency;
  constructor(flightData, seat, trip, passengers, language, currency) {
    this.flightData = flightData;
    this.seat = seat;
    this.trip = trip;
    this.passengers = passengers;
    this.language = language;
    this.currency = currency;
  }
  toInfo() {
    return {
      data: this.flightData,
      seat: this.seat,
      passengers: this.passengers,
      trip: this.trip
    };
  }
  toBytes() {
    return encodeInfo(this.toInfo());
  }
  toStr() {
    return encodeInfoToBase64(this.toInfo());
  }
  url() {
    return `${SEARCH_URL}?tfs=${this.toStr()}&hl=${this.language}&curr=${this.currency}`;
  }
  params() {
    return { tfs: this.toStr(), hl: this.language, curr: this.currency };
  }
};
function createQuery(opts) {
  const passengers = opts.passengers ?? DEFAULT_PASSENGERS;
  return new Query(
    opts.flights.map((f) => toFlightData(f, opts.max_stops)),
    SEAT_LOOKUP[opts.seat ?? "economy"],
    TRIP_LOOKUP[opts.trip ?? "one-way"],
    passengers.toPb(),
    opts.language ?? "",
    opts.currency ?? ""
  );
}

// src/errors.ts
var FlightError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "FlightError";
  }
};
var HttpError = class extends FlightError {
  status;
  responseLength;
  constructor(status, responseLength, message) {
    super(message ?? `HTTP ${status} (response: ${responseLength} bytes)`);
    this.name = "HttpError";
    this.status = status;
    this.responseLength = responseLength;
  }
};
var CaptchaError = class extends HttpError {
  constructor(responseLength) {
    super(200, responseLength, `Google returned a CAPTCHA page (${responseLength} bytes). Use a proxy or reduce request rate.`);
    this.name = "CaptchaError";
  }
};
var ParseError = class extends FlightError {
  constructor(message) {
    super(message);
    this.name = "ParseError";
  }
};
var TimeoutError = class extends FlightError {
  constructor(ms) {
    super(`Request timed out after ${ms}ms`);
    this.name = "TimeoutError";
  }
};

// src/parser.ts
function makeResults(flights, metadata) {
  return Object.assign(flights, { metadata });
}
function parseFlightEntry(k) {
  const flight = k?.[0];
  if (!flight) return null;
  const price = k[1]?.[0]?.[1] ?? 0;
  const typ = flight[0] ?? "";
  const airlineNames = flight[1] ?? [];
  const sgFlights = [];
  if (Array.isArray(flight[2])) {
    for (const sf of flight[2]) {
      if (!sf) continue;
      const fromAirport = { code: sf[3] ?? "", name: sf[4] ?? "" };
      const toAirport = { code: sf[6] ?? "", name: sf[5] ?? "" };
      const depTime = sf[8];
      const arrTime = sf[10];
      const departure = {
        date: sf[20] ?? [0, 0, 0],
        time: [depTime?.[0] ?? 0, depTime?.[1] ?? 0]
      };
      const arrival = {
        date: sf[21] ?? [0, 0, 0],
        time: [arrTime?.[0] ?? 0, arrTime?.[1] ?? 0]
      };
      sgFlights.push({
        from_airport: fromAirport,
        to_airport: toAirport,
        departure,
        arrival,
        duration: sf[11] ?? 0,
        plane_type: sf[17] ?? ""
      });
    }
  }
  const extras = flight[22];
  const carbon = {
    emission: extras?.[7] ?? 0,
    typical_on_route: extras?.[8] ?? 0
  };
  return {
    type: typ,
    price,
    airlines: airlineNames,
    flights: sgFlights,
    carbon
  };
}
function parseFlightArray(raw) {
  const flights = [];
  for (const k of raw) {
    try {
      const entry = parseFlightEntry(k);
      if (entry) flights.push(entry);
    } catch {
      continue;
    }
  }
  return flights;
}
function parseMetadata(payload) {
  const metaRoot = payload[7];
  let alliances = [];
  let airlines = [];
  if (Array.isArray(metaRoot?.[1])) {
    const [alliancesData, airlinesData] = metaRoot[1];
    if (Array.isArray(alliancesData)) {
      alliances = alliancesData.map(([code, name]) => ({ code, name }));
    }
    if (Array.isArray(airlinesData)) {
      airlines = airlinesData.map(([code, name]) => ({ code, name }));
    }
  }
  return { alliances, airlines };
}
function parse(html) {
  const classMarker = 'class="ds:1"';
  const classIdx = html.indexOf(classMarker);
  if (classIdx === -1) {
    if (html.includes("g-recaptcha") || html.includes('id="captcha"')) {
      throw new ParseError("Got a CAPTCHA page instead of flight results");
    }
    if (html.includes("errorHasStatus")) {
      throw new ParseError("Google returned an error response");
    }
    throw new ParseError(
      `Could not find flight data (no script tag with class="ds:1"). Response length: ${html.length}`
    );
  }
  const tagClose = html.indexOf(">", classIdx + classMarker.length);
  if (tagClose === -1) throw new ParseError("Malformed HTML: unclosed ds:1 script tag");
  const contentStart = tagClose + 1;
  const end = html.indexOf("</script>", contentStart);
  if (end === -1) throw new ParseError("Malformed HTML: missing </script> for ds:1");
  return parseJs(html.slice(contentStart, end));
}
function parseJs(js) {
  const dataIdx = js.indexOf("data:");
  if (dataIdx === -1) throw new ParseError('Could not find "data:" in script content');
  const afterData = dataIdx + 5;
  const lastComma = js.lastIndexOf(",");
  if (lastComma <= afterData) throw new ParseError("Malformed data payload: no trailing comma");
  const data = js.slice(afterData, lastComma);
  let payload;
  try {
    payload = JSON.parse(data);
  } catch (e) {
    throw new ParseError(`Failed to parse flight data JSON: ${e.message}`);
  }
  return parsePayload(payload);
}
function parsePayload(payload) {
  if (!Array.isArray(payload)) {
    throw new ParseError("Unexpected payload format: not an array");
  }
  const metadata = parseMetadata(payload);
  const flights = [];
  if (Array.isArray(payload[2]?.[0])) {
    flights.push(...parseFlightArray(payload[2][0]));
  }
  if (Array.isArray(payload[3]?.[0])) {
    flights.push(...parseFlightArray(payload[3][0]));
  }
  return makeResults(flights, metadata);
}
function parseRpcResponse(text) {
  const stripped = text.replace(/^\)\]\}'?\s*/, "");
  if (!stripped.trim()) {
    throw new ParseError("Empty RPC response");
  }
  let outer;
  try {
    outer = JSON.parse(stripped);
  } catch (e) {
    throw new ParseError(`Failed to parse RPC response: ${e.message}`);
  }
  const innerJson = outer?.[0]?.[2];
  if (typeof innerJson !== "string") {
    throw new ParseError("RPC response missing flight data at [0][2]");
  }
  let payload;
  try {
    payload = JSON.parse(innerJson);
  } catch (e) {
    throw new ParseError(`Failed to parse inner RPC data: ${e.message}`);
  }
  return parsePayload(payload);
}

// src/fetcher.ts
var FLIGHTS_URL = "https://www.google.com/travel/flights";
var RPC_URL = "https://www.google.com/_/FlightsFrontendUi/data/travel.frontend.flights.FlightsFrontendService/GetShoppingResults";
var UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36";
var DEFAULT_TIMEOUT = 3e4;
var DEFAULT_RETRY_DELAY = 1e3;
var RETRYABLE_STATUS = /* @__PURE__ */ new Set([429, 503, 502, 504]);
function isCaptcha(html) {
  return html.includes("g-recaptcha") || html.includes('id="captcha"');
}
function checkResponse(html, status) {
  if (status >= 400) throw new HttpError(status, html.length);
  if (isCaptcha(html)) throw new CaptchaError(html.length);
}
function isRetryable(err) {
  if (err instanceof HttpError && RETRYABLE_STATUS.has(err.status)) return true;
  if (err instanceof HttpError) return false;
  if (err instanceof CaptchaError) return false;
  if (err instanceof TimeoutError) return true;
  if (err instanceof TypeError) return true;
  return false;
}
function jitteredDelay(base, attempt) {
  const exp = base * Math.pow(2, attempt);
  return exp + Math.random() * exp * 0.25;
}
function mergeSignals(timeout, external) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new TimeoutError(timeout)), timeout);
  const onExternal = () => controller.abort(external.reason);
  if (external) {
    if (external.aborted) {
      controller.abort(external.reason);
    } else {
      external.addEventListener("abort", onExternal, { once: true });
    }
  }
  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timer);
      external?.removeEventListener("abort", onExternal);
    }
  };
}
function buildRpcSegment(fd) {
  return [
    [[[fd.from_airport, 0]]],
    [[[fd.to_airport, 0]]],
    null,
    fd.max_stops != null ? fd.max_stops + 1 : 0,
    fd.airlines ?? null,
    null,
    fd.date,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    3
  ];
}
function buildRpcPayload(q) {
  const segments = q.flightData.map(buildRpcSegment);
  const tripType = q.trip || 2;
  const seatType = q.seat || 1;
  const pax = [0, 0, 0, 0];
  for (const p of q.passengers) {
    if (p >= 1 && p <= 4) pax[p - 1]++;
  }
  const filters = [
    [],
    [
      null,
      null,
      tripType,
      null,
      [],
      seatType,
      pax,
      null,
      null,
      null,
      null,
      null,
      null,
      segments,
      null,
      null,
      null,
      1,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null
    ],
    1,
    0,
    0,
    2
  ];
  const filtersJson = JSON.stringify(filters);
  const wrapped = JSON.stringify([null, filtersJson]);
  return `f.req=${encodeURIComponent(wrapped)}`;
}
function buildRpcUrl(q) {
  const params = new URLSearchParams();
  if (q.language) params.set("hl", q.language);
  if (q.currency) params.set("curr", q.currency);
  const qs = params.toString();
  return qs ? `${RPC_URL}?${qs}` : RPC_URL;
}
async function fetchRpcOnce(q, opts) {
  const timeout = opts.timeout ?? DEFAULT_TIMEOUT;
  const body = buildRpcPayload(q);
  const url = buildRpcUrl(q);
  const { signal, cleanup } = mergeSignals(timeout, opts.signal);
  const fetchImpl = opts.fetchImpl ?? fetch;
  try {
    const res = await fetchImpl(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
        "User-Agent": UA,
        Referer: "https://www.google.com/travel/flights/search",
        Origin: "https://www.google.com"
      },
      body,
      signal
    });
    const text = await res.text();
    if (!res.ok) throw new HttpError(res.status, text.length);
    return text;
  } catch (err) {
    if (signal.aborted && signal.reason instanceof TimeoutError) throw signal.reason;
    throw err;
  } finally {
    cleanup();
  }
}
function buildHtmlUrl(q) {
  if (typeof q === "string") return `${FLIGHTS_URL}?q=${encodeURIComponent(q)}`;
  const qs = new URLSearchParams(q.params()).toString();
  return `${FLIGHTS_URL}?${qs}`;
}
async function fetchHtmlOnce(url, opts) {
  const timeout = opts.timeout ?? DEFAULT_TIMEOUT;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const { signal, cleanup } = mergeSignals(timeout, opts.signal);
  try {
    const res = await fetchImpl(url, {
      headers: { "User-Agent": UA, Referer: FLIGHTS_URL },
      signal
    });
    const html = await res.text();
    checkResponse(html, res.status);
    return html;
  } catch (err) {
    if (signal.aborted && signal.reason instanceof TimeoutError) throw signal.reason;
    throw err;
  } finally {
    cleanup();
  }
}
async function withRetry(fn, opts) {
  const maxRetries = opts.maxRetries ?? 0;
  const retryDelay = opts.retryDelay ?? DEFAULT_RETRY_DELAY;
  let lastErr;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      if (opts.debug && attempt > 0) {
        console.log(`[fast-flights] retry ${attempt}/${maxRetries}`);
      }
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt < maxRetries && isRetryable(err)) {
        const delay = jitteredDelay(retryDelay, attempt);
        if (opts.debug) {
          console.log(`[fast-flights] ${err instanceof Error ? err.message : err} \u2014 retrying in ${Math.round(delay)}ms`);
        }
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}
async function fetchFlightsHtml(q, opts = {}) {
  if (opts.integration) {
    return opts.integration.fetchHtml(q, opts);
  }
  const url = buildHtmlUrl(q);
  return withRetry(() => fetchHtmlOnce(url, opts), opts);
}
async function getFlights(q, opts = {}) {
  if (q instanceof Query && !opts.integration) {
    if (opts.debug) console.log("[fast-flights] using RPC endpoint");
    return withRetry(async () => {
      const text = await fetchRpcOnce(q, opts);
      return parseRpcResponse(text);
    }, opts);
  }
  const html = await fetchFlightsHtml(q, opts);
  return parse(html);
}

// src/integrations/base.ts
var Integration = class {
};
function getEnv(key) {
  const val = process.env[key];
  if (!val) throw new Error(`Environment variable ${key} is not set`);
  return val;
}

// src/integrations/bright-data.ts
var DEFAULT_API_URL = "https://api.brightdata.com/request";
var DEFAULT_DATA_SERP_ZONE = "serp_api1";
var DEFAULT_TIMEOUT2 = 3e4;
var BrightData = class extends Integration {
  apiUrl;
  zone;
  apiKey;
  constructor(opts = {}) {
    super();
    this.apiUrl = opts.api_url || process.env.BRIGHT_DATA_API_URL || DEFAULT_API_URL;
    this.zone = opts.zone || process.env.BRIGHT_DATA_SERP_ZONE || DEFAULT_DATA_SERP_ZONE;
    this.apiKey = opts.api_key || getEnv("BRIGHT_DATA_API_KEY");
  }
  async fetchHtml(q, opts = {}) {
    const url = typeof q === "string" ? `${BASE_URL}?q=${encodeURIComponent(q)}` : q.url();
    const timeout = opts.timeout ?? DEFAULT_TIMEOUT2;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new TimeoutError(timeout)), timeout);
    const onExternal = () => controller.abort(opts.signal.reason);
    if (opts.signal) {
      if (opts.signal.aborted) {
        controller.abort(opts.signal.reason);
      } else {
        opts.signal.addEventListener("abort", onExternal, { once: true });
      }
    }
    try {
      const res = await fetch(this.apiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`
        },
        body: JSON.stringify({ url, zone: this.zone }),
        signal: controller.signal
      });
      const html = await res.text();
      if (!res.ok) {
        throw new HttpError(res.status, html.length, `BrightData API error: HTTP ${res.status}`);
      }
      if (html.includes("g-recaptcha") || html.includes('id="captcha"')) {
        throw new CaptchaError(html.length);
      }
      return html;
    } catch (err) {
      if (controller.signal.aborted && controller.signal.reason instanceof TimeoutError) {
        throw controller.signal.reason;
      }
      throw err;
    } finally {
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onExternal);
    }
  }
};

export { BrightData, CaptchaError, FlightError, HttpError, Integration, ParseError, Passengers, Query, TimeoutError, createQuery, fetchFlightsHtml, getFlights, parse, parseJs, parsePayload, parseRpcResponse };