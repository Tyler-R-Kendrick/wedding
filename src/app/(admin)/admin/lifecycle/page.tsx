import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { adminLifecycleStatus } from '@/capabilities/ops';
import { PREVIEW_COOKIE } from '@/domain/lifecycle/constants';
import { adminInvoke, adminPrincipal } from '../../_shared/admin';
import { ConsoleGate, ConsolePage, DataTable, Denied, EmptyRow, KeyValues, Pill, Section } from '../_components/console';
import { startPreview, stopPreview } from '../_lib/ops-actions';
import { PublishForm } from './PublishForm';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Lifecycle', robots: { index: false, follow: false } };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * The site's published state, and the two ways it changes: publishing (everyone, permanently) and
 * previewing (this browser, for twelve hours, and only for an admin — `resolveLifecycle` re-checks
 * the principal on every render, so a preview link or cookie in a guest's browser shows the
 * published state and nothing else).
 */
export default async function AdminLifecyclePage({ searchParams }: { searchParams: SearchParams }) {
  const { principal } = await adminPrincipal();
  if (principal.kind !== 'admin') return <ConsoleGate what="Lifecycle" />;
  const sp = await searchParams;
  const notice = { ok: one(sp.ok), error: one(sp.error) };

  const result = await adminInvoke(adminLifecycleStatus, {});
  if (!result.ok) {
    return (
      <ConsolePage title="Lifecycle" notice={notice}>
        <Denied message={result.error.message} entitlement="admin_lifecycle" />
      </ConsolePage>
    );
  }
  const s = result.value.data;
  const previewing = (await cookies()).get(PREVIEW_COOKIE)?.value ?? null;

  return (
    <ConsolePage
      title="Lifecycle"
      lede="What every guest sees right now. A published state always beats the calendar: nothing here changes on its own."
      notice={notice}
    >
      <KeyValues
        items={[
          { label: 'Published state', value: <strong>{s.state}</strong> },
          { label: 'Home page mode', value: s.mode },
          { label: 'Published', value: s.publishedAt ?? 'never' },
          { label: 'By', value: s.publishedBy ? `${s.publishedBy.kind}${s.publishedBy.ref ? ` · ${s.publishedBy.ref}` : ''}` : '—' },
          { label: 'Calendar suggests', value: s.behindSchedule ? <Pill tone="warn">{s.suggested}</Pill> : <Pill tone="good">{s.suggested}</Pill> },
        ]}
      />
      {s.note ? <p className="con-note">Note on the current state: {s.note}</p> : null}

      <Section
        title="Publish a new state"
        id="publish"
        note="Reviewing is free and changes nothing. Publishing takes effect for every guest on their next page load, and can be undone by exactly one state."
      >
        <PublishForm current={s.state} states={s.transitions.map((t) => ({ to: t.to, direction: t.direction, navGained: t.navGained, navLost: t.navLost }))} />
      </Section>

      <Section
        title="What each move changes"
        id="transitions"
        note="Guest navigation, derived from the same model the site renders. Entitlements are re-checked on every page, so this is what appears, not what is permitted."
      >
        <DataTable caption="Allowed transitions from the published state" head={
          <tr>
            <th scope="col">To</th>
            <th scope="col">Direction</th>
            <th scope="col">Mode</th>
            <th scope="col">Navigation gains</th>
            <th scope="col">Navigation loses</th>
          </tr>
        }>
          {s.transitions.length === 0 ? (
            <EmptyRow span={5}>{s.state} is the last state; there is nowhere further to go.</EmptyRow>
          ) : (
            s.transitions.map((t) => (
              <tr key={t.to}>
                <th scope="row">{t.to}</th>
                <td>{t.direction}</td>
                <td>{t.mode}</td>
                <td className="con-wrap">{t.navGained.length ? t.navGained.join(', ') : '—'}</td>
                <td className="con-wrap">{t.navLost.length ? t.navLost.join(', ') : '—'}</td>
              </tr>
            ))
          )}
        </DataTable>
      </Section>

      <Section
        title="Preview another state"
        id="preview"
        note={`A preview is a rehearsal, not a setting: it lasts ${Math.round(s.previewTtlSeconds / 3600)} hours, applies to this browser only, and is refused for anyone who is not an administrator — a guest handed the same link sees the published state.`}
      >
        {previewing ? (
          <form action={stopPreview}>
            <p className="ops-notice" role="status">
              <Pill tone="warn">Preview active</Pill> This browser is previewing another state. Stop it before judging what a guest sees.
            </p>
            <button type="submit" className="ops-button ops-button-danger">
              Stop previewing
            </button>
          </form>
        ) : (
          <form action={startPreview} className="con-form">
            <div className="ops-field">
              <label htmlFor="preview-state">Preview the site as</label>
              <select id="preview-state" name="state" className="ops-input" defaultValue={s.suggested}>
                {s.states.map((state) => (
                  <option key={state} value={state}>
                    {state}
                  </option>
                ))}
              </select>
            </div>
            <button type="submit" className="ops-button ops-button-ghost">
              Start previewing
            </button>
          </form>
        )}
      </Section>

      <Section title="Recent publishes and previews" id="history" note="From the audit trail. Free-text values are withheld here as they are everywhere else in the console.">
        <DataTable caption="Lifecycle audit trail" head={
          <tr>
            <th scope="col">When</th>
            <th scope="col">Action</th>
            <th scope="col">Actor</th>
            <th scope="col">Outcome</th>
            <th scope="col">Detail</th>
            <th scope="col">Request</th>
          </tr>
        }>
          {s.history.length === 0 ? (
            <EmptyRow span={6}>Nothing has been published or previewed yet.</EmptyRow>
          ) : (
            s.history.map((h) => (
              <tr key={h.id}>
                <td>{h.at}</td>
                <td>{h.action}</td>
                <td>{h.actor.kind}</td>
                <td>{h.outcome}</td>
                <td className="con-wrap">{h.metadata ? Object.entries(h.metadata).map(([k, v]) => `${k}=${v}`).join(' · ') : '—'}</td>
                <td className="ops-code">{h.requestId}</td>
              </tr>
            ))
          )}
        </DataTable>
      </Section>
    </ConsolePage>
  );
}
