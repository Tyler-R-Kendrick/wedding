import { POST as capabilityPost } from '@/app/api/capabilities/[name]/route';
import { jsonResponse } from '@/lib/request';

export const dynamic = 'force-dynamic';

/**
 * Upload endpoints for the QR upload page: thin aliases of the media capabilities so the page
 * has stable, readable URLs. Every request still runs through the single capability door
 * (rate limits, CSRF check, body cap, principal resolution, the invoke pipeline, audit).
 *
 *   POST /api/uploads/create    -> create_upload
 *   POST /api/uploads/resume    -> resume_upload
 *   POST /api/uploads/complete  -> complete_upload
 *   POST /api/uploads/abort     -> abort_upload
 */
const ACTIONS: Record<string, string> = {
  create: 'create_upload',
  resume: 'resume_upload',
  complete: 'complete_upload',
  abort: 'abort_upload',
};

export async function POST(request: Request, { params }: { params: Promise<{ action: string }> }) {
  const { action } = await params;
  const name = ACTIONS[action];
  if (!name) return jsonResponse({ ok: false, error: { code: 'not_found', message: 'That action is not available.' } }, { status: 404 });
  return capabilityPost(request, { params: Promise.resolve({ name }) });
}

export async function GET() {
  return jsonResponse({ ok: false, error: { code: 'validation', message: 'Use POST.' } }, { status: 405, headers: { Allow: 'POST' } });
}
