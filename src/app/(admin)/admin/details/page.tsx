import type { Metadata } from 'next';
import Link from 'next/link';
import { adminSiteDetails } from '@/capabilities/ops';
import { RecordList, RecordRow } from '@/components/admin/flow/records';
import { adminInvoke, adminPrincipal } from '../../_shared/admin';
import { ConsoleGate, ConsolePage, Denied, Pill, Section, Stat, StatStrip } from '../_components/console';
import { DetailFlow } from './_components/DetailFlow';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Details', robots: { index: false, follow: false } };

/**
 * The facts that show in more than one place, in one list: the date, the place, when to reply by,
 * each event's time and room, the room block, valet. Each row says what the site says now, every
 * page that prints it, and how to change it: here, in one step, where the site keeps one record;
 * on the screen that owns it otherwise. A fact nobody has decided is marked, and so is one where a
 * copy in the code says something different from the record.
 */
export default async function AdminDetailsPage() {
  const { principal } = await adminPrincipal();
  if (principal.kind !== 'admin') return <ConsoleGate what="Details" />;
  const result = await adminInvoke(adminSiteDetails, {});
  if (!result.ok) {
    return (
      <ConsolePage title="Details">
        <Denied message={result.error.message} entitlement="admin_content" />
      </ConsolePage>
    );
  }
  const { groups, counts } = result.value.data;

  return (
    <ConsolePage title="Details" lede="Dates and facts that appear on several pages. Change one here and every page listed under it follows. Where a fact is edited on its own screen, the row links there." wide>
      <StatStrip>
        <Stat label="Shared facts" value={counts.total} />
        <Stat label="Still to decide" value={counts.todo} hint={counts.todo ? 'Guests see “to be confirmed”' : 'Everything is decided'} />
        <Stat label="Out of step" value={counts.differs} hint={counts.differs ? 'A copy in the code says something else' : 'Every copy agrees'} />
      </StatStrip>

      {groups.map((group) => (
        <Section key={group.id} title={group.label} id={group.id}>
          <RecordList label={group.label}>
            {group.facts.map((f) => (
              <RecordRow
                key={f.key}
                data-fact={f.key}
                title={f.label}
                status={f.state === 'todo' ? <Pill tone="warn">To decide</Pill> : f.state === 'differs' ? <Pill tone="bad">Out of step</Pill> : null}
                meta={f.value ?? 'Not decided yet'}
                actions={
                  f.edit.kind === 'here' ? (
                    <DetailFlow id={f.key} label={f.label} now={f.value} edit={f.edit} shownOn={f.shownOn} copies={f.copies} />
                  ) : f.edit.kind === 'screen' ? (
                    <Link className="flow-trigger-quiet" href={f.edit.href}>
                      {f.edit.label}
                    </Link>
                  ) : null
                }
              >
                <p className="det-shown">
                  <span className="det-shown__label">Shows on</span>
                  {f.shownOn.map((p, i) => (
                    <span key={`${p.href}-${p.label}`}>
                      {i ? ', ' : ' '}
                      <Link href={p.href}>{p.label}</Link>
                    </span>
                  ))}
                </p>
                {f.copies.map((c) => (
                  <p key={c.where} className="det-copy">
                    Not following: {c.where} says <strong>{c.value}</strong>.
                  </p>
                ))}
              </RecordRow>
            ))}
          </RecordList>
        </Section>
      ))}
    </ConsolePage>
  );
}
