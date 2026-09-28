import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { adminLifecycleStatus } from '@/capabilities/ops';
import { PREVIEW_COOKIE } from '@/domain/lifecycle/constants';
import { adminInvoke, adminPrincipal } from '../../_shared/admin';
import { ConsoleGate, ConsolePage, DataTable, Denied, KeyValues, Pill, Section, Stamp } from '../_components/console';
import { startPreview, stopPreview } from '../_lib/ops-actions';
import { PublishFlow } from './_components/PublishFlow';
import { DIRECTION_LABEL, MODE_LABEL, OUTCOME_LABEL, actorLabel, changeLabel, stateLabel } from './_components/states';

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
      actions={s.transitions.length ? <PublishFlow moves={s.transitions.map((t) => ({ to: t.to, direction: t.direction }))} /> : null}
    >
      {/* The state in words; the code rides along as `data-state` for anything that reads the page
          (the e2e spec), and is printed in Technical details at the bottom. */}
      <KeyValues
        items={[
          { label: 'Published state', value: <strong data-state={s.state}>{stateLabel(s.state)}</strong> },
          { label: 'Home page leads with', value: MODE_LABEL[s.mode] ?? s.mode },
          { label: 'Published', value: s.publishedAt ? <Stamp at={s.publishedAt} /> : 'Never' },
          { label: 'By', value: actorLabel(s.publishedBy) },
          { label: 'Calendar suggests', value: s.behindSchedule ? <Pill tone="warn">{stateLabel(s.suggested)}</Pill> : <Pill tone="good">{stateLabel(s.suggested)}</Pill> },
        ]}
      />
      {s.note ? <p className="con-note">Note on the current state: {s.note}</p> : null}

      <p className="con-note">
        {s.transitions.length
          ? 'Publishing takes effect for every guest on their next page load, and can be undone by exactly one state. Reviewing a move first is free and changes nothing.'
          : `There is nowhere to move from ${stateLabel(s.state)}: it is the last state.`}
      </p>

      <Section
        title="What each move changes"
        id="transitions"
        note="Guest navigation, derived from the same model the site renders. Entitlements are re-checked on every page, so this is what appears, not what is permitted."
      >
        <DataTable caption="Allowed transitions from the published state" head={
          <tr>
            <th scope="col">To</th>
            <th scope="col">Direction</th>
            <th scope="col">Home page leads with</th>
            <th scope="col">Navigation gains</th>
            <th scope="col">Navigation loses</th>
          </tr>
        } empty={s.transitions.length === 0 ? <>{stateLabel(s.state)} is the last state; there is nowhere further to go.</> : null}>
          {s.transitions.map((t) => (
            <tr key={t.to}>
              <th scope="row">{stateLabel(t.to)}</th>
              <td>{DIRECTION_LABEL[t.direction] ?? t.direction}</td>
              <td>{MODE_LABEL[t.mode] ?? t.mode}</td>
              <td className="con-wrap">{t.navGained.length ? t.navGained.join(', ') : '—'}</td>
              <td className="con-wrap">{t.navLost.length ? t.navLost.join(', ') : '—'}</td>
            </tr>
          ))}
        </DataTable>
      </Section>

      <Section
        title="Preview another state"
        id="preview"
        note={`A preview is a rehearsal, not a setting: it lasts ${Math.round(s.previewTtlSeconds / 3600)} hours, applies to this browser only, and is refused for anyone who is not an administrator — a guest handed the same link sees the published state.`}
      >
        {/*
          Still server-action forms, not QuickActions: starting a preview sets an httpOnly cookie, and
          /api/capabilities never sets cookies (`navigate_to` only mints the token). Stopping it is
          reversible in one click, so it is a quiet ghost button, not a red one.
        */}
        {previewing ? (
          <form action={stopPreview} className="con-form">
            <p className="ops-notice" role="status">
              <Pill tone="warn">Preview active</Pill> This browser is previewing another state. Stop it before judging what a guest sees.
            </p>
            <button type="submit" className="ops-button ops-button-ghost">
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
                    {stateLabel(state)}
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
            <th scope="col">What changed</th>
            <th scope="col">By</th>
            <th scope="col">Outcome</th>
          </tr>
        } empty={s.history.length === 0 ? <>Nothing has been published or previewed yet.</> : null}>
          {s.history.map((h) => (
            <tr key={h.id}>
              <td><Stamp at={h.at} /></td>
              <td className="con-wrap">{changeLabel(h.action, h.metadata)}</td>
              <td>{actorLabel(h.actor)}</td>
              <td>{h.outcome === 'success' ? OUTCOME_LABEL.success : <Pill tone="bad">{OUTCOME_LABEL[h.outcome] ?? h.outcome}</Pill>}</td>
            </tr>
          ))}
        </DataTable>
      </Section>

      {/* The model's own names, for someone reading the code or the audit export beside this screen. */}
      <details className="flow-details">
        <summary>Technical details</summary>
        <div className="flow-details__body">
          <KeyValues
            items={[
              { label: 'State code', value: <code className="ops-code">{s.state}</code> },
              { label: 'Home page mode', value: <code className="ops-code">{s.mode}</code> },
              { label: 'Suggested code', value: <code className="ops-code">{s.suggested}</code> },
              { label: 'Published by', value: s.publishedBy ? <code className="ops-code">{`${s.publishedBy.kind}${s.publishedBy.ref ? ` · ${s.publishedBy.ref}` : ''}`}</code> : '—' },
            ]}
          />
          <DataTable caption="Lifecycle audit rows as recorded" head={
            <tr>
              <th scope="col">When</th>
              <th scope="col">Action</th>
              <th scope="col">Actor</th>
              <th scope="col">Outcome</th>
              <th scope="col">Metadata</th>
              <th scope="col">Request</th>
            </tr>
          } empty={s.history.length === 0 ? <>No audit rows yet.</> : null}>
            {s.history.map((h) => (
              <tr key={h.id}>
                <td><Stamp at={h.at} /></td>
                <td className="ops-code">{h.action}</td>
                <td className="ops-code">{`${h.actor.kind}${h.actor.ref ? ` · ${h.actor.ref}` : ''}`}</td>
                <td className="ops-code">{h.outcome}</td>
                <td className="con-wrap ops-code">{h.metadata ? Object.entries(h.metadata).map(([k, v]) => `${k}=${v}`).join(' · ') : '—'}</td>
                <td className="ops-code">{h.requestId}</td>
              </tr>
            ))}
          </DataTable>
        </div>
      </details>
    </ConsolePage>
  );
}
