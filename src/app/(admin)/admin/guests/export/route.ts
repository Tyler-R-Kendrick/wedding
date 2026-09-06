import { createCapabilityContext, invokeByName } from '@/capabilities';
import { HTTP_STATUS_FOR_CODE } from '@/contracts/errors';
import '@/lib/auth/install';
import { getPrincipal } from '@/lib/principal';
import { getRequestId, jsonResponse, NO_STORE_HEADERS } from '@/lib/request';

export const dynamic = 'force-dynamic';

/** GET /admin/guests/export?notes=1&address=1 → CSV download via admin_export_guests_csv (admin_guest_ops). */
export async function GET(request: Request) {
  const requestId = getRequestId(request.headers);
  const url = new URL(request.url);
  const principal = await getPrincipal(request);
  const ctx = await createCapabilityContext({ principal, requestId, surface: 'ui' });
  const result = await invokeByName('admin_export_guests_csv', ctx, { includeNotes: url.searchParams.get('notes') === '1', includeAddress: url.searchParams.get('address') === '1' });
  if (!result.ok) return jsonResponse({ ok: false, error: result.error.toJSON() }, { status: HTTP_STATUS_FOR_CODE[result.error.code], requestId });
  const { csv } = result.value.data as { csv: string };
  return new Response(csv, {
    status: 200,
    headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="guests-${new Date().toISOString().slice(0, 10)}.csv"`, ...NO_STORE_HEADERS, 'x-request-id': requestId },
  });
}
