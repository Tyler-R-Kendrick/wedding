import { cookies } from 'next/headers';
import Link from 'next/link';
import { VIEW_ROLE_COOKIE } from '@/domain/identity/view-role';
import { adminInvoke, adminPrincipal } from '../_lib/invoke';
import { Section } from '../_components/console';
import { clearViewRole, startViewRole } from '../_lib/view-role-actions';

/**
 * "View as: <role>" — preview the guest site with synthetic entitlements, without a real guest profile.
 */
export async function ViewRolePanel() {
  const principal = await adminPrincipal();
  if (principal.kind !== 'admin') return null;
  const jar = await cookies();
  const token = jar.get(VIEW_ROLE_COOKIE)?.value;
  const [roles, status] = await Promise.all([
    adminInvoke<{ roles: { role: string; label: string }[] }>('admin_list_view_roles', {}, { method: 'GET' }),
    adminInvoke<{ view: { role: string; label: string; readOnly: true } | null }>('admin_view_role_status', { token }, { method: 'GET' }),
  ]);
  const options = roles.ok ? roles.value.data.roles : [];
  const active = status.ok ? status.value.data.view : null;

  return (
    <Section title="View as role" id="view-as" note="Preview the guest site (home, weekend, RSVP, travel, gifts, and the rest) with a role’s entitlements. Read-only — uses synthetic preview records, not a real guest’s identity.">
      {active ? (
        <div className="con-note">
          You are previewing as <strong>{active.label}</strong>.{' '}
          <Link href="/">Open the site</Link>{' '}
          <form action={clearViewRole} className="flow-inline-form">
            <button type="submit" className="ops-button ops-button-ghost">
              Return to admin
            </button>
          </form>
        </div>
      ) : (
        <p className="con-note">Choose a role, then open the site from your account menu or the link below.</p>
      )}
      <ul className="list list--plain">
        {options.map(({ role, label }) => (
          <li key={role}>
            <form action={startViewRole} className="flow-inline-form">
              <input type="hidden" name="role" value={role} />
              <button type="submit" className="ops-button ops-button-ghost" aria-current={active?.role === role ? 'true' : undefined}>
                View as: {label}
              </button>
            </form>
          </li>
        ))}
      </ul>
    </Section>
  );
}
