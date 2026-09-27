'use client';

import { useEffect, useState } from 'react';
import { sessionProbe, type SessionHint } from '@/themes/shared/session-hint';
import { stopGuestView } from './actions';

/**
 * The band that says, on every page of the site, that an administrator is browsing as a guest —
 * whose view it is, whether it can change anything, and the way back. Like the lifecycle preview
 * band (ADR-0012 §3), a view that is not the reader's own is always visibly marked.
 *
 * Every design's Shell renders it. It asks `/api/session` (the one request the account menu makes
 * too) because the public pages are prerendered and cannot know; for everyone who is not browsing
 * as a guest it renders nothing. Not sticky: the lifecycle band and the desktop masthead already
 * hold the top edge.
 */
export function GuestViewBand() {
  const [view, setView] = useState<SessionHint['viewAs']>(null);
  useEffect(() => {
    let live = true;
    void sessionProbe().then((hint) => {
      if (live) setView(hint.viewAs);
    });
    return () => {
      live = false;
    };
  }, []);
  if (!view) return null;
  return (
    <div className="preview-band guest-view-band">
      <p className="guest-view-band__text" role="status">
        Browsing as <strong>{view.name}</strong>
        {/* "Ana Ruiz (Ana Ruiz & Guest)" says the name twice; the household only when it adds something. */}
        {view.household && !view.household.includes(view.name) ? ` (${view.household})` : ''}.{' '}
        {view.readOnly ? 'Read-only: nothing you do here is saved or sent in their name.' : 'This is your own guest record.'}
      </p>
      {/* One name for one action, the console's too: it ENDS the view (and returns to the console),
          where the account menu's "Admin console" link only visits it. */}
      <form action={stopGuestView}>
        <button type="submit" className="guest-view-band__stop">
          Stop browsing as {view.name}
        </button>
      </form>
    </div>
  );
}
