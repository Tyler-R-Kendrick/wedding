/**
 * Same-origin gate for cookie-authenticated mutations. Better Auth protects its own routes;
 * this covers every other route that reads the session cookie (capability POSTs, admin
 * server actions). Browsers always send `Origin` on cross-site POSTs and `Sec-Fetch-Site`
 * on every fetch, so a mismatch is a reliable CSRF signal; requests without either header
 * (curl, Playwright's request context) carry no ambient credentials and pass through.
 */
export function isTrustedMutationRequest(request: Request, allowedOrigins: readonly string[] = []): boolean {
  const method = request.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return true;
  const fetchSite = request.headers.get('sec-fetch-site');
  if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') return false;
  const origin = request.headers.get('origin');
  if (!origin || origin === 'null') return !origin;
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
  if (host && parsed.host.toLowerCase() === host.toLowerCase()) return true;
  return allowedOrigins.some((a) => {
    try {
      return new URL(a).origin === parsed.origin;
    } catch {
      return false;
    }
  });
}
