import { jsonResponse } from '@/lib/request';
import { handleManifest } from '@/webmcp/server/handlers';

export const dynamic = 'force-dynamic';

/** GET /api/webmcp/manifest: the WebMCP tools the current principal may see (docs/architecture/webmcp.md). */
export async function GET(request: Request) {
  return handleManifest(request);
}

export async function POST() {
  return jsonResponse({ ok: false, error: { code: 'validation', message: 'Use GET.' } }, { status: 405, headers: { Allow: 'GET' } });
}
