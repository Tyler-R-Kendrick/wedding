import { asc } from 'drizzle-orm';
import { z } from 'zod';
import { defineCapability } from '@/contracts/capability';
import { SOURCE_TYPES, TRUST_CLASSES } from '@/contracts/provenance';
import { ok } from '@/contracts/result';
import type { Db } from '@/db/client';
import { contentSources } from '@/db/schema';
import { requireService } from './services';

const input = z.object({}).optional();

const sourceSchema = z.object({
  id: z.string(),
  title: z.string(),
  sourceType: z.enum(SOURCE_TYPES),
  trustClass: z.enum(TRUST_CLASSES),
  /** The official page, or the public route a citation links to. */
  canonicalUrl: z.string().nullable(),
  documentName: z.string().nullable(),
  verifiedAt: z.string(),
  validFrom: z.string().nullable(),
  validUntil: z.string().nullable(),
  notes: z.string().nullable(),
});
const output = z.object({ sources: z.array(sourceSchema) });
export type ContentSourcesData = z.infer<typeof output>;
export type ContentSourceView = z.infer<typeof sourceSchema>;

/**
 * The provenance registry (`content_sources`, ADR-0011) as the content editor offers it: every
 * record cites one of these, chosen by name. The rows are written by the seed; this is the one read
 * of them, so a client bundle never has to carry the seed module to know what they are.
 */
export const adminListContentSources = defineCapability<z.infer<typeof input>, ContentSourcesData>({
  name: 'admin_list_content_sources',
  title: 'List content sources (admin)',
  description: 'Admin only. Lists the registered content sources (documents, websites, people) a content record can cite, with their kind and trust class. Read only. Not offered to the concierge.',
  kind: 'read',
  auth: 'admin',
  requires: ['admin_content'],
  annotations: { readOnlyHint: true, untrustedContentHint: false, consequentialHint: false },
  exposure: { ui: true, ai: false, webmcp: false },
  input,
  output,
  async handler(ctx) {
    const db = requireService<Db>(ctx, 'db');
    const rows = await db.select().from(contentSources).orderBy(asc(contentSources.title));
    const iso = (d: Date | null) => d?.toISOString() ?? null;
    return ok({
      data: {
        sources: rows.map((r) => ({
          id: r.id,
          title: r.title,
          sourceType: r.sourceType,
          trustClass: r.trustClass,
          canonicalUrl: r.canonicalUrl,
          documentName: r.documentName,
          verifiedAt: r.verifiedAt.toISOString(),
          validFrom: iso(r.validFrom),
          validUntil: iso(r.validUntil),
          notes: r.notes,
        })),
      },
      sources: [],
    });
  },
});
