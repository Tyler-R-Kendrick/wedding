import type { Metadata } from 'next';
import Link from 'next/link';
import { adminProviderStatus } from '@/capabilities/ops';
import { adminInvoke, adminPrincipal } from '../../_shared/admin';
import { ConsoleGate, ConsolePage, DataTable, Denied, EmptyRow, KeyValues, Pill, Section, Stat, StatStrip } from '../_components/console';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Providers', robots: { index: false, follow: false } };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const modeTone = (mode: string) => (mode === 'live' ? 'good' : mode === 'unavailable' ? 'bad' : mode === 'mock' ? 'neutral' : 'warn');
const healthTone = (status: string) => (status === 'up' ? 'good' : status === 'degraded' ? 'warn' : status === 'unconfigured' ? 'neutral' : 'bad');

/**
 * Which adapter each provider kind resolved to, in which mode, whether its configuration validates,
 * and what that instance says it can actually do.
 *
 * Configuration is reported as the NAMES of missing environment variables. No value of any
 * environment variable is read, returned or rendered anywhere on this page — the same rule
 * `/api/health` follows, and the reason this screen can exist at all.
 */
export default async function AdminProvidersPage({ searchParams }: { searchParams: SearchParams }) {
  const { principal } = await adminPrincipal();
  if (principal.kind !== 'admin') return <ConsoleGate what="Providers" />;
  const sp = await searchParams;
  const probe = (Array.isArray(sp.probe) ? sp.probe[0] : sp.probe) === '1';

  const result = await adminInvoke(adminProviderStatus, { probe });
  if (!result.ok) {
    return (
      <ConsolePage title="Providers">
        <Denied message={result.error.message} entitlement="admin_integrations" />
      </ConsolePage>
    );
  }
  const p = result.value.data;

  return (
    <ConsolePage
      title="Providers"
      lede="Every external system sits behind a typed seam with a mock. Unconfigured always means the mock, never a crash."
      actions={
        <p>
          {probe ? <Link href="/admin/providers">Stop probing</Link> : <Link href="/admin/providers?probe=1">Probe health now</Link>}
        </p>
      }
    >
      <StatStrip>
        <Stat label="Live or sandbox" value={p.totals.live} />
        <Stat label="Mock" value={p.totals.mock} hint="falls back safely" />
        <Stat label="Misconfigured" value={p.totals.misconfigured} hint="missing variables" />
      </StatStrip>

      <KeyValues
        items={[
          { label: 'Database driver', value: p.db.driver },
          { label: 'pgvector', value: p.db.vectorAvailable ? <Pill tone="good">available</Pill> : <Pill tone="warn">unavailable</Pill> },
          { label: 'Health probe', value: p.probed ? 'ran just now' : 'not run' },
        ]}
      />

      <Section
        title="Adapters"
        id="adapters"
        note="A live adapter needs its variables set in the server environment. Only their names appear here — this page never reads a value, and there is no control on it that could."
      >
        <DataTable caption="Provider adapters and their configuration" head={
          <tr>
            <th scope="col">Kind</th>
            <th scope="col">Adapter</th>
            <th scope="col">Mode</th>
            <th scope="col">Config</th>
            <th scope="col">Missing variables</th>
            {p.probed ? <th scope="col">Health</th> : null}
          </tr>
        }>
          {p.providers.map((row) => (
            <tr key={row.kind}>
              <th scope="row">{row.kind}</th>
              <td>{row.name}</td>
              <td>
                <Pill tone={modeTone(row.mode)}>{row.mode}</Pill>
              </td>
              <td>{row.config.ok ? <Pill tone="good">ok</Pill> : <Pill tone="bad">incomplete</Pill>}</td>
              <td className="con-wrap ops-code">{row.config.missing.length ? row.config.missing.join(', ') : '—'}</td>
              {p.probed ? (
                <td>
                  {row.health ? (
                    <>
                      <Pill tone={healthTone(row.health.status)}>{row.health.status}</Pill>
                      {row.health.latencyMs === null ? null : <span className="con-num"> {row.health.latencyMs}ms</span>}
                    </>
                  ) : (
                    '—'
                  )}
                </td>
              ) : null}
            </tr>
          ))}
        </DataTable>
      </Section>

      <Section title="Detected operations" id="capabilities" note="What each resolved instance reports it can do right now. A mock answers every call, but says here which of them are real.">
        <DataTable caption="Operations supported by each adapter" head={
          <tr>
            <th scope="col">Kind</th>
            <th scope="col">Supported</th>
            <th scope="col">Not supported</th>
          </tr>
        }>
          {p.providers.every((row) => row.capabilities.length === 0) ? (
            <EmptyRow span={3}>No adapter reported an operation list.</EmptyRow>
          ) : (
            p.providers
              .filter((row) => row.capabilities.length > 0)
              .map((row) => (
                <tr key={row.kind}>
                  <th scope="row">{row.kind}</th>
                  <td className="con-wrap">{row.capabilities.filter((c) => c.supported).map((c) => c.name).join(', ') || '—'}</td>
                  <td className="con-wrap">{row.capabilities.filter((c) => !c.supported).map((c) => c.name).join(', ') || '—'}</td>
                </tr>
              ))
          )}
        </DataTable>
      </Section>

      <Section title="Warnings" id="warnings">
        <DataTable caption="Configuration warnings by adapter" head={
          <tr>
            <th scope="col">Kind</th>
            <th scope="col">Warning</th>
          </tr>
        }>
          {p.providers.every((row) => row.config.warnings.length === 0) ? (
            <EmptyRow span={2}>No adapter reported a warning.</EmptyRow>
          ) : (
            p.providers.flatMap((row) => row.config.warnings.map((w, idx) => (
              <tr key={`${row.kind}-${idx}`}>
                <th scope="row">{row.kind}</th>
                <td className="con-wrap">{w}</td>
              </tr>
            )))
          )}
        </DataTable>
      </Section>
    </ConsolePage>
  );
}
