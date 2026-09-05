import { z } from 'zod';
import { defineCapability } from '@/contracts/capability';
import { ok } from '@/contracts/result';
import { EXTERNAL_ACTION_KINDS, EXTERNAL_ACTION_STATUSES } from '@/db/schema';
import { listExternalActions } from '@/domain/external/records';
import { appServices } from './context';

const input = z.object({ kind: z.enum(EXTERNAL_ACTION_KINDS).optional(), targetType: z.string().max(64).optional(), targetId: z.string().max(128).optional(), limit: z.number().int().min(1).max(500).optional() }).optional();

const output = z.object({
  records: z.array(
    z.object({
      id: z.string(),
      kind: z.enum(EXTERNAL_ACTION_KINDS),
      provider: z.string(),
      status: z.enum(EXTERNAL_ACTION_STATUSES),
      actor: z.string(),
      targetType: z.string(),
      targetId: z.string(),
      urlHost: z.string().nullable(),
      surface: z.string(),
      requestId: z.string(),
      createdAt: z.string(),
    }),
  ),
});

const actorLabel = (a: { kind: string; guestId?: string; adminId?: string; component?: string }) =>
  a.kind === 'guest' ? `guest:${a.guestId}` : a.kind === 'admin' ? `admin:${a.adminId}` : a.kind === 'system' ? `system:${a.component}` : 'anonymous';

export const adminListExternalActions = defineCapability<z.infer<typeof input>, z.infer<typeof output>>({
  name: 'admin_list_external_actions',
  title: 'External action records',
  description: 'Admin: the log of every handoff and external commit (gift links, reservation links, ride claims) with provider, outcome and target host. Never a code or a full URL.',
  kind: 'read',
  auth: 'admin',
  requires: ['admin_audit'],
  annotations: { readOnlyHint: true, untrustedContentHint: false, consequentialHint: false },
  exposure: { ui: true, ai: false, webmcp: false },
  input,
  output,
  async handler(ctx, i) {
    const { db } = appServices(ctx);
    const rows = await listExternalActions(db, i ?? {});
    return ok({
      data: { records: rows.map((r) => ({ id: r.id, kind: r.kind, provider: r.provider, status: r.status, actor: actorLabel(r.actor as never), targetType: r.targetType, targetId: r.targetId, urlHost: r.urlHost, surface: r.surface, requestId: r.requestId, createdAt: r.createdAt.toISOString() })) },
      sources: [],
    });
  },
});
