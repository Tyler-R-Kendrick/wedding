import type { Principal } from '@/contracts/principal';
import type { Db } from '@/db/client';
import { contentSources } from '@/db/schema';
import { sourceTitleMap, type SourceTitles } from './provenance';
import type { Surface } from './visibility';

/** Everything a domain read needs: the db, who is asking, from which surface, and when. */
export interface ReadContext {
  db: Db;
  principal: Principal;
  surface: Surface;
  now: Date;
  sources: SourceTitles;
}

export async function createReadContext(db: Db, principal: Principal, surface: Surface, now: Date): Promise<ReadContext> {
  const rows = await db.select({ id: contentSources.id, title: contentSources.title }).from(contentSources);
  return { db, principal, surface, now, sources: sourceTitleMap(rows) };
}
