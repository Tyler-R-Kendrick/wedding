import type { Metadata } from 'next';
import Link from 'next/link';
import { adminFlagStatus } from '@/capabilities/ops';
import { newId } from '@/contracts/ids';
import { adminInvoke, adminPrincipal } from '../../_shared/admin';
import { ConsoleGate, ConsolePage, DataTable, Denied, KeyValues, Pill, Section } from '../_components/console';
import { disableFlagReadiness } from '../_lib/ops-actions';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Feature flags', robots: { index: false, follow: false } };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * Both halves of every feature gate. Flags come from the server environment and cannot be changed
 * from a web page at all — a deploy changes them. The two readiness switches can be changed, and
 * only in one direction from here: off.
 *
 * There is no switch-on control, and its absence is the design. `BIOMETRICS_ENABLED` is turned on
 * from Face matching behind a counsel-review reference, a fresh session and a single-use
 * confirmation; `PRO_MEDIA_AI_PROCESSING` has no enable path anywhere in the application, because
 * backlog C-09 and V-03 (written vendor confirmation) are open, and a generic "flip any switch"
 * control would have replaced both of those careful doors with one button.
 */
export default async function AdminFlagsPage({ searchParams }: { searchParams: SearchParams }) {
  const { principal } = await adminPrincipal();
  if (principal.kind !== 'admin') return <ConsoleGate what="Feature flags" />;
  const sp = await searchParams;
  const notice = { ok: one(sp.ok), error: one(sp.error) };

  const result = await adminInvoke(adminFlagStatus, {});
  if (!result.ok) {
    return (
      <ConsolePage title="Feature flags" notice={notice}>
        <Denied message={result.error.message} entitlement="admin_lifecycle" />
      </ConsolePage>
    );
  }
  const { flags, enablement } = result.value.data;
  const gated = flags.filter((f) => f.readinessGated);
  const plain = flags.filter((f) => !f.readinessGated);

  return (
    <ConsolePage
      title="Feature flags"
      lede="A feature is on only when every gate in front of it is open. Flags come from the server environment; readiness switches are rows in the database."
      notice={notice}
    >
      <Section
        title="Legal gates"
        id="legal"
        note="Two features are held shut by something outside this application: a counsel review and a vendor's written permission. Both gates must be open — the environment flag and the persisted switch — before either feature does anything."
      >
        <p className="ops-notice" role="note">
          <Pill tone="warn">No switch-on here</Pill> {enablement.reason}
        </p>
        {/*
          Two gates, and the control that closes them is the whole point of the screen — so they are
          panels, not a seven-column table. As a table the "Switch off" cell was the 7th column: 881px
          past the right edge at 390 and, because `.ops` caps at 72rem, still 47px past it at 1440.
          There was no viewport at which an operator could see the off-switch, and "In effect" — the
          only column that answers "is this gate open right now?" — was off-screen at 390 too.
        */}
        <ul className="con-gates">
          {gated.map((f) => (
            <li key={f.name} className="con-gate">
              <div className="con-gate__head">
                <h3 className="con-gate__name">{f.name}</h3>
                {f.effective ? <Pill tone="bad">live</Pill> : <Pill tone="neutral">not live</Pill>}
              </div>
              <KeyValues
                items={[
                  { label: 'Environment', value: f.envValue ? <Pill tone="warn">on</Pill> : <Pill tone="neutral">off</Pill> },
                  { label: 'Readiness', value: f.readiness ? <Pill tone="warn">on</Pill> : <Pill tone="neutral">off</Pill> },
                  {
                    label: 'Last changed',
                    value: (
                      <>
                        {f.updatedAt ?? '—'}
                        {f.hasNote ? <span className="con-index__blurb"> justification recorded</span> : null}
                      </>
                    ),
                  },
                ]}
              />
              {f.gate ? (
                <p className="con-note">
                  <strong>Blocked by:</strong> {f.gate.requirement}{' '}
                  <span className="con-index__blurb">(backlog {f.gate.backlogIds.join(', ')})</span>
                  {f.gate.ownedBy ? (
                    <>
                      {' '}
                      <Link href={f.gate.ownedBy.route}>Switched on from {f.gate.ownedBy.label}</Link>.
                    </>
                  ) : null}
                </p>
              ) : null}
              <form action={disableFlagReadiness} className="con-inline-form">
                <input type="hidden" name="flag" value={f.name} />
                <input type="hidden" name="idem" value={newId()} />
                {/*
                  Both buttons used to be named exactly "Switch off". A screen reader announced the
                  same name twice on a screen governing two different legal gates, and `<th scope="row">`
                  is not read in focus order — so the one irreversible-feeling control here was the one
                  you could not tell apart.
                */}
                <button type="submit" className="ops-button ops-button-danger" aria-label={`Switch ${f.name} readiness off`}>
                  Switch off
                </button>
              </form>
            </li>
          ))}
        </ul>
        <p className="con-note">
          Switching off is unconditional and always available, on purpose: closing a legal gate must never be blocked by a missing precondition, and must not
          depend on holding the entitlement that owns the feature.
        </p>
      </Section>

      <Section
        title="Everything else"
        id="flags"
        note="These are read from the server environment at startup (FLAG_<NAME>=on|off). Changing one is a deploy, not a click — there is no control here, and that is not an omission."
      >
        <DataTable caption="Feature flags from the environment" head={
          <tr>
            <th scope="col">Flag</th>
            <th scope="col">Shipped default</th>
            <th scope="col">This environment</th>
            <th scope="col">In effect</th>
          </tr>
        }>
          {plain.map((f) => (
            <tr key={f.name}>
              <th scope="row">{f.name}</th>
              <td>{f.defaultValue ? 'on' : 'off'}</td>
              <td>
                {f.envValue ? 'on' : 'off'}
                {f.overridden ? <span className="con-index__blurb"> overridden</span> : null}
              </td>
              <td>{f.effective ? <Pill tone="good">on</Pill> : <Pill tone="neutral">off</Pill>}</td>
            </tr>
          ))}
        </DataTable>
      </Section>
    </ConsolePage>
  );
}
