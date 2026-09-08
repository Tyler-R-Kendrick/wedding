import { z } from 'zod';
import type { CapabilityContext } from '@/contracts/capability';
import { AUDIT_ACTIONS } from '@/contracts/audit';
import { LIFECYCLE_STATES } from '@/contracts/lifecycle';
import type { Db } from '@/db/client';
import { appServices } from '../context';

/** Ops screens read the database and nothing else; providers are resolved per capability. */
export function opsDb(ctx: CapabilityContext): Db {
  return appServices(ctx).db;
}

export const actorSchema = z.object({ kind: z.string(), ref: z.string().nullable() });
export const auditActionSchema = z.enum(AUDIT_ACTIONS);
export const lifecycleStateSchema = z.enum(LIFECYCLE_STATES);
export const metadataSchema = z.record(z.string(), z.string()).nullable();

/** Shared shape for the audit rows the lifecycle and audit screens both render. */
export const auditRowSchema = z.object({
  id: z.string(),
  at: z.string(),
  actor: actorSchema,
  action: auditActionSchema,
  targetType: z.string(),
  targetId: z.string(),
  outcome: z.enum(['success', 'denied', 'failed']),
  requestId: z.string(),
  metadata: metadataSchema,
  metadataRedacted: z.boolean(),
});
