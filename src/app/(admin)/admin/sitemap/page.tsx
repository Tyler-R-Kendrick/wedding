import type { Metadata } from 'next';
import Link from 'next/link';
import type { InventoryRow } from '@/lib/site-inventory';
import { CRAWL_EXAMPLES, inventory, publicSitemapPaths } from '@/lib/site-inventory';
import { adminPrincipal } from '../../_shared/admin';
import { ConsoleGate, ConsolePage, DataTable, Note, Section, Stat, StatStrip } from '../_components/console';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Sitemap', robots: { index: false, follow: false } };

/**
 * The same rows as `docs/sitemap.md`. Any administrator can read it: the list is the route map,
 * not a guest record. Authorization is `principal.kind === 'admin'` only.
 */
export default async function AdminSitemapPage() {
  const { principal } = await adminPrincipal();
  if (principal.kind !== 'admin') return <ConsoleGate what="The sitemap" />;

  const rows = inventory();
  const pages = rows.filter((r) => r.kind === 'page' && r.url !== CRAWL_EXAMPLES.sitemapXml);
  const internal = rows.filter((r) => r.kind === 'internal');
  const redirects = rows.filter((r) => r.kind === 'redirect');
  const apis = rows.filter((r) => r.kind === 'api' || r.kind === 'export' || r.url === CRAWL_EXAMPLES.sitemapXml);

  return (
    <ConsolePage title="Sitemap" lede="Every endpoint the app serves, and what each one should answer.">
      <StatStrip>
        <Stat label="Pages" value={pages.length} />
        <Stat label="Redirects" value={redirects.length} />
        <Stat label="APIs and exports" value={apis.length} />
        <Stat label="Public sitemap URLs" value={publicSitemapPaths().length} hint="audience public only" />
      </StatStrip>
      <Note>
        This is the same list as <code className="ops-code">docs/sitemap.md</code>. Lifecycle <code className="ops-code">visibleFrom</code> is not applied: it decides when a page joins the navigation, not whether the route exists. <code className="ops-code">/sitemap.xml</code> lists public pages only.
      </Note>
      <Section title="Pages" id="pages">
        <InventoryTable caption="Pages" rows={pages} />
      </Section>
      <Section title="Internal routes" id="internal">
        <InventoryTable caption="Internal routes" rows={internal} />
      </Section>
      <Section title="Redirects" id="redirects">
        <InventoryTable caption="Redirects" rows={redirects} />
      </Section>
      <Section title="API and export routes" id="api">
        <InventoryTable caption="API and export routes" rows={apis} />
      </Section>
    </ConsolePage>
  );
}

/** Pages, aliases and downloads open in the browser. API examples do not: a POST-only path and a hidden dev endpoint both answer 404 to a plain GET. */
function linkedExample(row: InventoryRow, example: string): boolean {
  return example.startsWith('/') && (row.kind === 'page' || row.kind === 'internal' || row.kind === 'redirect' || row.kind === 'export');
}

function InventoryTable({ caption, rows }: { caption: string; rows: InventoryRow[] }) {
  return (
    <DataTable
      caption={caption}
      head={
        <tr>
          <th scope="col">URL</th>
          <th scope="col">Example</th>
          <th scope="col">Audience</th>
          <th scope="col">Method</th>
          <th scope="col">Purpose</th>
          <th scope="col">Expected</th>
        </tr>
      }
    >
      {rows.map((row) => {
        const example = row.crawlExample ?? row.examples[0] ?? '';
        return (
          <tr key={`${row.method} ${row.url}`}>
            <th scope="row" className="ops-code">
              {row.url}
            </th>
            <td className="ops-code">{linkedExample(row, example) ? <Link href={example}>{example}</Link> : example || '—'}</td>
            <td>{row.audience}</td>
            <td>{row.method}</td>
            <td className="con-wrap">{row.purpose}</td>
            <td className="con-wrap">{row.expected}</td>
          </tr>
        );
      })}
    </DataTable>
  );
}
