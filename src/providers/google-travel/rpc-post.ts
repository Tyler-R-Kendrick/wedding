import { decodeBatchexecute, type DecodedRpcPayload } from './batchexecute';
import type { FetchLike } from '../flights/http';

const ORIGIN = 'https://www.google.com';
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36';

export interface GoogleRpcCapture {
  endpoint: string;
  decoded: DecodedRpcPayload[];
}

export async function postGoogleTravelRpc(
  rpcId: string,
  payload: unknown,
  sourcePath: string,
  opts: { fetchImpl?: FetchLike; timeoutMs?: number } = {},
): Promise<GoogleRpcCapture> {
  const endpoint = new URL(`${ORIGIN}/_/TravelFrontendUi/data/batchexecute`);
  endpoint.searchParams.set('rpcids', rpcId);
  endpoint.searchParams.set('source-path', sourcePath);
  endpoint.searchParams.set('hl', 'en');
  const envelope = [[rpcId, JSON.stringify(payload), null, 'generic']];
  const fReq = JSON.stringify([envelope]);
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  const res = await fetchImpl(endpoint.href, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded;charset=UTF-8',
      'user-agent': UA,
      referer: `${ORIGIN}/travel/search`,
      origin: ORIGIN,
    },
    body: new URLSearchParams({ 'f.req': fReq }).toString(),
    signal: AbortSignal.timeout(opts.timeoutMs ?? 30_000),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`Google Travel RPC ${rpcId} HTTP ${res.status}`);
  if (body.includes('g-recaptcha') || body.includes('id="captcha"')) {
    throw new Error('Google Travel returned a CAPTCHA challenge');
  }
  const decoded = decodeBatchexecute(body);
  if (!decoded.some((e) => e.rpcId === rpcId && e.payload != null)) {
    throw new Error(`Google Travel RPC ${rpcId} returned no payload`);
  }
  return { endpoint: endpoint.href, decoded };
}
