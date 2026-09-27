import 'server-only';
import { adminListContentSources } from '@/capabilities/admin_list_content_sources';
import { invoke } from '@/capabilities/invoke';
import { listAdventures } from '@/capabilities/list_adventures';
import type { ContentRecordsData } from '@/capabilities/list_content_records';
import type { CapabilityContext } from '@/contracts/capability';
import type { ContentTableName } from '@/db/schema/content';
import { pickLists, pickOptions, refOptions, sourceOptions } from './shared';
import type { EditorLists } from './types';

/**
 * What the content flows choose from, read once per page through `invoke`: the registered sources
 * (`admin_list_content_sources`), the records a field points at by id (from the page's own
 * `list_content_records` read) and the ones it names by web address name or key (`list_adventures`
 * only when one of `tables` picks an adventure). A read that fails leaves its list empty; the flow
 * still keeps a stored value it cannot find as its own option.
 */
export async function editorLists(ctx: CapabilityContext, tables: readonly ContentTableName[], records: ContentRecordsData['tables'] | undefined): Promise<EditorLists> {
  const needsAdventures = tables.some((t) => pickLists(t).includes('adventure'));
  const [sources, adventures] = await Promise.all([invoke(adminListContentSources, ctx, {}), needsAdventures ? invoke(listAdventures, ctx, {}) : Promise.resolve(null)]);
  return {
    sources: sourceOptions(sources.ok ? sources.value.data.sources : undefined),
    refs: refOptions(records),
    picks: pickOptions(records, adventures?.ok ? adventures.value.data.items : undefined),
  };
}
