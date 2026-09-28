import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { invoke } from '@/capabilities/invoke';
import { listContentRecordsCapability } from '@/capabilities/list_content_records';
import { CONTENT_TABLE_NAMES, TABLE_SPECS } from '@/domain/content/admin';
import { ROUTES } from '@/domain/routes';
import { Breadcrumbs, ConsolePage } from '../../../_components/console';
import { AdminDenied, adminContentContext } from '../../_auth';
import { ContentRecordFlow } from '../../_components/ContentFlows';
import { editorLists } from '../../_components/lists';
import { contentEditor, refTables, withArticle } from '../../_components/shared';

export const dynamic = 'force-dynamic';

type Params = Promise<{ table: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { table } = await params;
  const spec = (CONTENT_TABLE_NAMES as readonly string[]).includes(table) ? TABLE_SPECS[table as keyof typeof TABLE_SPECS] : null;
  return { title: spec ? `Add ${withArticle(spec.noun)} · Content (admin)` : 'Content (admin)' };
}

/**
 * A new record, from a link or a bookmark. Adding one is the same flow the table's own page opens;
 * this route keeps the address working and says where the record will go. Once it is saved, the
 * sheet stays open on a link to the new record, since nothing here lists it.
 */
export default async function AdminContentNew({ params }: { params: Params }) {
  const { table: name } = await params;
  if (!(CONTENT_TABLE_NAMES as readonly string[]).includes(name)) notFound();
  const table = name as keyof typeof TABLE_SPECS;
  const spec = TABLE_SPECS[table];
  const { ctx, allowed } = await adminContentContext();
  if (!allowed) return <AdminDenied />;
  // Only a table that points at other records (a place, a memory) needs them read, to offer them by name.
  const r = refTables(table).length ? await invoke(listContentRecordsCapability, ctx, {}) : null;
  const editor = contentEditor(table, await editorLists(ctx, [table], r?.ok ? r.value.data.tables : undefined));
  const add = `Add ${withArticle(spec.noun)}`;
  return (
    <ConsolePage title={add} lede={`It starts as a private draft in ${spec.label}, and nothing is saved until the last step.`} actions={<ContentRecordFlow editor={editor} label={add} linkAfterCreate defaultOpen />}>
      <Breadcrumbs trail={[{ href: ROUTES.adminContent, label: 'Content' }, { href: `${ROUTES.adminContent}/${table}`, label: spec.label }, { label: 'New' }]} />
      <p className="con-note">
        “{add}” asks what it says, then where it comes from and who can see it, and reads the whole {spec.noun} back before saving. Every {spec.noun} is listed on{' '}
        <Link href={`${ROUTES.adminContent}/${table}`}>{spec.label}</Link>.
      </p>
    </ConsolePage>
  );
}
