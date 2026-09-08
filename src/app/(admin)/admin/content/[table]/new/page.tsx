import { notFound } from 'next/navigation';
import { newId } from '@/contracts/ids';
import { CONTENT_TABLE_NAMES, TABLE_SPECS } from '@/domain/content/admin';
import { SOURCE_KEYS } from '@/content/sources';
import { ROUTES } from '@/domain/routes';
import { Breadcrumbs, ConsolePage } from '../../../_components/console';
import { AdminDenied, adminContentContext } from '../../_auth';
import { RecordForm } from '../../_form';

export const dynamic = 'force-dynamic';

type Params = Promise<{ table: string }>;

export default async function AdminContentNew({ params }: { params: Params }) {
  const { table } = await params;
  if (!(CONTENT_TABLE_NAMES as readonly string[]).includes(table)) notFound();
  const spec = TABLE_SPECS[table as keyof typeof TABLE_SPECS];
  const { allowed } = await adminContentContext();
  if (!allowed) return <AdminDenied />;
  const initial: Record<string, string> = {
    sourceId: SOURCE_KEYS.brief,
    sourceType: 'authored',
    trustClass: 'TRUSTED_WEDDING',
    visibility: 'private-draft',
    verifiedAt: new Date().toISOString(),
  };
  return (
    <ConsolePage title={`New: ${spec.label}`} lede="New records start as private drafts. Any text containing the TODO(Tyler & Sara) marker must have “Placeholder” ticked.">
      <Breadcrumbs trail={[{ href: ROUTES.adminContent, label: 'Content' }, { href: `${ROUTES.adminContent}/${table}`, label: spec.label }, { label: 'New' }]} />
      <RecordForm table={table} tableLabel={spec.label} fields={spec.fields} initial={initial} idempotencyKey={newId()} />
    </ConsolePage>
  );
}
