'use client';

import { Component, useEffect, useState, useSyncExternalStore, type ComponentType, type ReactNode } from 'react';
import { FEEDBACK_PATH, REPORTER_EVENT, REPORTER_GLOBAL } from '@/lib/feedback/constants';
import { askSession, onSessionHint, sessionAsked, type SessionHint } from '@/themes/shared/session-hint';
import { fallbackHref, flushOutbox, isArmed, setArmed, subscribeArmed, type ReportRequest } from './reporter-client';

/**
 * The problem reporter's mount point, in the root layout of every page. For everyone but the
 * couple it renders nothing and loads nothing: the dialog is a separate chunk, requested the first
 * time an armed device asks for it.
 *
 * "Armed" is a marker in this device's localStorage, set when `/api/session` says the reader is an
 * owner and cleared when it says they are not. When that request fails, the marker is left alone:
 * a device that was the couple's an hour ago still is, and "sign-in is down" is one of the things
 * they need to be able to report. The marker only decides whether the shortcut does anything; the
 * endpoint decides who may report (src/app/api/feedback/route.ts).
 *
 * Three ways in: the shortcut (the inline script in the root layout calls the function this puts
 * on `window`), "Report a problem" in the account menu, and the button on an error page. Each
 * falls back to the plain form if the dialog cannot be loaded or throws.
 */
type Dialog = ComponentType<{ request: ReportRequest & { n: number } }>;
type Opener = (request?: ReportRequest) => void;
type Host = Window & { [REPORTER_GLOBAL]?: Opener };

/** If the dialog itself fails to render, the plain form is one navigation away. */
class Boundary extends Component<{ children: ReactNode; request: ReportRequest }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override componentDidCatch() {
    location.assign(fallbackHref(this.props.request));
  }
  override render() {
    return this.state.failed ? null : this.props.children;
  }
}

function applyHint(hint: SessionHint): void {
  // An answer that did not arrive is not a sign-out: no news changes nothing.
  if (!hint.resolved) return;
  if (hint.reporter) {
    if (!isArmed()) setArmed(true);
  } else if (isArmed()) {
    setArmed(false);
    // The pass cookie goes with the marker. Best effort: it expires on its own.
    void fetch(FEEDBACK_PATH, { method: 'DELETE', credentials: 'same-origin' }).catch(() => undefined);
  }
}

export function ReporterLauncher() {
  const armed = useSyncExternalStore(subscribeArmed, isArmed, () => false);
  const [opened, setOpened] = useState<{ Dialog: Dialog; request: ReportRequest & { n: number } } | null>(null);

  // Learn from every session answer the page gets. Where the chrome has already asked (the account
  // menu's effect runs before this one), that answer is on its way and nothing more is sent.
  // Otherwise ask only where an owner is likely, and without becoming the page's remembered answer:
  // that one outlives a soft navigation, and "Browse as a guest" leaves an admin page by one.
  useEffect(() => {
    const stop = onSessionHint(applyHint);
    if (!sessionAsked() && (isArmed() || location.pathname.startsWith('/admin'))) void askSession();
    return stop;
  }, []);

  useEffect(() => {
    if (!armed) return;
    const open: Opener = (request = {}) => {
      import('./ReporterDialog').then(
        ({ ReporterDialog }) => setOpened({ Dialog: ReporterDialog, request: { ...request, n: Date.now() } }),
        () => location.assign(fallbackHref(request)),
      );
    };
    const onEvent = (e: Event) => open((e as CustomEvent<ReportRequest>).detail ?? {});
    (window as Host)[REPORTER_GLOBAL] = open;
    window.addEventListener(REPORTER_EVENT, onEvent);
    // Reports written while the site was unreachable go now that a page has loaded.
    void flushOutbox();
    return () => {
      delete (window as Host)[REPORTER_GLOBAL];
      window.removeEventListener(REPORTER_EVENT, onEvent);
    };
  }, [armed]);

  if (!armed || !opened) return null;
  const { Dialog, request } = opened;
  return (
    <Boundary request={request}>
      <Dialog request={request} />
    </Boundary>
  );
}
