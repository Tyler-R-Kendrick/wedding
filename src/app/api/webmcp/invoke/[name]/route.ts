import { jsonResponse } from '@/lib/request';
import { handleInvoke } from '@/webmcp/server/handlers';

export const dynamic = 'force-dynamic';

/** POST /api/webmcp/invoke/<name>: the WebMCP bridge; surface is always `webmcp` (docs/architecture/webmcp.md). */
export async function POST(request: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  return handleInvoke(request, name);
}

export async function GET() {
  return jsonResponse({ ok: false, error: { code: 'validation', message: 'Use POST.' } }, { status: 405, headers: { Allow: 'POST' } });
}
