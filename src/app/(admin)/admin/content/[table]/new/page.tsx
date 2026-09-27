import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CONTENT_TABLE_NAMES, TABLE_SPECS } from '@/domain/content/admin';
import { ROUTES } from '@/domain/routes';
import { Breadcrumbs, ConsolePage } from '../../../_components/console';
import { AdminDenied, adminContentContext } from '../../_auth';
import { ContentRecordFlow } from '../../_components/ContentFlows';
import { NEW_RECORD_DEFAULTS } from '../../_components/shared';

export const dynamic = 'force-dynamic';

type Params = Promise<{ table: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { table } = await params;
  const spec = (CONTENT_TABLE_NAMES as readonly string[]).includes(table) ? TABLE_SPECS[table as keyof typeof TABLE_SPECS] : null;
  return { title: spec ? `New ${spec.label} · Content (admin)` : 'Content (admin)' };
}

/**
 * A new record, from a link or a bookmark. Adding one is the same flow the table's own page opens;
 * this route keeps the address working and says where the record will go. Once it is saved, the
 * sheet stays open on a link to the new record, since nothing here lists it.
 */
export default async function AdminContentNew({ params }: { params: Params }) {
  const { table } = await params;
  if (!(CONTENT_TABLE_NAMES as readonly string[]).includes(table)) notFound();
  const spec = TABLE_SPECS[table as keyof typeof TABLE_SPECS];
  const { allowed } = await adminContentContext();
  if (!allowed) return <AdminDenied />;
  return (
    <ConsolePage
      title={`New: ${spec.label}`}
      lede="New records start as private drafts. Any text containing the TODO(Tyler & Sara) marker must have “Placeholder” ticked."
      actions={<ContentRecordFlow table={table} tableLabel={spec.label} fields={spec.fields} defaults={NEW_RECORD_DEFAULTS} label="Add a record" linkAfterCreate defaultOpen />}
    >
      <Breadcrumbs trail={[{ href: ROUTES.adminContent, label: 'Content' }, { href: `${ROUTES.adminContent}/${table}`, label: spec.label }, { label: 'New' }]} />
      <p className="con-note">
        “Add a record” asks what the record says, then where it comes from and who may see it, and reads the whole record back before saving. Every record in this table is on{' '}
        <Link href={`${ROUTES.adminContent}/${table}`}>{spec.label}</Link>.
      </p>
    </ConsolePage>
  );
}
