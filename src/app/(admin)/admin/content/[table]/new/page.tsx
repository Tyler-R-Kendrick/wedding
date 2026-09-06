import Link from 'next/link';
import { notFound } from 'next/navigation';
import { newId } from '@/contracts/ids';
import { CONTENT_TABLE_NAMES, TABLE_SPECS } from '@/domain/content/admin';
import { SOURCE_KEYS } from '@/content/sources';
import { ROUTES } from '@/domain/routes';
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
    <main id="main" className="ac-main">
      <ul className="ac-crumbs">
        <li>
          <Link href={ROUTES.adminContent}>Content</Link>
        </li>
        <li>
          <Link href={`${ROUTES.adminContent}/${table}`}>{spec.label}</Link>
        </li>
        <li>New</li>
      </ul>
      <h1>New: {spec.label}</h1>
      <p className="ac-muted">New records start as private drafts. Any text containing the TODO(Tyler &amp; Sara) marker must have &ldquo;Placeholder&rdquo; ticked.</p>
      <RecordForm table={table} tableLabel={spec.label} fields={spec.fields} initial={initial} idempotencyKey={newId()} />
    </main>
  );
}
