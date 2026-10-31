'use client';

import { useEffect, useState } from 'react';
import { sessionProbe, type SessionHint } from '@/themes/shared/session-hint';
import { stopGuestView, stopViewRole } from './actions';

/**
 * Visible band while an administrator previews the guest site (by role or by inspecting a guest profile).
 */
export function GuestViewBand() {
  const [hint, setHint] = useState<Pick<SessionHint, 'viewAs' | 'viewRole'>>({ viewAs: null, viewRole: null });
  useEffect(() => {
    let live = true;
    void sessionProbe().then((h) => {
      if (live) setHint({ viewAs: h.viewAs, viewRole: h.viewRole });
    });
    return () => {
      live = false;
    };
  }, []);
  const { viewAs, viewRole } = hint;
  if (viewRole) {
    return (
      <div className="preview-band guest-view-band">
        <p className="guest-view-band__text" role="status">
          View as: <strong>{viewRole.label}</strong>. Preview only — nothing you do here is saved or sent as a real guest.
        </p>
        <form action={stopViewRole}>
          <button type="submit" className="guest-view-band__stop">
            Return to admin
          </button>
        </form>
      </div>
    );
  }
  if (!viewAs) return null;
  return (
    <div className="preview-band guest-view-band">
      <p className="guest-view-band__text" role="status">
        Inspecting as <strong>{viewAs.name}</strong>
        {viewAs.household && !viewAs.household.includes(viewAs.name) ? ` (${viewAs.household})` : ''}.{' '}
        {viewAs.readOnly ? 'Read-only: nothing you do here is saved or sent in their name.' : 'This is your own guest record.'}
      </p>
      <form action={stopGuestView}>
        <button type="submit" className="guest-view-band__stop">
          Stop inspecting as {viewAs.name}
        </button>
      </form>
    </div>
  );
}
