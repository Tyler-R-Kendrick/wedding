'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { adminClearViewRole, adminSetViewRole } from '@/capabilities/identity/view_role';
import { GUEST_VIEW_COOKIE } from '@/domain/identity/guest-view';
import type { ViewRoleKey } from '@/domain/identity/view-role';
import { VIEW_ROLE_COOKIE, VIEW_ROLE_TTL_SECONDS } from '@/domain/identity/view-role';
import { adminInvoke, back, describeError } from '../_shared/admin';

export async function startViewRole(fd: FormData): Promise<void> {
  const role = fd.get('role');
  if (typeof role !== 'string' || !role) back('/admin', { error: 'Choose a role to preview.' });
  const r = await adminInvoke(adminSetViewRole, { role: role as ViewRoleKey });
  if (!r.ok) back('/admin', { error: describeError(r.error) });
  const jar = await cookies();
  jar.delete(GUEST_VIEW_COOKIE);
  jar.set({
    name: VIEW_ROLE_COOKIE,
    value: r.value.data.token,
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: VIEW_ROLE_TTL_SECONDS,
    secure: process.env.NODE_ENV === 'production',
  });
  redirect('/');
}

export async function clearViewRole(): Promise<void> {
  await adminInvoke(adminClearViewRole, {});
  const jar = await cookies();
  jar.delete(VIEW_ROLE_COOKIE);
  redirect('/admin?ok=' + encodeURIComponent('View as admin again.'));
}
