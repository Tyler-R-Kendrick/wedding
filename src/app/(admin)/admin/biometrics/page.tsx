import type { Metadata } from 'next';
import type { BiometricStatusView } from '@/capabilities/biometrics';
import { AdminGate } from '@/components/media/AdminMediaNav';
import { MediaPage, MediaSection } from '@/components/media/MediaShell';
import { currentPrincipal, invokeForRequest } from '@/components/media/server';
import { AdminAiNav } from '@/components/mediaai/AdminAiNav';
import { BiometricReadiness } from '@/components/mediaai/BiometricReadiness';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Face matching', robots: { index: false, follow: false } };

/** Readiness, consent counts and deletion records. Never a template, a hash of one, or an IP hash. */
export default async function AdminBiometricsPage() {
  const principal = await currentPrincipal();
  if (principal.kind !== 'admin') return <AdminGate />;
  const status = await invokeForRequest<BiometricStatusView>('admin_biometric_status', {}, principal);
  if (!status.ok) {
    return (
      <MediaPage eyebrow="Admin" title="Face matching" actions={<AdminAiNav current="biometrics" />}>
        <MediaSection id="error">
          <p className="media-lede">{status.error.message}</p>
        </MediaSection>
      </MediaPage>
    );
  }
  const s = status.data;
  return (
    <MediaPage
      eyebrow="Admin"
      title="Face matching"
      lede="Illinois BIPA territory. This page exists so the feature can be reviewed and switched on deliberately — or left off, which is the default and the current state."
      actions={<AdminAiNav current="biometrics" />}
    >
      <MediaSection id="readiness" title="Before this can be switched on">
        <p className="media-lede">
          This checklist is engineering readiness, not legal advice. See docs/architecture/biometrics-bipa-readiness.md and ADR-0006 §7.
        </p>
        <ul className="mi-checklist">
          {s.checklist.map((c) => (
            <li key={c.item}>
              <span className="mi-checklist__mark" aria-hidden="true">{c.done ? '✓' : '·'}</span>
              <span>
                {c.item}
                <small>{c.note}</small>
              </span>
            </li>
          ))}
        </ul>
      </MediaSection>

      <MediaSection id="switch">
        <BiometricReadiness status={s} />
      </MediaSection>

      <MediaSection id="ledger" title="Consent ledger">
        <div className="mi-table-wrap">
          <table className="mi-table">
            <tbody>
              <tr>
                <th scope="row">Policy version</th>
                <td>
                  {s.policy.version} <small>({s.policy.textHash.slice(0, 12)}…)</small>
                </td>
              </tr>
              <tr>
                <th scope="row">Grants / withdrawals recorded</th>
                <td>
                  {s.consents.grants} / {s.consents.revokes}
                </td>
              </tr>
              <tr>
                <th scope="row">Currently agreed / needs re-consent</th>
                <td>
                  {s.consents.active} / {s.consents.superseded}
                </td>
              </tr>
              <tr>
                <th scope="row">References enrolled / matches stored</th>
                <td>
                  {s.enrolments} / {s.matches}
                </td>
              </tr>
              <tr>
                <th scope="row">Vault key source</th>
                <td>{s.vaultKeySource}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </MediaSection>

      <MediaSection id="deletions" title="Deletion records">
        {s.recentDeletions.length === 0 ? (
          <p className="media-lede">No deletion has been requested.</p>
        ) : (
          <div className="mi-table-wrap">
            <table className="mi-table">
              <thead>
                <tr>
                  <th scope="col">Requested</th>
                  <th scope="col">Guest</th>
                  <th scope="col">Reason</th>
                  <th scope="col">Status</th>
                  <th scope="col">Proof</th>
                </tr>
              </thead>
              <tbody>
                {s.recentDeletions.map((d) => (
                  <tr key={d.id}>
                    <td>{new Date(d.requestedAt).toLocaleString()}</td>
                    <td>{d.guestId}</td>
                    <td>{d.reason.replaceAll('_', ' ')}</td>
                    <td>{d.status}</td>
                    <td>{d.proof ? `${d.proof.identityRefsDeleted} reference(s), ${d.proof.matchesDeleted} match(es), ${d.proof.providerSubjectsDeleted} provider record(s), ${d.proof.vectorEntriesDeleted} index entries` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </MediaSection>
    </MediaPage>
  );
}
