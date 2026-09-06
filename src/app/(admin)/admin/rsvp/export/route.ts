import { adminExportNeeds, adminExportRsvp } from '@/capabilities/rsvp';
import { HTTP_STATUS_FOR_CODE } from '@/contracts/errors';
import { jsonResponse, NO_STORE_HEADERS } from '@/lib/request';
import { adminInvoke } from '../../../_shared/admin';

export const dynamic = 'force-dynamic';

/** GET /admin/rsvp/export[?needs=1] — CSV through the capability layer (authorization inside the pipeline). */
export async function GET(request: Request) {
  const needs = new URL(request.url).searchParams.get('needs') === '1';
  const result = needs ? await adminInvoke(adminExportNeeds, { includeNeeds: true }) : await adminInvoke(adminExportRsvp, {});
  if (!result.ok) {
    // Same rule as the JSON capability route: a caller learns that they lack access, never which
    // entitlement they are missing. `toJSON()` carries `details.missing` verbatim.
    const { missing: _missing, ...details } = result.error.details ?? {};
    const error = { code: result.error.code, message: result.error.message, ...(Object.keys(details).length ? { details } : {}) };
    return jsonResponse({ ok: false, error }, { status: HTTP_STATUS_FOR_CODE[result.error.code] });
  }
  const { filename, csv } = result.value.data;
  return new Response(csv, { status: 200, headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${filename}"`, ...NO_STORE_HEADERS } });
}
